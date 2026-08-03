import { useRef } from 'react';
import { fetchAudioUrl } from '../../lib/audio';
import { withTimeout } from '../../lib/async';
import { cardWordKey, createWordCardId, normalizeCardWord } from '../../lib/cardIdentity';
import { persistCardWithMirrorFallback } from '../../lib/cardCreation';
import { normalizePartOfSpeech } from '../../lib/cardQuery';
import { loadDeviceCards, mergeDeviceCards, type DevicePendingOperation } from '../../lib/deviceSync';
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
import { SpreadsheetReadError, type SpreadsheetImportRequest } from '../importExport/spreadsheetImportService';
import { ENGLISH_TO_VIETNAMESE_PROFILE, type LanguageProfile } from '../language/languageProfile';
import type { CardIntakeControllerPort } from './cardIntakeController';

interface CloudStats {
  total: number;
  easy: number;
  good: number;
  hard: number;
  unrated: number;
  bookmarked: number;
  due: number;
  legacyUnindexed: number;
}

export interface CardIntakePortOptions {
  ownerId: string | null;
  libraryEpoch: number | null;
  knownLibraryTotal: number;
  cloudStats: CloudStats;
  cardsPerPage: number;
  getCards(): CardData[];
  publishCards(cards: CardData[]): void;
  upsertDeviceCards(cards: CardData[], nextTotal?: number): Promise<DevicePendingOperation[]>;
  acknowledgeDevicePending(operations: readonly DevicePendingOperation[]): Promise<void>;
  patchCard(cardId: string, fields: Partial<CardData>, source?: CardData): Promise<void>;
  hydrateExisting(card: CardData): void;
  rememberPromoted(card: CardData): void;
  resetCatalog(): void;
  resetCloudPage(): void;
  updateCloudStats(update: (current: CloudStats) => CloudStats): void;
  updateCloudTotal(update: (current: number) => number): void;
  updateCategoryFacets(deltas: Record<string, number>): Promise<void>;
  setCloudUnavailable(unavailable: boolean): void;
  notify(message: string): void;
  focusLibrary(): void;
  addXp(amount: number): void;
}

const mergeCards = (current: readonly CardData[], incoming: readonly CardData[]) => {
  const incomingIds = new Set(incoming.map(card => card.id));
  return [...incoming, ...current.filter(card => !incomingIds.has(card.id))];
};

export const spreadsheetRequestFromFile = (file: File): SpreadsheetImportRequest => ({
  sizeBytes: file.size,
  loadWorkbook: async () => {
    const binary = await new Promise<string | null>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = event => resolve(typeof event.target?.result === 'string' ? event.target.result : null);
      reader.onerror = () => reject(new SpreadsheetReadError());
      reader.readAsBinaryString(file);
    });
    if (!binary) return null;
    const XLSX = await import('@e965/xlsx');
    const workbook = XLSX.read(binary, { type: 'binary' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    return {
      structuredRows: XLSX.utils.sheet_to_json(worksheet) as unknown[],
      flatRows: XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][],
    };
  },
});

export function useCardIntakePort(options: CardIntakePortOptions): CardIntakeControllerPort {
  const latestRef = useRef(options);
  latestRef.current = options;
  const portRef = useRef<CardIntakeControllerPort | null>(null);

  if (!portRef.current) {
    const findExisting: CardIntakeControllerPort['findExisting'] = async words => {
      const current = latestRef.current;
      const normalizedWords = [...new Set(words.map(normalizeCardWord).filter(Boolean))];
      const local = normalizeLocalCards([
        ...current.getCards(),
        ...readLocalJson<unknown[]>('lingoflash_cards', []),
      ]);
      const matches = indexCardsByNormalizedWord(local);

      if (!current.ownerId) {
        const backup = await loadDeviceCards();
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
          if (mirrored) matches.set(word, mirrored);
        } catch (cause) {
          console.warn('Exact lookup in the local mirror is unavailable.', cause);
        }
      }
      if (db && isFirebaseConfigured) {
        try {
          const cloud = await findCardsByNormalizedWords(db, ownerId, normalizedWords);
          cloud.forEach((card, word) => matches.set(word, card));
        } catch (cause) {
          if (normalizedWords.some(word => !matches.has(word))) throw cause;
        }
      }
      return new Map(normalizedWords.flatMap(word => matches.has(word) ? [[word, matches.get(word)!]] : []));
    };

    const touchExisting: CardIntakeControllerPort['touchExisting'] = async (card, touchedAt) => {
      const current = latestRef.current;
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
      current.resetCatalog();
      current.notify(`“${promoted.word}” is already in your library. It has been moved to the top of page 1.`);
      current.focusLibrary();
      await current.patchCard(promoted.id, promotion.fields, promoted);
      current.hydrateExisting(promoted);
    };

    const generateCard: CardIntakeControllerPort['generateCard'] = async (word, language: LanguageProfile) => {
      const current = latestRef.current;
      if (current.ownerId && current.libraryEpoch === null) {
        throw new Error('Cloud sync safety is not verified yet.');
      }
      if (!import.meta.env.DEV && !current.ownerId) throw new Error('Sign in to generate AI cards.');
      const normalizedWord = language.normalize(word).slice(0, 80);
      const audioPromise = fetchAudioUrl(normalizedWord);
      const { generateWordInfo } = await import('../../lib/gemini');
      const wordInfo = await generateWordInfo(normalizedWord);
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
      const candidates = [...cards];
      const pending = await current.upsertDeviceCards(
        candidates,
        Math.max(current.knownLibraryTotal, current.cloudStats.total) + candidates.length,
      );
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
          const operation = pending[index];
          if (!result.queued && operation) await current.acknowledgeDevicePending([operation]);
          if (result.queued) {
            current.setCloudUnavailable(true);
            current.notify('Firebase is temporarily unavailable. The card was created locally and will sync automatically.');
          }
        }
        results.push({ card: result.card, created: result.created });
        if (!result.created) await touchExisting(result.card, new Date().toISOString());
      }

      const created = results.flatMap(result => result.created ? [result.card] : []);
      if (created.length > 0) {
        const active = latestRef.current;
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
      applyMedia: (card, media) => latestRef.current.patchCard(card.id, media, card),
      persistStructured: async ({ creates, patches }) => {
        const results = creates.length ? await persistCards(creates, 'generate') : [];
        for (const patch of patches) {
          await latestRef.current.patchCard(patch.card.id, patch.fields, patch.card);
        }
        return { createdCount: results.filter(result => result.created).length };
      },
      generate: async word => {
        const generated = await generateCard(word, ENGLISH_TO_VIETNAMESE_PROFILE);
        const [persisted] = await persistCards([generated.card], 'generate');
        if (persisted?.created) void generated.mediaPromise.then(media => portRef.current?.applyMedia(persisted.card, media));
        return { created: Boolean(persisted?.created), category: persisted?.card.category };
      },
      completeFlat: async () => latestRef.current.resetCloudPage(),
    };
  }

  return portRef.current;
}
