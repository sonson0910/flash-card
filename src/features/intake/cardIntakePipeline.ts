import { fetchAudioUrl } from '../../lib/audio';
import { OperationTimeoutError, withTimeout } from '../../lib/async';
import { mapWithConcurrency } from '../../lib/asyncPool';
import { cardLogicalKey, createTargetAwareCardId, effectiveCardTargetLanguage, normalizeCardWord } from '../../lib/cardIdentity';
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
  type IntakeCard,
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

const compensateOptimisticCard = (
  card: CardData,
  port: OptimisticDuplicateCompensationPort,
  operationId: string | undefined,
  reason: 'duplicate' | 'failed',
  libraryEpoch?: number,
): void => {
  // Each counter takes back exactly what the optimistic create added for this card.
  port.updateCloudStats(stats => ({
    ...stats,
    total: Math.max(0, stats.total - 1),
    unrated: (card.difficulty ?? 'unrated') === 'unrated' ? Math.max(0, stats.unrated - 1) : stats.unrated,
    bookmarked: card.bookmarked ? Math.max(0, stats.bookmarked - 1) : stats.bookmarked,
  }));
  const category = card.category || 'Other';
  const delta = { [category]: -1 };
  const update = operationId
    ? port.updateCategoryFacets(delta, deriveLibraryFacetOperationId(operationId, reason), libraryEpoch)
    : port.updateCategoryFacets(delta);
  void update.catch(cause => {
    console.warn('The card was reconciled, but its category facet needs a refresh.', cause);
  });
  // A duplicate was listed by the service, so the page must be read again. A refused card never was.
  if (reason === 'duplicate') port.resetCloudPage();
};

