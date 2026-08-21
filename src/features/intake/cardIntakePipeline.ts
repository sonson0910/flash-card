import { fetchAudioUrl } from '../../lib/audio';
import { mapWithConcurrency } from '../../lib/asyncPool';
import { cardWordKey, createWordCardId } from '../../lib/cardIdentity';
import { isRetryableCloudError } from '../../lib/cloudError';
import { normalizePartOfSpeech } from '../../lib/cardQuery';
import { fetchImageUrl } from '../../lib/images';
import { classifyProtectedFunctionError } from '../../lib/protectedFunctionsCapability';
import {
  retainCardsForSession,
} from '../../lib/sessionCards';
import type { CardData } from '../../types/card';
import { ENGLISH_TO_VIETNAMESE_PROFILE } from '../language/languageProfile';
import { promoteExistingCard } from '../library/libraryPresentation';
import {
  waitForInitialMedia,
  writeLocalCardCache,
} from '../library/libraryStorage';
import {
  RequestedDeckUnavailableError,
  StaleIntakeSessionError,
  settleMediaBestEffort,
  type CardGenerationRequest,
  type CardIntakeControllerPort,
} from './cardIntakeController';
import type {
  LibraryReplicaCreateReceipt,
  LibraryReplicaIntakePort,
} from '../librarySession/libraryReplicaIntakeContract';
import type { CardIntakePortOptions } from './cardIntakePortContract';

export { selectLocalIntakeCards } from '../librarySession/libraryReplica';

export { StaleIntakeSessionError } from './cardIntakeController';

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

