import { fetchAudioUrl } from '../../lib/audio';
import { cardWordKey, createWordCardId, normalizeCardWord } from '../../lib/cardIdentity';
import { isRetryableCloudError } from '../../lib/cloudError';
import {
  findMirroredCardByWord,
  upsertMirroredCardIfNotOlderThan,
} from '../../lib/cardMirror';
import { normalizePartOfSpeech } from '../../lib/cardQuery';
import { findCardsByNormalizedWords } from '../../lib/cardRepository';
import {
  loadDeviceCards,
  mergeDeviceCards,
  subscribeToPendingCreateSettlements,
  type DevicePendingOperation,
  type PendingCreateSettlement,
} from '../../lib/deviceSync';
import { db, isFirebaseConfigured } from '../../lib/firebase';
import { fetchImageUrl } from '../../lib/images';
import { classifyProtectedFunctionError } from '../../lib/protectedFunctionsCapability';
import {
  canUseDeviceBackupForSession,
  retainCardsForSession,
  selectCardsVisibleForSession,
} from '../../lib/sessionCards';
import type { CardData } from '../../types/card';
import { indexCardsByNormalizedWord } from '../importExport/spreadsheetImportService';
import { ENGLISH_TO_VIETNAMESE_PROFILE, type LanguageProfile } from '../language/languageProfile';
import { promoteExistingCard } from '../library/libraryPresentation';
import {
  normalizeLocalCards,
  readLocalCardCache,
  waitForInitialMedia,
  writeLocalCardCache,
} from '../library/libraryStorage';
import { settleMediaBestEffort, type CardIntakeControllerPort } from './cardIntakeController';
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

interface LocalIntakeCardSelectionOptions {
  currentCards: readonly CardData[];
  cachedCards: unknown;
  cachedOwnerId: string | null | undefined;
  currentOwnerId: string | null;
  libraryEpoch: number | null;
}

const belongsToVerifiedLibraryEpoch = (
  card: CardData,
  libraryEpoch: number | null,
): boolean => libraryEpoch === null
  || card.libraryEpoch === libraryEpoch
  || (libraryEpoch === 0 && card.libraryEpoch === undefined);

export function selectLocalIntakeCards({
  currentCards,
  cachedCards,
  cachedOwnerId,
  currentOwnerId,
  libraryEpoch,
}: LocalIntakeCardSelectionOptions): CardData[] {
  const current = normalizeLocalCards(currentCards)
    .filter(card => belongsToVerifiedLibraryEpoch(card, libraryEpoch));
  const cached = cachedOwnerId === undefined
    ? []
    : selectCardsVisibleForSession(
      normalizeLocalCards(cachedCards),
      cachedOwnerId,
      currentOwnerId,
    ).filter(card => belongsToVerifiedLibraryEpoch(card, libraryEpoch));
  return normalizeLocalCards([...current, ...cached]);
}

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
): void {
  port.addXp(-10);
  port.updateCloudStats(stats => ({
    ...stats,
    total: Math.max(0, stats.total - 1),
    unrated: Math.max(0, stats.unrated - 1),
  }));
  const category = card.category || 'Other';
  void port.updateCategoryFacets({ [category]: -1 }).catch(cause => {
    console.warn('The duplicate was reconciled, but its category facet needs a refresh.', cause);
  });
  port.resetCloudPage();
}

const pendingCreateOperationKey = (
  operation: Extract<DevicePendingOperation, { type: 'upsert' }>,
): string => operation.opId ?? [
  operation.ownerUserId ?? '',
  operation.updatedAt,
  operation.card.id,
].join('\u001f');