export function compensateOptimisticDuplicateCard(
  card: CardData,
  port: OptimisticDuplicateCompensationPort,
  operationId?: string,
): void {
  compensateOptimisticCard(card, port, operationId, 'duplicate');
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
  // The card service decides where a card is stored: a word still claimed by an earlier card
  // keeps that card's id. The card shown at once then takes the stored id, so later edits,
  // reviews and media reach the document that exists.
  const storedCardIds = new WeakMap<CardData, string>();
  // What the card service stored for each card shown at once, or null when saving it failed. Media that
  // arrives later patches that card: it carries the epoch and revision the patch is checked against,
  // which the card shown at once does not have.
  const storedCards = new WeakMap<CardData, Promise<CardData | null>>();
  const adoptStoredCardId = (candidate: CardData, storedId: string, latest: CardIntakePortOptions) => {
    const cards = latest.getCards();
    const shown = cards.find(existing =>
      existing.id === candidate.id && cardLogicalKey(existing) === cardLogicalKey(candidate));
    const stored = { ...(shown ?? candidate), id: storedId };
    latest.rememberPromoted(stored);
    if (!shown) return;
    latest.publishCards(cards.flatMap(existing =>
      existing === shown ? [stored] : existing.id === storedId ? [] : [existing]));
  };
  const persistedCardOperations = new Map<string, {
    operationId: string;
    promise: Promise<Array<{ card: CardData; created: boolean }>>;
    retryable: boolean;
  }>();
  const generationOwners = new Map<string, string>();
  const createOperationId = () => normalizeCardOperationId(`create-${globalThis.crypto.randomUUID()}`);

  const findExisting: CardIntakeControllerPort['findExisting'] = async words => {
    const current = getContext();
    const session = sessionGuard.capture();
    const normalizedWords = [...new Set(words.map(word => normalizeCardWord(typeof word === 'string' ? word : word.normalizedWord || word.word)).filter(Boolean))];
    const logicalInputs = words.flatMap(word => {
      if (typeof word === 'string' || (!word.lexemeId && word.language === undefined)) return [];
      const key = word.lexemeId ? `lexeme:${word.lexemeId}` : cardLogicalKey({ id: '', ...word });
      return key ? [[key, word] as const] : [];
    });
    const local = current.getCards().filter(card => belongsToVerifiedLibraryEpoch(card, current.libraryEpoch));
    // A card with the same spelling in another course is a different card: its identity carries the target.
    const targetLanguage = current.languageProfile?.source.code;
    const matches = indexCardsByNormalizedWord(targetLanguage === undefined
      ? local : local.filter(card => effectiveCardTargetLanguage(card) === targetLanguage));
    const logicalMatches = new Map(local.map(card => [cardLogicalKey(card), card]));

    const ownerId = current.ownerId;
    if (!ownerId) {
      throw classifyProtectedFunctionError({ code: 'unauthenticated' }, 'Card lookup');
    }
    if (db && isFirebaseConfigured && current.libraryEpoch !== null) {
      try {
        const cloud = targetLanguage === undefined
          ? await findCardsByNormalizedWords(db, ownerId, normalizedWords, current.libraryEpoch)
          : await findCardsByNormalizedWords(db, ownerId, normalizedWords, current.libraryEpoch, targetLanguage);
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

  // `optimisticId` names the row shown for a create the service answered with `card`, a card
  // stored under another id. That row points at a document that was never written, so it leaves
  // the list in the same publish that brings the stored card forward.
  const touchExisting = async (card: CardData, touchedAt: string, optimisticId?: string): Promise<void> => {
    const current = getContext();
    const shownCards = current.getCards().filter(existing => existing.id !== optimisticId);
    const shownNewer = shownCards.find(existing =>
      existing.id === card.id && isCardProtocolVersionNewer(existing, card));
    if (shownNewer) {
      if (optimisticId === undefined) return;
      current.rememberPromoted(shownNewer);
      current.publishCards(shownCards);
      return;
    }
    const promotion = promoteExistingCard(card, touchedAt);
    const promoted = promotion.card;
    current.rememberPromoted(promoted);
    const next = retainCardsForSession(
      mergeCards(
        shownCards.filter(candidate => cardLogicalKey(candidate) !== cardLogicalKey(promoted)),
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
    const ownerId = current.ownerId;
    if (!ownerId) {
      throw classifyProtectedFunctionError(
        { code: 'unauthenticated' },
        'AI generation',
      );
    }
    const operationId = request.operationId ?? globalThis.crypto.randomUUID();
    generationOwners.set(operationId, ownerId);
    try {
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
      assertCurrent(session);
      if (!available) throw new RequestedDeckUnavailableError(requestedDeck);
    }
    const audioPromise = fetchAudioUrl(normalizedWord);
    const { generateWordInfo, PART_OF_SPEECH_HINTS } = await import('../../lib/gemini');
    assertCurrent(session);
    const generationPartOfSpeech = PART_OF_SPEECH_HINTS.find(hint => hint === partOfSpeechHint);
    const wordInfo = await generateWordInfo(normalizedWord, {
      operationId,
      expectedOwnerId: ownerId,
      ...(request.onProgress ? { onProgress: request.onProgress } : {}),
      ...(request.signal ? { signal: request.signal } : {}),
      context: request.context,
      ...(generationPartOfSpeech ? { partOfSpeech: generationPartOfSpeech } : {}),
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
    // Only a capture from the web (a page address, a page title or a capture time) leaves a source:
    // Web words lists every card that has one, so a context sentence typed in the app must not make it.
    const capturedContext = typeof request.context === 'string' ? request.context.trim() : '';
    const hasSource = Boolean(sourceUrl || pageTitle || request.capturedAt);
    const source = hasSource ? {
      ...(sourceUrl ? { url: sourceUrl } : {}),
      ...(pageTitle ? { title: pageTitle } : {}),
      ...(capturedContext ? { context: capturedContext } : {}),
      capturedAt: request.capturedAt || new Date().toISOString(),
    } : undefined;
    const card: IntakeCard = {
        // The same rule the card service applies, so the card shown at once and the stored
        // document share one id: word-only for English, target-aware for every other language.
        id: createTargetAwareCardId(normalizedWord, request.language.source.code),
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
        ...(wordInfo.translationAlternatives?.length
          ? { translationAlternatives: wordInfo.translationAlternatives }
          : {}),
    };
    return { card, mediaPromise };
    } finally {
      if (generationOwners.get(operationId) === ownerId) generationOwners.delete(operationId);
    }
  };

  const persistCardsInternal = async (
    cards: readonly CardData[],
    source: 'generate' | 'shared',
    operationIds = cards.map(createOperationId),
    onSettlementFailure?: (operationId: string) => void,
    awaitSettlements = false,
    onSettlement?: (index: number, outcome: SpreadsheetSaveOutcome) => void,
    onSettlementsReady?: (settlement: Promise<SpreadsheetSaveOutcome[]>) => void,
    /** A spreadsheet row organises new cards only: a word that already exists keeps its deck. */
    keepExistingDeck = false,
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
      create: () => Promise<CreateCardV2IfAbsentResult>;
      candidate: CardData;
      operationId: string;
      index: number;
    }> = [];

    const storedSettled = new Map<CardData, (stored: CardData | null) => void>();
    for (const [index, candidate] of candidates.entries()) {
      mediaSessions.set(candidate, session);
      storedCards.set(candidate, new Promise<CardData | null>(resolve => storedSettled.set(candidate, resolve)));
      const operationId = operationIds[index]!;
      cloudSettlements.push({
        create: () => createCardV2IfAbsent(database, ownerId, candidate, {
          libraryEpoch: activeLibraryEpoch,
          opId: operationId,
          operationCreatedAt: candidate.createdAt,
          timeZone: rewardTimeZone(),
        }),
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
        unrated: stats.unrated + created.filter(card => (card.difficulty ?? 'unrated') === 'unrated').length,
        bookmarked: stats.bookmarked + created.filter(card => card.bookmarked).length,
      }));
      active.updateCloudTotal(total => Math.max(total, active.getCards().length));
      const deltas = created.reduce<Record<string, number>>((counts, card) => {
        const category = card.category || 'Other';
        counts[category] = (counts[category] || 0) + 1;
        return counts;
      }, {});
      void active.updateCategoryFacets(
        deltas,
        deriveLibraryFacetOperationId(facetOperationId, 'create'),
        activeLibraryEpoch,
      );
      active.resetCatalog();
      active.resetCloudPage();
    }

    const settlements = mapWithConcurrency(cloudSettlements, source === 'shared' ? 1 : 6, async ({ create, candidate, operationId, index }) => {
      const applyResult = async (result: CreateCardV2IfAbsentResult): Promise<SpreadsheetSaveOutcome> => {
        storedSettled.get(candidate)?.(result.card);
        const outcome: SpreadsheetSaveOutcome = result.created ? 'created' : 'reused';
        const storedElsewhere = result.card.id !== candidate.id;
        if (storedElsewhere) storedCardIds.set(candidate, result.card.id);
        onSettlement?.(index, outcome);
        try {
          if (!sessionGuard.isCurrent(session)) return outcome;
          const latest = getContext();
          if (latest.ownerId !== ownerId) return outcome;
          if (result.created && result.gamification) {
            latest.acceptGamificationOutcome?.(result.gamification, operationId);
          }
          if (result.created) {
            if (storedElsewhere) adoptStoredCardId(candidate, result.card.id, latest);
            return outcome;
          }
          // The word already existed: take back the optimistic create and bring the authoritative
          // card forward. Ids are deterministic, so the card shown at once can carry the stored id
          // and still be the optimistic one; only the answer tells the two apart. The compensation
          // id names this call and this card, so every duplicate in a batch is counted once.
          compensateOptimisticCard(candidate, latest, `${facetOperationId}:${operationId}`, 'duplicate', activeLibraryEpoch);
          const cardToTouch = !keepExistingDeck && candidate.customDeck && candidate.customDeck !== result.card.customDeck
            ? await assignExistingDeck(result.card, candidate.customDeck)
            : result.card;
          await touchExisting(cardToTouch, new Date().toISOString(), storedElsewhere ? candidate.id : undefined);
        } catch (cause) {
          console.warn('The saved card could not be reconciled locally.', cause);
        }
        return outcome;
      };
      const refuse = (cause: unknown): SpreadsheetSaveOutcome => {
        storedSettled.get(candidate)?.(null);
        console.warn('The card could not be saved to the cloud.', cause);
        onSettlementFailure?.(operationId);
        onSettlement?.(index, 'failed');
        if (sessionGuard.isCurrent(session)) {
          const latest = getContext();
          latest.forgetPromoted(candidate);
          latest.publishCards(latest.getCards().filter(existing => existing.id !== candidate.id));
          // A refused card never reached the library, so the optimistic counts and facet go back too.
          compensateOptimisticCard(candidate, latest, `${facetOperationId}:${operationId}`, 'failed', activeLibraryEpoch);
          latest.setCloudUnavailable(true);
          latest.notify('The card could not be saved. Check your connection and try again.');
        }
        return 'failed';
      };
      const pendingCreate = (async () => create())();
      try {
        return await applyResult(await withTimeout(pendingCreate, 8_000, 'Saving the card took too long. Try again.'));
      } catch (cause) {
        if (!(cause instanceof OperationTimeoutError)) return refuse(cause);
        if (onSettlement) {
          storedSettled.get(candidate)?.(null);
          onSettlement(index, 'pending');
          return 'pending' as const;
        }
        // The callable is not cancelled and may still commit: keep the optimistic card and take
        // whatever the server answers later, a definite refusal included.
        void pendingCreate.then(applyResult).catch(refuse);
        return 'pending' as const;
      }
    });
    onSettlementsReady?.(settlements);
    if (awaitSettlements) {
      const outcomes = await settlements;
      if (source === 'shared') {
        if (outcomes.some(outcome => outcome !== 'created' && outcome !== 'reused')) {
          throw new Error('Some shared cards could not be confirmed.');
        }
        // A reused card is reported under the id it is stored under, so the caller can study it.
        return results.map((result, index) => {
          const created = outcomes[index] === 'created';
          const storedId = created ? undefined : storedCardIds.get(result.card);
          return { card: storedId ? { ...result.card, id: storedId } : result.card, created };
        });
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
    const settlements = await mapWithConcurrency(cards, 1, async (card, index) => {
      try {
        const value = await createCardV2IfAbsent(database, ownerId, card, {
          libraryEpoch: activeLibraryEpoch,
          opId: operationIds[index]!,
          operationCreatedAt: card.createdAt,
          timeZone: rewardTimeZone(),
        });
        return { status: 'fulfilled' as const, value };
      } catch (reason) {
        return { status: 'rejected' as const, reason };
      }
    });
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
          activeLibraryEpoch,
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
    cancelGeneration: async operationId => {
      const ownerId = generationOwners.get(operationId);
      if (!ownerId) return null;
      const { cancelWordInfoGeneration } = await import('../../lib/gemini');
      return cancelWordInfoGeneration(operationId, ownerId);
    },
    persistCards,
    createConfirmedCatalogCards,
    applyMedia: async (card, media) => {
      const session = mediaSessions.get(card);
      if (!session || !sessionGuard.isCurrent(session)) return;
      const pending = storedCards.get(card);
      const stored = pending ? await pending : undefined;
      // A card that could not be saved has nothing to enrich; the owner may also have changed while waiting.
      if (stored === null || !sessionGuard.isCurrent(session)) return;
      const storedId = storedCardIds.get(card);
      const target = stored ?? (storedId ? { ...card, id: storedId } : card);
      await getContext().patchCard(target.id, media, target);
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
          undefined,
          true,
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
