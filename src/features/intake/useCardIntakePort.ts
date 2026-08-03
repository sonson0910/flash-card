import { useRef } from 'react';
import { fetchAudioUrl } from '../../lib/audio';
import { withTimeout } from '../../lib/async';
import { cardWordKey, createWordCardId, normalizeCardWord } from '../../lib/cardIdentity';
import { persistCardWithMirrorFallback } from '../../lib/cardCreation';
import { normalizePartOfSpeech } from '../../lib/cardQuery';
import { loadDeviceCards, mergeDeviceCards } from '../../lib/deviceSync';
import { fetchImageUrl } from '../../lib/images';
import {
  createCardIfAbsent,
  findCardsByNormalizedWords,
} from '../../lib/cardRepository';
import {
  findMirroredCardByWord,
  upsertMirroredCardBatch,
} from '../../lib/cardMirror';
import { db, isFirebaseConfigured } from '../../lib/firebase';
import type { CardData } from '../../types/card';
import { canUseDeviceBackupForSession, retainCardsForSession } from '../../lib/sessionCards';
import { promoteExistingCard } from '../library/libraryPresentation';
import {
  normalizeLocalCards,
  readLocalJson,
  waitForInitialMedia,
} from '../library/libraryStorage';
import { indexCardsByNormalizedWord } from '../importExport/spreadsheetImportService';
import { ENGLISH_TO_VIETNAMESE_PROFILE, type LanguageProfile } from '../language/languageProfile';
import type { CardIntakeControllerPort } from './cardIntakeController';
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
    isCurrent: (token: IntakeSessionToken) => token.ownerId === ownerId && token.generation === generation,
  };
};

export class StaleIntakeSessionError extends Error {
  constructor() { super('The intake session changed before this operation completed.'); }
}

export const rethrowIfStaleIntakeSession = (cause: unknown): void => {
  if (cause instanceof StaleIntakeSessionError) throw cause;
};

const mergeCards = (current: readonly CardData[], incoming: readonly CardData[]) => {
  const incomingIds = new Set(incoming.map(card => card.id));
  return [...incoming, ...current.filter(card => !incomingIds.has(card.id))];
};

