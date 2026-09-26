import { fetchAudioUrl } from '../../lib/audio';
import { withTimeout } from '../../lib/async';
import { mapWithConcurrency } from '../../lib/asyncPool';
import { cardLogicalKey, createWordCardId, normalizeCardWord } from '../../lib/cardIdentity';
import { isRetryableCloudError } from '../../lib/cloudError';
import { normalizePartOfSpeech } from '../../lib/cardQuery';
import {
  createCardIfAbsent,
  createLibraryFacetOperationId,
  deriveLibraryFacetOperationId,
  findCardByNormalizedWord,
  findCardsByNormalizedWords,
  type CreateCardIfAbsentResult,
} from '../../lib/cardRepository';
import { db, isFirebaseConfigured } from '../../lib/firebase';
import { fetchImageUrl } from '../../lib/images';
import { classifyProtectedFunctionError } from '../../lib/protectedFunctionsCapability';
import { retainCardsForSession } from '../../lib/sessionCards';
import type { CardData } from '../../types/card';
import { indexCardsByNormalizedWord } from '../importExport/spreadsheetImportService';
import { ENGLISH_TO_VIETNAMESE_PROFILE } from '../language/languageProfile';
import { promoteExistingCard } from '../library/libraryPresentation';
import { waitForInitialMedia } from '../library/libraryStorage';
import {
  RequestedDeckUnavailableError,
  settleMediaBestEffort,
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
  'addXp' | 'resetCloudPage' | 'updateCategoryFacets' | 'updateCloudStats'
>;

export function compensateOptimisticDuplicateCard(
  card: CardData,
  port: OptimisticDuplicateCompensationPort,
  operationId?: string,
): void {
  port.addXp(-10);
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
  const persistedCardOperations = new Map<
    string,
    Promise<Array<{ card: CardData; created: boolean }>>
  >();

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
    return {
      card: {
        id: createWordCardId(normalizedWord),
        origin: 'ai',
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

  const persistCardsInternal: CardIntakeControllerPort['persistCards'] = async (cards, source) => {
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
      settle: () => Promise<CreateCardIfAbsentResult>;
      candidate: CardData;
    }> = [];

    for (const candidate of candidates) {
      mediaSessions.set(candidate, session);
      cloudSettlements.push({
        settle: () => withTimeout(
          createCardIfAbsent(database, ownerId, candidate, { libraryEpoch: activeLibraryEpoch }),
          8_000,
          'Saving the card took too long. Try again.',
        ),
        candidate,
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
      active.addXp(created.length * 10);
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

    void mapWithConcurrency(cloudSettlements, 6, async ({ settle, candidate }) => {
      try {
        const result = await settle();
        if (!sessionGuard.isCurrent(session)) return;
        const latest = getContext();
        if (latest.ownerId !== ownerId) return;
        if (result.created) return;
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
        console.warn('The card could not be saved to the cloud.', cause);
        if (sessionGuard.isCurrent(session)) {
          const latest = getContext();
          latest.publishCards(latest.getCards().filter(existing => existing.id !== candidate.id));
          latest.setCloudUnavailable(true);
          latest.notify('The card could not be saved. Check your connection and try again.');
        }
      }
    });
    return results;
  };

  const persistCards: CardIntakeControllerPort['persistCards'] = async (cards, source) => {
    if (cards.length !== 1) return persistCardsInternal(cards, source);
    const candidate = cards[0];
    const key = `${source}:${candidate.id}:${JSON.stringify(candidate)}`;
    const existing = persistedCardOperations.get(key);
    if (existing) return existing;
    const operation = persistCardsInternal(cards, source);
    persistedCardOperations.set(key, operation);
    try {
      return await operation;
    } catch (cause) {
      persistedCardOperations.delete(key);
      throw cause;
    }
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
    applyMedia: async (card, media) => {
      const session = mediaSessions.get(card);
      if (!session || !sessionGuard.isCurrent(session)) return;
      await getContext().patchCard(card.id, media, card);
    },
    persistStructured: async ({ creates, patches }) => {
      const session = sessionGuard.capture();
      const results = creates.length ? await persistCards(creates, 'generate') : [];
      assertCurrent(session);
      for (const patch of patches) {
        await getContext().patchCard(patch.card.id, patch.fields, patch.card);
        assertCurrent(session);
      }
      return { createdCount: results.filter(result => result.created).length };
    },
    generate: async word => {
      const session = sessionGuard.capture();
      const generated = await generateCard({ term: word, language: ENGLISH_TO_VIETNAMESE_PROFILE });
      assertCurrent(session);
      const [persisted] = await persistCards([generated.card], 'generate');
      assertCurrent(session);
      if (persisted?.created || (persisted?.card && !persisted.card.imageUrl)) {
        void settleMediaBestEffort(
          generated.mediaPromise,
          media => pipeline.applyMedia(persisted.card, media),
          cause => console.warn('The card was saved, but its generated media could not be applied.', cause),
        );
      }
      return { created: Boolean(persisted?.created), category: persisted?.card.category };
    },
    completeFlat: async () => getContext().resetCloudPage(),
  };

  return pipeline;
}