export interface CardIntakePipeline extends CardIntakeControllerPort {
  replaceOwner(ownerId: string | null): void;
  settlePendingCreate(settlement: PendingCreateSettlement): Promise<void>;
  dispose(): void;
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
  const mediaTargets = new WeakMap<CardData, CardData>();
  const pendingCreateSessions = new Map<string, {
    session: IntakeSessionToken;
    ownerId: string;
    candidate: CardData;
    settlement?: PendingCreateSettlement;
  }>();
  const unmatchedPendingCreateSettlements = new Map<string, PendingCreateSettlement>();
  const rememberUnmatchedSettlement = (settlement: PendingCreateSettlement) => {
    const key = pendingCreateOperationKey(settlement.operation);
    if (!unmatchedPendingCreateSettlements.has(key)
      && unmatchedPendingCreateSettlements.size >= 128) {
      const oldestKey = unmatchedPendingCreateSettlements.keys().next().value;
      if (oldestKey) unmatchedPendingCreateSettlements.delete(oldestKey);
    }
    unmatchedPendingCreateSettlements.set(key, settlement);
  };

  const findExisting: CardIntakeControllerPort['findExisting'] = async words => {
    const current = getContext();
    const session = sessionGuard.capture();
    const normalizedWords = [...new Set(words.map(normalizeCardWord).filter(Boolean))];
    const belongsToVerifiedEpoch = (card: CardData) =>
      belongsToVerifiedLibraryEpoch(card, current.libraryEpoch);
    const cached = readLocalCardCache();
    const local = selectLocalIntakeCards({
      currentCards: current.getCards(),
      cachedCards: cached.cards,
      cachedOwnerId: cached.ownerId,
      currentOwnerId: current.ownerId,
      libraryEpoch: current.libraryEpoch,
    });
    const matches = indexCardsByNormalizedWord(local);

    if (!current.ownerId) {
      const backup = await loadDeviceCards();
      assertCurrent(session);
      if (
        backup
        && (backup.ownerUserId === undefined || canUseDeviceBackupForSession(backup.ownerUserId, null))
      ) {
        for (const [word, card] of indexCardsByNormalizedWord(normalizeLocalCards(backup.cards))) {
          if (!matches.has(word)) matches.set(word, card);
        }
      }
      return new Map(normalizedWords.flatMap(word =>
        matches.has(word) ? [[word, matches.get(word)!]] : []));
    }

    const ownerId = current.ownerId;
    for (const word of normalizedWords) {
      if (matches.has(word)) continue;
      try {
        const mirrored = await findMirroredCardByWord(ownerId, word);
        assertCurrent(session);
        if (mirrored && belongsToVerifiedEpoch(mirrored)) matches.set(word, mirrored);
      } catch (cause) {
        rethrowIfStaleIntakeSession(cause, sessionGuard.isCurrent(session));
        console.warn('Exact lookup in the local mirror is unavailable.', cause);
      }
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
      } catch (cause) {
        rethrowIfStaleIntakeSession(cause, sessionGuard.isCurrent(session));
        const allWordsFoundLocally = normalizedWords.every(word => matches.has(word));
        if (!canContinueIntakeFromLocalLookup(cause, allWordsFoundLocally)) throw cause;
      }
    }
    return new Map(normalizedWords.flatMap(word =>
      matches.has(word) ? [[word, matches.get(word)!]] : []));
  };

  const touchExisting: CardIntakeControllerPort['touchExisting'] = async (card, touchedAt) => {
    const current = getContext();
    if (current.getCards().some(existing =>
      existing.id === card.id && isCardProtocolVersionNewer(existing, card))) return;
    const promotion = promoteExistingCard(card, touchedAt);
    const promoted = promotion.card;
    current.rememberPromoted(promoted);
    if (current.ownerId) {
      void upsertMirroredCardIfNotOlderThan(current.ownerId, promoted).catch(cause => {
        console.warn('The existing card was opened, but its mirror could not be refreshed.', cause);
      });
    }
    const next = retainCardsForSession(
      mergeCards(
        current.getCards().filter(candidate => cardWordKey(candidate) !== cardWordKey(promoted)),
        [promoted],
      ),
      Boolean(current.ownerId),
      current.cardsPerPage,
    );
    current.publishCards(next);
    current.hydrateExisting(promoted);
    writeLocalCardCache(next, current.ownerId);
    void mergeDeviceCards([promoted], current.knownLibraryTotal, current.ownerId).catch(cause => {
      console.warn('The promoted card could not be copied to the device cache.', cause);
    });
    current.resetCatalog();
    current.resetCloudPage();
    current.notify(`“${promoted.word}” is already in your library. It has been moved to the top of page 1.`);
    current.focusLibrary();
    void current.patchCard(promoted.id, promotion.fields, promoted).catch(cause => {
      console.warn('The promoted card remains visible, but its activity timestamp is waiting to sync.', cause);
    });
  };

  const settleTrackedDuplicate = async (
    key: string,
    tracked: {
      session: IntakeSessionToken;
      ownerId: string;
      candidate: CardData;
      settlement?: PendingCreateSettlement;
    },
  ): Promise<void> => {
    const settlement = tracked.settlement;
    if (!settlement || settlement.outcome !== 'duplicate') return;
    if (!sessionGuard.isCurrent(tracked.session)) {
      pendingCreateSessions.delete(key);
      return;
    }

    const { operation, authoritativeCard } = settlement;
    const current = getContext();
    if (current.ownerId !== tracked.ownerId || operation.ownerUserId !== tracked.ownerId) {
      pendingCreateSessions.delete(key);
      return;
    }
    const currentAuthoritativeCard = current.getCards().find(card =>
      card.id === authoritativeCard.id
      && card.createdAt === authoritativeCard.createdAt
      && isCardProtocolVersionNewer(card, authoritativeCard))
      ?? authoritativeCard;
    const authoritativeEpoch = safeProtocolNumber(
      currentAuthoritativeCard.libraryEpoch,
      safeProtocolNumber(operation.libraryEpoch),
    );
    if (current.libraryEpoch !== authoritativeEpoch) {
      if (current.libraryEpoch !== null && current.libraryEpoch > authoritativeEpoch) {
        pendingCreateSessions.delete(key);
      }
      return;
    }
    const optimisticStillVisible = current.getCards().some(card =>
      card.id === tracked.candidate.id
      && card.createdAt === tracked.candidate.createdAt
      && !isCardProtocolVersionNewer(card, currentAuthoritativeCard));
    pendingCreateSessions.delete(key);
    if (!optimisticStillVisible) return;

    compensateOptimisticDuplicateCard(tracked.candidate, current);
    await touchExisting(currentAuthoritativeCard, new Date().toISOString());
  };

  const settlePendingCreate = async (settlement: PendingCreateSettlement): Promise<void> => {
    const { operation, authoritativeCard, outcome } = settlement;
    const key = pendingCreateOperationKey(operation);
    const tracked = pendingCreateSessions.get(key);
    if (!tracked) {
      if (operation.ownerUserId === sessionGuard.capture().ownerId) {
        rememberUnmatchedSettlement(settlement);
      }
      return;
    }
    if (!sessionGuard.isCurrent(tracked.session)) {
      pendingCreateSessions.delete(key);
      return;
    }
    if (outcome === 'duplicate') {
      mediaSessions.delete(tracked.candidate);
      mediaTargets.delete(tracked.candidate);
      tracked.settlement = settlement;
      await settleTrackedDuplicate(key, tracked);
      return;
    }
    pendingCreateSessions.delete(key);
    mediaTargets.set(tracked.candidate, authoritativeCard);
  };

  const retryTrackedDuplicateSettlements = () => {
    pendingCreateSessions.forEach((tracked, key) => {
      if (!tracked.settlement) return;
      void settleTrackedDuplicate(key, tracked).catch(cause => {
        console.warn('A pending duplicate settlement could not be reconciled locally.', cause);
      });
    });
  };

  const unsubscribePendingCreateSettlements = subscribeToPendingCreateSettlements(settlement => {
    if (settlement.operation.ownerUserId !== sessionGuard.capture().ownerId) return;
    return settlePendingCreate(settlement);
  });

  const generateCard: CardIntakeControllerPort['generateCard'] = async (
    word,
    language: LanguageProfile,
  ) => {
    const current = getContext();
    const session = sessionGuard.capture();
    if (!import.meta.env.DEV && !current.ownerId) {
      throw classifyProtectedFunctionError(
        { code: 'unauthenticated' },
        'AI generation',
      );
    }
    const normalizedWord = language.normalize(word).slice(0, 80);
    const audioPromise = fetchAudioUrl(normalizedWord);
    const { generateWordInfo } = await import('../../lib/gemini');
    const wordInfo = await generateWordInfo(normalizedWord);
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
        customDeck: null,
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
      },
      mediaPromise,
    };
  };

  const persistCards: CardIntakeControllerPort['persistCards'] = async (cards, source) => {
    const current = getContext();
    const session = sessionGuard.capture();
    const candidates = [...cards];
    const optimisticTotal = Math.max(current.knownLibraryTotal, current.cloudStats.total)
      + candidates.length;
    const pending = await current.upsertDeviceCards(candidates, optimisticTotal);
    assertCurrent(session);
    const matchedSettlements: PendingCreateSettlement[] = [];
    const results = candidates.map((candidate, index) => {
      const operation = pending[index];
      if (source === 'generate') mediaSessions.set(candidate, session);
      if (current.ownerId && operation?.type === 'upsert') {
        const key = pendingCreateOperationKey(operation);
        pendingCreateSessions.set(key, {
          session,
          ownerId: current.ownerId,
          candidate,
        });
        const unmatched = unmatchedPendingCreateSettlements.get(key);
        if (unmatched) {
          unmatchedPendingCreateSettlements.delete(key);
          matchedSettlements.push(unmatched);
        }
      }
      return { card: candidate, created: true };
    });
    if (
      current.ownerId
      && (!db || !isFirebaseConfigured || current.libraryEpoch === null)
    ) {
      current.setCloudUnavailable(true);
      current.notify('Saved locally; awaiting sync.');
    }

    const created = results.map(result => result.card);
    if (created.length > 0) {
      assertCurrent(session);
      const active = current;
      created.forEach(active.rememberPromoted);
      const next = retainCardsForSession(
        mergeCards(active.getCards(), created),
        Boolean(active.ownerId),
        active.cardsPerPage,
      );
      active.publishCards(next);
      writeLocalCardCache(next, active.ownerId);
      active.addXp(created.length * 10);
      if (active.ownerId) {
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
        void active.updateCategoryFacets(deltas);
        active.resetCatalog();
        active.resetCloudPage();
      }
    }

    for (const settlement of matchedSettlements) {
      await settlePendingCreate(settlement);
    }
    return results;
  };

  const pipeline: CardIntakePipeline = {
    dispose: () => {
      unsubscribePendingCreateSettlements();
      pendingCreateSessions.clear();
      unmatchedPendingCreateSettlements.clear();
    },
    replaceOwner: ownerId => {
      const previousOwnerId = sessionGuard.capture().ownerId;
      sessionGuard.replaceOwner(ownerId);
      if (ownerId !== previousOwnerId) {
        pendingCreateSessions.clear();
        unmatchedPendingCreateSettlements.clear();
        return;
      }
      retryTrackedDuplicateSettlements();
    },
    settlePendingCreate,
    findExisting,
    touchExisting,
    generateCard,
    persistCards,
    applyMedia: async (card, media) => {
      const session = mediaSessions.get(card);
      if (!session || !sessionGuard.isCurrent(session)) return;
      const target = mediaTargets.get(card) ?? card;
      await getContext().patchCard(target.id, media, target);
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
      const generated = await generateCard(word, ENGLISH_TO_VIETNAMESE_PROFILE);
      assertCurrent(session);
      const [persisted] = await persistCards([generated.card], 'generate');
      assertCurrent(session);
      if (persisted?.created) {
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
