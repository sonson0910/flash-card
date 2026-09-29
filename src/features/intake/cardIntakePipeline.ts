import { fetchAudioUrl } from '../../lib/audio';
import { OperationTimeoutError, withTimeout } from '../../lib/async';
import { mapWithConcurrency } from '../../lib/asyncPool';
import { cardLogicalKey, createWordCardId, normalizeCardWord } from '../../lib/cardIdentity';
import { isRetryableCloudError } from '../../lib/cloudError';
import { normalizePartOfSpeech } from '../../lib/cardQuery';
import {
  createCardV2IfAbsent,
  createLibraryFacetOperationId,
  deriveLibraryFacetOperationId,
  findCardByNormalizedWord,
  findCardsByNormalizedWords,
  type CreateCardV2IfAbsentResult,
} from '../../lib/cardRepository';
import { db, isFirebaseConfigured } from '../../lib/firebase';
import { fetchImageUrl } from '../../lib/images';
import { classifyProtectedFunctionError } from '../../lib/protectedFunctionsCapability';
import { retainCardsForSession } from '../../lib/sessionCards';
import type { CardData } from '../../types/card';
import {
  indexCardsByNormalizedWord,
  type SpreadsheetSaveOutcome,
} from '../importExport/spreadsheetImportService';
import { ENGLISH_TO_VIETNAMESE_PROFILE } from '../language/languageProfile';
import { promoteExistingCard } from '../library/libraryPresentation';
import { waitForInitialMedia } from '../library/libraryStorage';
import { normalizeCardOperationId } from '../../lib/cardMutationProtocol';
import {
  RequestedDeckUnavailableError,
  settleMediaBestEffort,
  catalogCardBatchError,
  type ConfirmedCatalogCardsResult,
  type CardIntakeControllerPort,
} from './cardIntakeController';
import type { CardIntakePortOptions } from './cardIntakePortContract';

export interface IntakeSessionToken {
  ownerId: string | null;
  generation: number;
}

export const createIntakeSessionGuard = (initialOwnerId: string | null) => {
  let ownerId = initialOwnerId;
  let generation = 0;
  return {
    replaceOwner(nextOwnerId: string | null) {
      if (nextOwnerId !== ownerId) {
        ownerId = nextOwnerId;
        generation += 1;
      }
    },
    capture: (): IntakeSessionToken => ({ ownerId, generation }),
    isCurrent: (token: IntakeSessionToken) =>
      token.ownerId === ownerId && token.generation === generation,
  };
};

export class StaleIntakeSessionError extends Error {
  constructor() { super('The intake session changed before this operation completed.'); }
}

export const canContinueIntakeFromLocalLookup = (
  error: unknown,
  allWordsFoundLocally: boolean,
): boolean => allWordsFoundLocally || isRetryableCloudError(error);

export const rethrowIfStaleIntakeSession = (
  cause: unknown,
  sessionIsCurrent = true,
): void => {
  if (!sessionIsCurrent) throw new StaleIntakeSessionError();
  if (cause instanceof StaleIntakeSessionError) throw cause;
};

const mergeCards = (current: readonly CardData[], incoming: readonly CardData[]) => {
  const incomingIds = new Set(incoming.map(card => card.id));
  return [...incoming, ...current.filter(card => !incomingIds.has(card.id))];
};

const belongsToVerifiedLibraryEpoch = (
  card: CardData,
  libraryEpoch: number | null,
): boolean => libraryEpoch === null
  || card.libraryEpoch === libraryEpoch
  || (libraryEpoch === 0 && card.libraryEpoch === undefined);

const safeProtocolNumber = (value: unknown, fallback = 0): number =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fallback;

const isCardProtocolVersionNewer = (candidate: CardData, reference: CardData): boolean => {
  const candidateEpoch = safeProtocolNumber(candidate.libraryEpoch);
  const referenceEpoch = safeProtocolNumber(reference.libraryEpoch);
  return candidateEpoch > referenceEpoch
    || (
      candidateEpoch === referenceEpoch
      && safeProtocolNumber(candidate.revision) > safeProtocolNumber(reference.revision)
    );
};

type OptimisticDuplicateCompensationPort = Pick<
  CardIntakePortOptions,
  'resetCloudPage' | 'updateCategoryFacets' | 'updateCloudStats'
>;

