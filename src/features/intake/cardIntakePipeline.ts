import { fetchAudioUrl } from '../../lib/audio';
import { withTimeout } from '../../lib/async';
import { mapWithConcurrency } from '../../lib/asyncPool';
import { cardWordKey, createWordCardId, normalizeCardWord } from '../../lib/cardIdentity';
import { isRetryableCloudError } from '../../lib/cloudError';
import {
  persistCardWithMirrorFallback,
  type CardPersistenceResult,
} from '../../lib/cardCreation';
import {
  deleteMirroredCardIfNotNewerThan,
  findMirroredCardByWord,
  upsertMirroredCardIfNotOlderThan,
} from '../../lib/cardMirror';
import { normalizePartOfSpeech } from '../../lib/cardQuery';
import {
  createCardIfAbsent,
  findCardsByNormalizedWords,
} from '../../lib/cardRepository';
import {
  deleteDeviceCardBackupIfNotNewerThan,
  DeviceBackupOwnerConflictError,
  loadDeviceCards,
  mergeDeviceCards,
  mergeDeviceCardsStrict,
  type DevicePendingOperation,
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
import {
  settleMediaBestEffort,
  type CardGenerationOptions,
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

interface IntakeCloudPersistenceSettlement {
  ownerId: string;
  activeLibraryEpoch: number;
  knownLibraryTotal: number;
  candidate: CardData;
  operation: DevicePendingOperation | undefined;
  result: CardPersistenceResult;
  acknowledgeDevicePending(operations: readonly DevicePendingOperation[]): Promise<void>;
  canPublish(card: CardData): boolean;
  compensateOptimisticDuplicate(card: CardData): void;
  compensatedDuplicateSettlements: Set<string>;
  touchExisting(card: CardData, touchedAt: string): Promise<void>;
  notifyQueued(): void;
  now?: () => string;
}

const safeProtocolNumber = (value: unknown, fallback = 0): number =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fallback;

const optimisticCleanupBoundary = (
  candidate: CardData,
  operation: DevicePendingOperation | undefined,
  activeLibraryEpoch: number,
): { libraryEpoch: number; revision: number } => ({
  libraryEpoch: safeProtocolNumber(operation?.libraryEpoch, safeProtocolNumber(activeLibraryEpoch)),
  revision: safeProtocolNumber(operation?.baseRevision, safeProtocolNumber(candidate.revision)),
});

const isCardProtocolVersionNewer = (candidate: CardData, reference: CardData): boolean => {
  const candidateEpoch = safeProtocolNumber(candidate.libraryEpoch);
  const referenceEpoch = safeProtocolNumber(reference.libraryEpoch);
  return candidateEpoch > referenceEpoch
    || (
      candidateEpoch === referenceEpoch
      && safeProtocolNumber(candidate.revision) > safeProtocolNumber(reference.revision)
    );
};

interface IntakeSettlementPublicationState {
  sessionIsCurrent: boolean;
  ownerId: string;
  activeLibraryEpoch: number;
  operation: DevicePendingOperation | undefined;
  card: CardData;
  optimisticCard: CardData;
  currentOwnerId: string | null;
  currentLibraryEpoch: number | null;
  currentCards: readonly CardData[];
}

export function canPublishIntakeSettlement({
  sessionIsCurrent,
  ownerId,
  activeLibraryEpoch,
  operation,
  card,
  optimisticCard,
  currentOwnerId,
  currentLibraryEpoch,
  currentCards,
}: IntakeSettlementPublicationState): boolean {
  const safeActiveEpoch = safeProtocolNumber(activeLibraryEpoch);
  const operationEpoch = safeProtocolNumber(operation?.libraryEpoch, safeActiveEpoch);
  const cardEpoch = safeProtocolNumber(card.libraryEpoch, operationEpoch);
  return sessionIsCurrent
    && currentOwnerId === ownerId
    && currentLibraryEpoch === safeActiveEpoch
    && operationEpoch === safeActiveEpoch
    && cardEpoch === safeActiveEpoch
    && !currentCards.some(existing =>
      (existing.id === card.id && isCardProtocolVersionNewer(existing, card))
      || (
        optimisticCard.id !== card.id
        && existing.id === optimisticCard.id
        && isCardProtocolVersionNewer(existing, optimisticCard)
      ));
}

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

const duplicateCompensationKey = (
  ownerId: string,
  activeLibraryEpoch: number,
  candidate: CardData,
  authoritativeCard: CardData,
  operation: DevicePendingOperation | undefined,
): string => [
  ownerId,
  safeProtocolNumber(activeLibraryEpoch),
  operation?.opId ?? operation?.updatedAt ?? candidate.createdAt ?? candidate.id,
  candidate.id,
  authoritativeCard.id,
].join('\u001f');

export async function settleIntakeCloudPersistence({
  ownerId,
  activeLibraryEpoch,
  knownLibraryTotal,
  candidate,
  operation,
  result,
  acknowledgeDevicePending,
  canPublish,
  compensateOptimisticDuplicate,
  compensatedDuplicateSettlements,
  touchExisting,
  notifyQueued,
  now = () => new Date().toISOString(),
}: IntakeCloudPersistenceSettlement): Promise<void> {
  if (result.queued) {
    if (canPublish(result.card)) notifyQueued();
    return;
  }

  try {
    await mergeDeviceCardsStrict(
      [result.card],
      Math.max(1, knownLibraryTotal),
      ownerId,
    );
  } catch (cause) {
    if (!(cause instanceof DeviceBackupOwnerConflictError)) throw cause;
  }
  const authoritativeCardMirrored = await upsertMirroredCardIfNotOlderThan(ownerId, result.card);
  if (!result.created && candidate.id !== result.card.id) {
    const maximum = optimisticCleanupBoundary(candidate, operation, activeLibraryEpoch);
    await deleteDeviceCardBackupIfNotNewerThan(ownerId, candidate.id, maximum);
    await deleteMirroredCardIfNotNewerThan(ownerId, candidate.id, maximum);
  }
  if (operation) await acknowledgeDevicePending([operation]);

  if (!authoritativeCardMirrored || !canPublish(result.card)) return;
  if (!result.created) {
    const compensationKey = duplicateCompensationKey(
      ownerId,
      activeLibraryEpoch,
      candidate,
      result.card,
      operation,
    );
    if (!compensatedDuplicateSettlements.has(compensationKey)) {
      compensatedDuplicateSettlements.add(compensationKey);
      compensateOptimisticDuplicate(candidate);
    }
    await touchExisting(result.card, now());
  }
}

export interface CardIntakePipeline extends CardIntakeControllerPort {
  replaceOwner(ownerId: string | null): void;
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
  const compensatedDuplicateSettlements = new Set<string>();

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

  const generateCard: CardIntakeControllerPort['generateCard'] = async (
    word,
    language: LanguageProfile,
    options: CardGenerationOptions = {},
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
    const wordInfo = await generateWordInfo(normalizedWord, {
      context: options.context,
      sourceLanguage: language.source.code,
      targetLanguage: language.target.code,
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
        ...(wordInfo.mnemonic ? { mnemonic: wordInfo.mnemonic } : {}),
        ...(wordInfo.wordFamily ? { wordFamily: wordInfo.wordFamily } : {}),
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
    const results: Array<{ card: CardData; created: boolean }> = [];
    const cloudSettlements: Array<{
      settle: () => Promise<CardPersistenceResult>;
      operation: (typeof pending)[number] | undefined;
      candidate: CardData;
      ownerId: string;
      activeLibraryEpoch: number;
    }> = [];
    let queuedNoticePublished = false;
    const notifyQueued = () => {
      if (queuedNoticePublished) return;
      queuedNoticePublished = true;
      current.setCloudUnavailable(true);
      current.notify('Saved locally; awaiting sync.');
    };
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const result = {
        card: candidate,
        created: true,
        queued: Boolean(current.ownerId),
      };
      mediaSessions.set(candidate, session);
      let cloudAttemptScheduled = false;
      if (current.ownerId && current.libraryEpoch !== null && db && isFirebaseConfigured) {
        const ownerId = current.ownerId;
        const activeLibraryEpoch = current.libraryEpoch;
        const createInCloud = () => withTimeout(
          createCardIfAbsent(db!, ownerId, candidate, { libraryEpoch: activeLibraryEpoch }),
          8_000,
          'Saving the card took too long. It will remain queued on this device.',
        );
        cloudAttemptScheduled = true;
        cloudSettlements.push({
          settle: () => persistCardWithMirrorFallback({
            card: candidate,
            uniquenessVerified: true,
            createInCloud,
          }),
          operation: pending[index],
          candidate,
          ownerId,
          activeLibraryEpoch,
        });
        assertCurrent(session);
      }
      if (current.ownerId && result.queued && !cloudAttemptScheduled) notifyQueued();
      results.push({ card: result.card, created: result.created });
      if (!result.created) {
        await touchExisting(result.card, new Date().toISOString());
        assertCurrent(session);
      } else if (source === 'generate') {
        mediaSessions.set(result.card, session);
      }
    }

    const created = results.flatMap(result => result.created ? [result.card] : []);
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

    void mapWithConcurrency(cloudSettlements, 6, async ({
      settle,
      operation,
      candidate,
      ownerId,
      activeLibraryEpoch,
    }) => {
      try {
        const result = await settle();
        await settleIntakeCloudPersistence({
          ownerId,
          activeLibraryEpoch,
          knownLibraryTotal: optimisticTotal,
          candidate,
          operation,
          result,
          acknowledgeDevicePending: current.acknowledgeDevicePending,
          canPublish: card => {
            const latest = getContext();
            return canPublishIntakeSettlement({
              sessionIsCurrent: sessionGuard.isCurrent(session),
              ownerId,
              activeLibraryEpoch,
              operation,
              card,
              optimisticCard: operation?.type === 'upsert' ? operation.card : candidate,
              currentOwnerId: latest.ownerId,
              currentLibraryEpoch: latest.libraryEpoch,
              currentCards: latest.getCards(),
            });
          },
          compensateOptimisticDuplicate: optimisticCard => {
            compensateOptimisticDuplicateCard(optimisticCard, getContext());
          },
          compensatedDuplicateSettlements,
          touchExisting,
          notifyQueued,
        });
      } catch (cause) {
        console.warn('The local card is safe, but cloud settlement could not finish.', cause);
      }
    });
    return results;
  };

  const pipeline: CardIntakePipeline = {
    replaceOwner: ownerId => sessionGuard.replaceOwner(ownerId),
    findExisting,
    touchExisting,
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
      const generated = await generateCard(word, ENGLISH_TO_VIETNAMESE_PROFILE);
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