export function useCardIntakePort(options: CardIntakePortOptions): CardIntakeControllerPort {
  const latestRef = useRef(options);
  latestRef.current = options;
  const sessionGuardRef = useRef<ReturnType<typeof createIntakeSessionGuard> | null>(null);
  if (!sessionGuardRef.current) sessionGuardRef.current = createIntakeSessionGuard(options.ownerId);
  const sessionGuard = sessionGuardRef.current;
  sessionGuard.replaceOwner(options.ownerId);
  const assertCurrent = (token: IntakeSessionToken) => {
    if (!sessionGuard.isCurrent(token)) throw new StaleIntakeSessionError();
  };
  const mediaSessionsRef = useRef(new WeakMap<CardData, IntakeSessionToken>());
  const portRef = useRef<CardIntakeControllerPort | null>(null);

  if (!portRef.current) {
    const findExisting: CardIntakeControllerPort['findExisting'] = async words => {
      const current = latestRef.current;
      const session = sessionGuard.capture();
      const normalizedWords = [...new Set(words.map(normalizeCardWord).filter(Boolean))];
      const local = normalizeLocalCards([
        ...current.getCards(),
        ...readLocalJson<unknown[]>('lingoflash_cards', []),
      ]);
      const matches = indexCardsByNormalizedWord(local);

      if (!current.ownerId) {
        const backup = await loadDeviceCards();
        assertCurrent(session);
        if (backup && (backup.ownerUserId === undefined || canUseDeviceBackupForSession(backup.ownerUserId, null))) {
          for (const [word, card] of indexCardsByNormalizedWord(normalizeLocalCards(backup.cards))) {
            if (!matches.has(word)) matches.set(word, card);
          }
        }
        return new Map(normalizedWords.flatMap(word => matches.has(word) ? [[word, matches.get(word)!]] : []));
      }

      const ownerId = current.ownerId;
      for (const word of normalizedWords) {
        if (matches.has(word)) continue;
        try {
          const mirrored = await findMirroredCardByWord(ownerId, word);
          assertCurrent(session);
          if (mirrored) matches.set(word, mirrored);
        } catch (cause) {
          rethrowIfStaleIntakeSession(cause);
          console.warn('Exact lookup in the local mirror is unavailable.', cause);
        }
      }
      if (db && isFirebaseConfigured) {
        try {
          const cloud = await findCardsByNormalizedWords(db, ownerId, normalizedWords);
          assertCurrent(session);
          cloud.forEach((card, word) => matches.set(word, card));
        } catch (cause) {
          rethrowIfStaleIntakeSession(cause);
          if (normalizedWords.some(word => !matches.has(word))) throw cause;
        }
      }
      return new Map(normalizedWords.flatMap(word => matches.has(word) ? [[word, matches.get(word)!]] : []));
    };

    const touchExisting: CardIntakeControllerPort['touchExisting'] = async (card, touchedAt) => {
      const current = latestRef.current;
      const session = sessionGuard.capture();
      const promotion = promoteExistingCard(card, touchedAt);
      const promoted = promotion.card;
      current.rememberPromoted(promoted);
      if (current.ownerId) {
        void upsertMirroredCardBatch(current.ownerId, [promoted]).catch(cause => {
          console.warn('The existing card was opened, but its mirror could not be refreshed.', cause);
        });
      }
      const next = retainCardsForSession(
        mergeCards(current.getCards().filter(candidate => cardWordKey(candidate) !== cardWordKey(promoted)), [promoted]),
        Boolean(current.ownerId),
        current.cardsPerPage,
      );
      current.publishCards(next);
      localStorage.setItem('lingoflash_cards', JSON.stringify(next));
      await mergeDeviceCards([promoted], current.knownLibraryTotal, current.ownerId);
      assertCurrent(session);
      current.resetCatalog();
      current.notify(`“${promoted.word}” is already in your library. It has been moved to the top of page 1.`);
      current.focusLibrary();
      await current.patchCard(promoted.id, promotion.fields, promoted);
      assertCurrent(session);
      current.hydrateExisting(promoted);
    };

    const generateCard: CardIntakeControllerPort['generateCard'] = async (word, language: LanguageProfile) => {
      const current = latestRef.current;
      const session = sessionGuard.capture();
      if (current.ownerId && current.libraryEpoch === null) {
        throw new Error('Cloud sync safety is not verified yet.');
      }
      if (!import.meta.env.DEV && !current.ownerId) throw new Error('Sign in to generate AI cards.');
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
      const current = latestRef.current;
      const session = sessionGuard.capture();
      const candidates = [...cards];
      const pending = await current.upsertDeviceCards(
        candidates,
        Math.max(current.knownLibraryTotal, current.cloudStats.total) + candidates.length,
      );
      assertCurrent(session);
      const results: Array<{ card: CardData; created: boolean }> = [];
      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        let result = { card: candidate, created: true, queued: false };
        if (current.ownerId && db && isFirebaseConfigured) {
          const ownerId = current.ownerId;
          const createInCloud = () => withTimeout(
            createCardIfAbsent(db!, ownerId, candidate, { libraryEpoch: current.libraryEpoch ?? 0 }),
            8_000,
            'Saving the card took too long. It will remain queued on this device.',
          );
          result = source === 'generate'
            ? await persistCardWithMirrorFallback({ card: candidate, uniquenessVerified: true, createInCloud })
            : { ...await createInCloud(), queued: false };
          assertCurrent(session);
          const operation = pending[index];
          if (!result.queued && operation) {
            await current.acknowledgeDevicePending([operation]);
            assertCurrent(session);
          }
          if (result.queued) {
            current.setCloudUnavailable(true);
            current.notify('Firebase is temporarily unavailable. The card was created locally and will sync automatically.');
          }
        }
        results.push({ card: result.card, created: result.created });
        if (!result.created) {
          await touchExisting(result.card, new Date().toISOString());
          assertCurrent(session);
        } else if (source === 'generate') {
          mediaSessionsRef.current.set(result.card, session);
        }
      }

      const created = results.flatMap(result => result.created ? [result.card] : []);
      if (created.length > 0) {
        assertCurrent(session);
        const active = current;
        const next = retainCardsForSession(
          mergeCards(active.getCards(), created),
          Boolean(active.ownerId),
          active.cardsPerPage,
        );
        active.publishCards(next);
        localStorage.setItem('lingoflash_cards', JSON.stringify(next));
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
          active.resetCloudPage();
        }
      }
      return results;
    };

    portRef.current = {
      findExisting,
      touchExisting,
      generateCard,
      persistCards,
      applyMedia: async (card, media) => {
        const session = mediaSessionsRef.current.get(card);
        if (!session || !sessionGuard.isCurrent(session)) return;
        await latestRef.current.patchCard(card.id, media, card);
      },
      persistStructured: async ({ creates, patches }) => {
        const session = sessionGuard.capture();
        const results = creates.length ? await persistCards(creates, 'generate') : [];
        assertCurrent(session);
        for (const patch of patches) {
          await latestRef.current.patchCard(patch.card.id, patch.fields, patch.card);
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
        if (persisted?.created) void generated.mediaPromise.then(media => portRef.current?.applyMedia(persisted.card, media));
        return { created: Boolean(persisted?.created), category: persisted?.card.category };
      },
      completeFlat: async () => latestRef.current.resetCloudPage(),
    };
  }

  return portRef.current;
}