export function compensateOptimisticDuplicateCard(
  card: CardData,
  port: OptimisticDuplicateCompensationPort,
  operationId?: string,
): void {
  port.updateCloudStats(stats => ({
    ...stats,
    total: Math.max(0, stats.total - 1),
    unrated: Math.max(0, stats.unrated - 1),
  }));
  const category = card.category || 'Other';
  const delta = { [category]: -1 };
  const update = operationId
    ? port.updateCategoryFacets(delta, deriveLibraryFacetOperationId(operationId, 'duplicate'))
    : port.updateCategoryFacets(delta);
  void update.catch(cause => {
    console.warn('The duplicate was reconciled, but its category facet needs a refresh.', cause);
  });
  port.resetCloudPage();
}

const rewardTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

export interface CardIntakePipeline extends CardIntakeControllerPort {
  replaceOwner(ownerId: string | null): void;
  captureSession(): () => boolean;
}

export interface CardIntakePipelineOptions {
  getContext(): CardIntakePortOptions;
}

export function createCardIntakePipeline({
  getContext,
}: CardIntakePipelineOptions): CardIntakePipeline {
  const sessionGuard = createIntakeSessionGuard(getContext().ownerId);
  const assertCurrent = (token: IntakeSessionToken) => {
    if (!sessionGuard.isCurrent(token)) throw new StaleIntakeSessionError();
  };
  const mediaSessions = new WeakMap<CardData, IntakeSessionToken>();
  const persistedCardOperations = new Map<string, {
    operationId: string;
    promise: Promise<Array<{ card: CardData; created: boolean }>>;
    retryable: boolean;
  }>();
  const createOperationId = () => normalizeCardOperationId(`create-${globalThis.crypto.randomUUID()}`);

  const findExisting: CardIntakeControllerPort['findExisting'] = async words => {
    const current = getContext();
    const session = sessionGuard.capture();
    const normalizedWords = [...new Set(words.map(word => normalizeCardWord(typeof word === 'string' ? word : word.normalizedWord || word.word)).filter(Boolean))];
    const logicalInputs = words.flatMap(word => typeof word === 'string' || !word.lexemeId ? [] : [[`lexeme:${word.lexemeId}`, word] as const]);
    const local = current.getCards().filter(card => belongsToVerifiedLibraryEpoch(card, current.libraryEpoch));
    const matches = indexCardsByNormalizedWord(local);
    const logicalMatches = new Map(local.map(card => [cardLogicalKey(card), card]));

    const ownerId = current.ownerId;
    if (!ownerId) {
      throw classifyProtectedFunctionError({ code: 'unauthenticated' }, 'Card lookup');
    }
    if (db && isFirebaseConfigured && current.libraryEpoch !== null) {
      try {
        const cloud = await findCardsByNormalizedWords(
          db,
          ownerId,
          normalizedWords,
          current.libraryEpoch,
        );
        assertCurrent(session);
        cloud.forEach((card, word) => matches.set(word, card));
        for (const [key, requested] of logicalInputs) {
          const card = await findCardByNormalizedWord(db, ownerId, requested, current.libraryEpoch);
          assertCurrent(session);
          if (card) logicalMatches.set(key, card);
        }
      } catch (cause) {
        rethrowIfStaleIntakeSession(cause, sessionGuard.isCurrent(session));
        const allWordsFoundLocally = normalizedWords.every(word => matches.has(word));
        if (!canContinueIntakeFromLocalLookup(cause, allWordsFoundLocally)) throw cause;
      }
    }
    return new Map([
      ...normalizedWords.flatMap(word => matches.has(word) ? [[word, matches.get(word)!] as [string, CardData]] : []),
      ...logicalInputs.flatMap(([key]) => logicalMatches.has(key) ? [[key, logicalMatches.get(key)!] as [string, CardData]] : []),
    ]);
  };

  const touchExisting: CardIntakeControllerPort['touchExisting'] = async (card, touchedAt) => {
    const current = getContext();
    if (current.getCards().some(existing =>
      existing.id === card.id && isCardProtocolVersionNewer(existing, card))) return;
    const promotion = promoteExistingCard(card, touchedAt);
    const promoted = promotion.card;
    current.rememberPromoted(promoted);
    const next = retainCardsForSession(
      mergeCards(
        current.getCards().filter(candidate => cardLogicalKey(candidate) !== cardLogicalKey(promoted)),
        [promoted],
      ),
      current.cardsPerPage,
    );
    current.publishCards(next);
    current.hydrateExisting(promoted);
    current.resetCatalog();
    current.resetCloudPage();
    current.notify(`“${promoted.word}” is already in your library. It has been moved to the top of page 1.`);
    current.focusLibrary();
    void current.patchCard(promoted.id, promotion.fields, promoted).catch(cause => {
      console.warn('The promoted card remains visible, but its activity timestamp is waiting to sync.', cause);
    });
  };

  const assignExistingDeck: NonNullable<CardIntakeControllerPort['assignExistingDeck']> = async (card, deck) => {
    const session = sessionGuard.capture();
    const assigned = { ...card, customDeck: deck };
    await getContext().patchCard(card.id, { customDeck: deck }, card);
    assertCurrent(session);
    return assigned;
  };

  const generateCard: CardIntakeControllerPort['generateCard'] = async (
    request,
  ) => {
    const current = getContext();
    const session = sessionGuard.capture();
    if (!current.ownerId) {
      throw classifyProtectedFunctionError(
        { code: 'unauthenticated' },
        'AI generation',
      );
    }
    const normalizedWord = request.language.normalize(request.term).slice(0, 80);
    const partOfSpeechHint = normalizePartOfSpeech(request.partOfSpeechHint);
    const requestedDeck = typeof request.requestedDeck === 'string'
      ? request.requestedDeck.trim().slice(0, 128)
      : '';
    if (requestedDeck && request.requestedDeckAvailable) {
      let available = false;
      try {
        available = await request.requestedDeckAvailable(requestedDeck);
      } catch {
        available = false;
      }
      if (!available) throw new RequestedDeckUnavailableError(requestedDeck);
    }
    const audioPromise = fetchAudioUrl(normalizedWord);
    const { generateWordInfo } = await import('../../lib/gemini');
    const wordInfo = await generateWordInfo(normalizedWord, {
      ...(request.operationId ? { operationId: request.operationId } : {}),
      context: request.context,
      ...(partOfSpeechHint ? { partOfSpeechHint } : {}),
      sourceLanguage: request.language.source.code,
      targetLanguage: request.language.target.code,
    });
    assertCurrent(session);
    const mediaPromise = Promise.all([
      audioPromise,
      fetchImageUrl({
        word: normalizedWord,
        searchQuery: wordInfo.imageSearchQuery,
        category: wordInfo.category,
        partOfSpeech: wordInfo.partOfSpeech,
      }),
    ]).then(([audioUrl, imageUrl]) => ({ audioUrl, imageUrl }));
    const initialMedia = await waitForInitialMedia(mediaPromise);
    assertCurrent(session);
    const sourceUrl = typeof request.sourceUrl === 'string' ? request.sourceUrl.trim() : '';
    const pageTitle = typeof request.pageTitle === 'string' ? request.pageTitle.trim() : '';
    // Persist the capture context instead of only spending it on the Gemini
    // prompt above: without this, "where did this word come from" is lost
    // the moment generation finishes.
    const capturedContext = typeof request.context === 'string' ? request.context.trim() : '';
    const hasSource = Boolean(sourceUrl || pageTitle || capturedContext || request.capturedAt);
    const source = hasSource ? {
      ...(sourceUrl ? { url: sourceUrl } : {}),
      ...(pageTitle ? { title: pageTitle } : {}),
      ...(capturedContext ? { context: capturedContext } : {}),
      capturedAt: request.capturedAt || new Date().toISOString(),
    } : undefined;
    return {
      card: {
        id: createWordCardId(normalizedWord),
        ...(source ? { source } : {}),
        origin: 'ai',
        language: request.language.source.code,
        translationLanguage: request.language.target.code,
        word: normalizedWord,
        normalizedWord,
        translation: wordInfo.translation,
        explanation: wordInfo.explanation,
        explanationTranslation: wordInfo.explanationTranslation,
        phonetic: wordInfo.phonetic,
        emoji: wordInfo.emoji,
        category: wordInfo.category,
        audioUrl: initialMedia?.audioUrl ?? null,
        imageUrl: initialMedia?.imageUrl ?? null,
        imageSearchQuery: wordInfo.imageSearchQuery,
        createdAt: new Date().toISOString(),
        customDeck: requestedDeck || null,
        difficulty: 'unrated',
        bookmarked: false,
        partOfSpeech: normalizePartOfSpeech(wordInfo.partOfSpeech),
        cefrLevel: wordInfo.cefrLevel,
        exampleSentence: wordInfo.exampleSentence,
        exampleTranslation: wordInfo.exampleTranslation,
        collocations: wordInfo.collocations,
        synonyms: wordInfo.synonyms,
        antonyms: wordInfo.antonyms,
        register: wordInfo.register,
        commonMistake: wordInfo.commonMistake,
        correctStreak: 0,
        ...(wordInfo.mnemonic ? { mnemonic: wordInfo.mnemonic } : {}),
        ...(wordInfo.wordFamily ? { wordFamily: wordInfo.wordFamily } : {}),
      },
      mediaPromise,
    };
  };

  const persistCardsInternal = async (
    cards: readonly CardData[],
    source: 'generate' | 'shared',
    operationIds = cards.map(createOperationId),
    onSettlementFailure?: (operationId: string) => void,
    awaitSettlements = false,
    onSettlement?: (index: number, outcome: SpreadsheetSaveOutcome) => void,
    onSettlementsReady?: (settlement: Promise<SpreadsheetSaveOutcome[]>) => void,
  ): Promise<Array<{ card: CardData; created: boolean }>> => {
    const current = getContext();
    const session = sessionGuard.capture();
    const candidates = [...cards];
    const ownerId = current.ownerId;
    if (!ownerId) throw classifyProtectedFunctionError({ code: 'unauthenticated' }, 'Card creation');
    if (current.libraryEpoch === null || !db || !isFirebaseConfigured) {
      throw new Error('Cloud library storage is not ready yet. Try again in a moment.');
    }
    const database = db;
    const activeLibraryEpoch = current.libraryEpoch;
    const facetOperationId = createLibraryFacetOperationId();
    const results: Array<{ card: CardData; created: boolean }> = [];
    const cloudSettlements: Array<{
      settle: () => Promise<CreateCardV2IfAbsentResult>;
      candidate: CardData;
      operationId: string;
      index: number;
    }> = [];

    for (const [index, candidate] of candidates.entries()) {
      mediaSessions.set(candidate, session);
      const operationId = operationIds[index]!;
      cloudSettlements.push({
        settle: () => withTimeout(
          createCardV2IfAbsent(database, ownerId, candidate, {
            libraryEpoch: activeLibraryEpoch,
            opId: operationId,
            operationCreatedAt: candidate.createdAt,
            timeZone: rewardTimeZone(),
          }),
          8_000,
          'Saving the card took too long. Try again.',
        ),
        candidate,
        operationId,
        index,
      });
      results.push({ card: candidate, created: true });
      if (source === 'generate') mediaSessions.set(candidate, session);
    }

    const created = results.map(result => result.card);
    if (created.length > 0) {
      assertCurrent(session);
      const active = current;
      created.forEach(active.rememberPromoted);
      const next = retainCardsForSession(
        mergeCards(active.getCards(), created),
        active.cardsPerPage,
      );
      active.publishCards(next);
      active.updateCloudStats(stats => ({
        ...stats,
        total: stats.total + created.length,
        unrated: stats.unrated + created.length,
      }));
      active.updateCloudTotal(total => Math.max(total, active.getCards().length));
      const deltas = created.reduce<Record<string, number>>((counts, card) => {
        const category = card.category || 'Other';
        counts[category] = (counts[category] || 0) + 1;
        return counts;
      }, {});
      void active.updateCategoryFacets(deltas, deriveLibraryFacetOperationId(facetOperationId, 'create'));
      active.resetCatalog();
      active.resetCloudPage();
    }

    const settlements = mapWithConcurrency(cloudSettlements, source === 'shared' ? 2 : 6, async ({ settle, candidate, operationId, index }) => {
      try {
        const result = await settle();
        const outcome: SpreadsheetSaveOutcome = result.created ? 'created' : 'reused';
        onSettlement?.(index, outcome);
        try {
          if (!sessionGuard.isCurrent(session)) return outcome;
          const latest = getContext();
          if (latest.ownerId !== ownerId) return outcome;
          if (result.created && result.gamification) {
            latest.acceptGamificationOutcome?.(result.gamification, operationId);
          }
          if (result.created) return outcome;
          // Someone else already created this word; reconcile the optimistic
          // duplicate with the authoritative card the cloud returned.
          if (!latest.getCards().some(existing => existing.id === result.card.id)) {
            compensateOptimisticDuplicateCard(candidate, latest, facetOperationId);
            const cardToTouch = candidate.customDeck && candidate.customDeck !== result.card.customDeck
              ? await assignExistingDeck(result.card, candidate.customDeck)
              : result.card;
            await touchExisting(cardToTouch, new Date().toISOString());
          }
        } catch (cause) {
          console.warn('The saved card could not be reconciled locally.', cause);
        }
        return outcome;
      } catch (cause) {
        if (onSettlement && cause instanceof OperationTimeoutError) {
          onSettlement?.(index, 'pending');
          return 'pending' as const;
        }
        console.warn('The card could not be saved to the cloud.', cause);
        onSettlementFailure?.(operationId);
        onSettlement?.(index, 'failed');
        if (sessionGuard.isCurrent(session)) {
          const latest = getContext();
          latest.publishCards(latest.getCards().filter(existing => existing.id !== candidate.id));
          latest.setCloudUnavailable(true);
          latest.notify('The card could not be saved. Check your connection and try again.');
        }
        return 'failed' as const;
      }
    });
    onSettlementsReady?.(settlements);
    if (awaitSettlements) {
      const outcomes = await settlements;
      if (source === 'shared') {
        if (outcomes.some(outcome => outcome !== 'created' && outcome !== 'reused')) {
          throw new Error('Some shared cards could not be confirmed.');
        }
        return results.map((result, index) => ({ ...result, created: outcomes[index] === 'created' }));
      }
    } else void settlements;
    return results;
  };

  const persistCards: CardIntakeControllerPort['persistCards'] = async (cards, source) => {
    if (source === 'shared') return persistCardsInternal(cards, source, undefined, undefined, true);
    if (cards.length !== 1) return persistCardsInternal(cards, source);
    const candidate = cards[0];
    const key = `${source}:${candidate.id}:${JSON.stringify(candidate)}`;
    const existing = persistedCardOperations.get(key);
    if (existing && !existing.retryable) return existing.promise;
    const entry = existing ?? {
      operationId: createOperationId(),
      promise: Promise.resolve([]),
      retryable: false,
    };
    entry.retryable = false;
    const promise = persistCardsInternal(cards, source, [entry.operationId], operationId => {
      if (entry.operationId === operationId) entry.retryable = true;
    });
    entry.promise = promise;
    persistedCardOperations.set(key, entry);
    try {
      return await promise;
    } catch (cause) {
      persistedCardOperations.delete(key);
      throw cause;
    }
  };

  const createConfirmedCatalogCards: CardIntakeControllerPort['createConfirmedCatalogCards'] = async (
    cards,
  ): Promise<ConfirmedCatalogCardsResult> => {
    const invalidReason = catalogCardBatchError(cards);
    if (invalidReason) return { status: 'invalid', reason: invalidReason };
    const current = getContext();
    const session = sessionGuard.capture();
    const ownerId = current.ownerId;
    if (!ownerId) throw classifyProtectedFunctionError({ code: 'unauthenticated' }, 'Card creation');
    if (current.libraryEpoch === null || !db || !isFirebaseConfigured) {
      throw new Error('Cloud library storage is not ready yet. Try again in a moment.');
    }
    const database = db;
    const activeLibraryEpoch = current.libraryEpoch;
    const operationIds = cards.map(createOperationId);
    const settlements = await Promise.allSettled(cards.map((card, index) =>
      createCardV2IfAbsent(database, ownerId, card, {
        libraryEpoch: activeLibraryEpoch,
        opId: operationIds[index]!,
        operationCreatedAt: card.createdAt,
        timeZone: rewardTimeZone(),
      }),
    ));
    if (!sessionGuard.isCurrent(session) || getContext().libraryEpoch !== activeLibraryEpoch) return { status: 'stale' };

    const confirmed = settlements.flatMap((settlement, index) => settlement.status === 'fulfilled'
      ? [{
        card: settlement.value.card,
        created: settlement.value.created,
        gamification: settlement.value.gamification,
        operationId: operationIds[index]!,
      }]
      : []);
    const active = getContext();
    if (confirmed.length > 0) {
      const authoritativeCards = confirmed.map(result => result.card);
      authoritativeCards.forEach(active.rememberPromoted);
      active.publishCards(retainCardsForSession(
        mergeCards(active.getCards(), authoritativeCards),
        active.cardsPerPage,
      ));
      const createdCards = confirmed.filter(result => result.created).map(result => result.card);
      if (createdCards.length > 0) {
        active.updateCloudStats(stats => ({
          ...stats,
          total: stats.total + createdCards.length,
          unrated: stats.unrated + createdCards.filter(card => card.difficulty === 'unrated').length,
        }));
        active.updateCloudTotal(total => Math.max(total, active.getCards().length));
        const deltas = createdCards.reduce<Record<string, number>>((counts, card) => {
          const category = card.category || 'Other';
          counts[category] = (counts[category] || 0) + 1;
          return counts;
        }, {});
        const facetOperationId = createLibraryFacetOperationId();
        void active.updateCategoryFacets(
          deltas,
          deriveLibraryFacetOperationId(facetOperationId, 'create'),
        );
        confirmed.forEach(result => {
          if (result.created && result.gamification) {
            active.acceptGamificationOutcome?.(result.gamification, result.operationId);
          }
        });
      }
      active.resetCatalog();
      active.resetCloudPage();
    }
    const authoritativeCards = confirmed.map(result => result.card);
    const failedCount = settlements.length - confirmed.length;
    return failedCount > 0
      ? { status: 'partial', cards: authoritativeCards, failedCount }
      : {
        status: 'completed',
        cards: authoritativeCards,
        createdCount: confirmed.filter(result => result.created).length,
        reusedCount: confirmed.filter(result => !result.created).length,
      };
  };

  const pipeline: CardIntakePipeline = {
    replaceOwner: ownerId => {
      const previousOwnerId = sessionGuard.capture().ownerId;
      sessionGuard.replaceOwner(ownerId);
      if (previousOwnerId !== ownerId) persistedCardOperations.clear();
    },
    captureSession: () => {
      const session = sessionGuard.capture();
      return () => sessionGuard.isCurrent(session);
    },
    findExisting,
    touchExisting,
    assignExistingDeck,
    generateCard,
    persistCards,
    createConfirmedCatalogCards,
    applyMedia: async (card, media) => {
      const session = mediaSessions.get(card);
      if (!session || !sessionGuard.isCurrent(session)) return;
      await getContext().patchCard(card.id, media, card);
    },
    persistStructured: async ({ creates, patches }, onSettlement) => {
      const session = sessionGuard.capture();
      const outcomes: SpreadsheetSaveOutcome[] = [];
      if (creates.length) {
        await persistCardsInternal(
          creates,
          'generate',
          undefined,
          undefined,
          true,
          (index, outcome) => {
            outcomes[index] = outcome;
            onSettlement?.(index, outcome);
          },
        );
      }
      assertCurrent(session);
      for (const [patchIndex, patch] of patches.entries()) {
        const index = creates.length + patchIndex;
        try {
          await getContext().patchCard(patch.card.id, patch.fields, patch.card);
          outcomes[index] = 'reused';
          onSettlement?.(index, 'reused');
        } catch (cause) {
          const outcome: SpreadsheetSaveOutcome = cause instanceof OperationTimeoutError ? 'pending' : 'failed';
          outcomes[index] = outcome;
          onSettlement?.(index, outcome);
        }
        assertCurrent(session);
      }
      return {
        createdCount: outcomes.filter(outcome => outcome === 'created').length,
        outcomes,
      };
    },
    generate: async word => {
      const session = sessionGuard.capture();
      const generated = await generateCard({
        term: word,
        language: getContext().languageProfile ?? ENGLISH_TO_VIETNAMESE_PROFILE,
      });
      assertCurrent(session);
      let settlement!: Promise<SpreadsheetSaveOutcome[]>;
      const [persisted] = await persistCardsInternal(
        [generated.card],
        'generate',
        undefined,
        undefined,
        false,
        () => undefined,
        ready => { settlement = ready; },
      );
      assertCurrent(session);
      void settlement.then(([outcome]) => {
        if (outcome !== 'created' || !persisted?.card) return;
        return settleMediaBestEffort(
          generated.mediaPromise,
          media => pipeline.applyMedia(persisted.card, media),
          cause => console.warn('The card was saved, but its generated media could not be applied.', cause),
        );
      });
      return {
        created: Boolean(persisted?.created),
        category: persisted?.card.category,
        settlement: settlement.then(([outcome]) => outcome ?? 'failed'),
      };
    },
    completeFlat: async () => getContext().resetCloudPage(),
  };

  return pipeline;
}