interface IntakeSettlementPublicationState {
  sessionIsCurrent: boolean;
  ownerId: string;
  activeLibraryEpoch: number;
  optimisticLibraryEpoch?: number;
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
  optimisticLibraryEpoch,
  card,
  optimisticCard,
  currentOwnerId,
  currentLibraryEpoch,
  currentCards,
}: IntakeSettlementPublicationState): boolean {
  const safeActiveEpoch = safeProtocolNumber(activeLibraryEpoch);
  const operationEpoch = safeProtocolNumber(optimisticLibraryEpoch, safeActiveEpoch);
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
  operationId: string | null,
): string => [
  ownerId,
  safeProtocolNumber(activeLibraryEpoch),
  operationId ?? candidate.createdAt ?? candidate.id,
  candidate.id,
  authoritativeCard.id,
].join('\u001f');

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
    const session = sessionGuard.capture();
    const matches = await getContext().libraryReplica.findExisting(words);
    assertCurrent(session);
    return matches;
  };

  const publishExistingPromotion = async (
    card: CardData,
    touchedAt: string,
    settleReplica: boolean,
  ): Promise<void> => {
    const current = getContext();
    if (current.getCards().some(existing =>
      existing.id === card.id && isCardProtocolVersionNewer(existing, card))) return;
    const promotion = promoteExistingCard(card, touchedAt);
    const promoted = promotion.card;
    current.rememberPromoted(promoted);
    if (settleReplica) {
      void current.libraryReplica.settleExisting({
        card: promoted,
        knownLibraryTotal: current.knownLibraryTotal,
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
    current.resetCatalog();
    current.resetCloudPage();
    current.notify(`“${promoted.word}” is already in your library. It has been moved to the top of page 1.`);
    current.focusLibrary();
    void current.patchCard(promoted.id, promotion.fields, promoted).catch(cause => {
      console.warn('The promoted card remains visible, but its activity timestamp is waiting to sync.', cause);
    });
  };

  const touchExisting: CardIntakeControllerPort['touchExisting'] = async (card, touchedAt) => {
    await publishExistingPromotion(card, touchedAt, true);
  };

  const assignExistingDeck: NonNullable<CardIntakeControllerPort['assignExistingDeck']> = async (card, deck) => {
    const current = getContext();
    const session = sessionGuard.capture();
    const assigned = { ...card, customDeck: deck };
    await current.patchCard(card.id, { customDeck: deck }, card);
    assertCurrent(session);
    return assigned;
  };

  const generateCard: CardIntakeControllerPort['generateCard'] = async (
    request: CardGenerationRequest,
  ) => {
    const current = getContext();
    const session = sessionGuard.capture();
    if (!import.meta.env.DEV && !current.ownerId) {
      throw classifyProtectedFunctionError(
        { code: 'unauthenticated' },
        'AI generation',
      );
    }
    const normalizedWord = request.language.normalize(request.term).slice(0, 80);
    const requestedDeck = typeof request.requestedDeck === 'string'
      ? request.requestedDeck.trim().slice(0, 128)
      : '';
    const { generateWordInfo } = await import('../../lib/gemini');
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
    const wordInfo = await generateWordInfo(normalizedWord, {
      context: request.context,
      sourceLanguage: request.language.source.code,
      targetLanguage: request.language.target.code,
      requestedDeck,
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

  const persistCards: CardIntakeControllerPort['persistCards'] = async (cards, source) => {
    const current = getContext();
    const session = sessionGuard.capture();
    const candidates = [...cards];
    const optimisticTotal = Math.max(current.knownLibraryTotal, current.cloudStats.total)
      + candidates.length;
    const receipts = await current.libraryReplica.createIntakeBatch(
      candidates.map(card => ({
        card,
        libraryEpoch: current.libraryEpoch ?? 0,
        knownLibraryTotal: optimisticTotal,
      })),
    );
    assertCurrent(session);
    const stagedContext = getContext();
    if (
      stagedContext.ownerId !== current.ownerId
      || stagedContext.libraryEpoch !== current.libraryEpoch
    ) {
      throw new StaleIntakeSessionError();
    }
    const results: Array<{ card: CardData; created: boolean }> = [];
    const intakeSettlements: Array<{
      settle: () => Promise<Awaited<ReturnType<LibraryReplicaIntakePort['resolveIntake']>>>;
      candidate: CardData;
      receipt: LibraryReplicaCreateReceipt;
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
      const receipt = receipts[index];
      if (!receipt || receipt.status === 'stale') continue;
      mediaSessions.set(candidate, session);
      intakeSettlements.push({
        settle: () => current.libraryReplica.resolveIntake(receipt),
        candidate,
        receipt,
      });
      if (current.ownerId && receipt.status === 'queued' && current.libraryEpoch === null) notifyQueued();
      results.push({ card: candidate, created: true });
      if (source === 'generate') mediaSessions.set(candidate, session);
    }

    const created = results.flatMap(result => result.created ? [result.card] : []);
    if (created.length > 0) {
      assertCurrent(session);
      const active = getContext();
      if (
        active.ownerId !== current.ownerId
        || active.libraryEpoch !== current.libraryEpoch
      ) {
        throw new StaleIntakeSessionError();
      }
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

    void mapWithConcurrency(intakeSettlements, 6, async ({
      settle,
      candidate,
      receipt,
    }) => {
      try {
        const result = await settle();
        const latest = getContext();
        const ownerId = latest.ownerId;
        const activeLibraryEpoch = latest.libraryEpoch ?? receipt.libraryEpoch;
        if (result.queued) {
          if (ownerId && sessionGuard.isCurrent(session)) notifyQueued();
          return;
        }
        if (result.status !== 'existing' || !ownerId) return;
        const canPublish = canPublishIntakeSettlement({
          sessionIsCurrent: sessionGuard.isCurrent(session),
          ownerId,
          activeLibraryEpoch,
          optimisticLibraryEpoch: receipt.libraryEpoch,
          card: result.card,
          optimisticCard: receipt.card,
          currentOwnerId: latest.ownerId,
          currentLibraryEpoch: latest.libraryEpoch,
          currentCards: latest.getCards(),
        });
        if (!canPublish) return;
        const compensationKey = duplicateCompensationKey(
          ownerId,
          activeLibraryEpoch,
          candidate,
          result.card,
          receipt.operationId,
        );
        if (compensatedDuplicateSettlements.has(compensationKey)) return;
        compensatedDuplicateSettlements.add(compensationKey);
        compensateOptimisticDuplicateCard(candidate, latest);
        // `resolveIntake` has already converged the authoritative card and
        // acknowledged the queued create. Only publish the existing-card
        // promotion here; a second mirror/device settlement would duplicate
        // the convergence work this phase centralizes in Library Replica.
        await publishExistingPromotion(result.card, new Date().toISOString(), false);
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
