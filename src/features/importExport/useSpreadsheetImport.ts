import type React from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../../lib/firebase';
import { createCardIfAbsent, findCardsByNormalizedWords } from '../../lib/cardRepository';
import { acknowledgeDevicePending, type DevicePendingOperation } from '../../lib/deviceSync';
import type { CardData } from '../../types/card';
import { MAX_AI_CARDS_PER_IMPORT } from '../library/libraryStorage';
import {
  createSpreadsheetImportService,
  indexCardsByNormalizedWord,
  SpreadsheetReadError,
  type SpreadsheetWorkbook,
} from './spreadsheetImportService';

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

interface MediaResult {
  audioUrl: string | null;
  imageUrl: string | null;
}

interface SpreadsheetImportOptions {
  user: { uid: string } | null;
  libraryEpoch: number;
  cards: CardData[];
  knownLibraryTotal: number;
  cloudStats: CloudStats;
  setCloudStats: Dispatch<SetStateAction<CloudStats>>;
  setCards: Dispatch<SetStateAction<CardData[]>>;
  setCurrentPage: Dispatch<SetStateAction<number>>;
  pageCursorsRef: RefObject<Array<QueryDocumentSnapshot | null>>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  setError: Dispatch<SetStateAction<string | null>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setImportProgress: Dispatch<SetStateAction<{ current: number; total: number; word: string } | null>>;
  upsertDeviceCards: (cards: CardData[], nextTotal?: number) => Promise<DevicePendingOperation[]>;
  updateCategoryFacets: (deltas: Record<string, number>) => Promise<void>;
  createCard: (word: string) => Promise<{ card: CardData; mediaPromise: Promise<MediaResult> }>;
  updateCard: (cardId: string, media: Partial<CardData>, sourceCard?: CardData, expectedLifecycle?: string) => Promise<void>;
  getCardUpdateLifecycle: (cardId: string) => string;
  addXp: (amount: number) => void;
}

const loadSpreadsheetWorkbook = async (file: File): Promise<SpreadsheetWorkbook | null> => {
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
};

export function useSpreadsheetImport({
  user,
  libraryEpoch,
  cards,
  knownLibraryTotal,
  cloudStats,
  setCloudStats,
  setCards,
  setCurrentPage,
  pageCursorsRef,
  fileInputRef,
  setError,
  setIsLoading,
  setImportProgress,
  upsertDeviceCards,
  updateCategoryFacets,
  createCard,
  updateCard,
  getCardUpdateLifecycle,
  addXp,
}: SpreadsheetImportOptions) {
  const importer = createSpreadsheetImportService({
    maxAiCards: MAX_AI_CARDS_PER_IMPORT,
    cards: {
      findExisting: async words => {
        const localCards = indexCardsByNormalizedWord(cards);
        if (!isFirebaseConfigured || !db || !user) return localCards;
        const cloudCards = await findCardsByNormalizedWords(db, user.uid, [...words]);
        return new Map([...localCards, ...cloudCards]);
      },

      persistStructured: async ({ creates, patches }) => {
        const nextTotal = Math.max(knownLibraryTotal, cloudStats.total) + creates.length;
        const pendingCreates = await upsertDeviceCards(creates, nextTotal);
        for (const patch of patches) {
          await updateCard(patch.card.id, patch.fields, patch.card);
        }

        let createdCards: CardData[] = creates;
        if (isFirebaseConfigured && db && user) {
          const database = db;
          const ownerId = user.uid;
          const creationResults = [];
          for (let index = 0; index < creates.length; index += 1) {
            const result = await createCardIfAbsent(database, ownerId, creates[index], { libraryEpoch });
            creationResults.push(result);
            const pending = pendingCreates[index];
            if (pending) await acknowledgeDevicePending([pending]);
            if (!result.created) {
              await updateCard(result.card.id, { lastOpenedAt: new Date().toISOString() }, result.card);
            }
          }
          createdCards = creationResults.flatMap(result => result.created ? [result.card] : []);
          pageCursorsRef.current = [null];
          setCurrentPage(1);
          if (createdCards.length > 0) {
            const categoryDeltas = createdCards.reduce<Record<string, number>>((deltas, card) => {
              const category = card.category || 'Other';
              deltas[category] = (deltas[category] || 0) + 1;
              return deltas;
            }, {});
            void updateCategoryFacets(categoryDeltas);
            setCloudStats(previous => ({
              ...previous,
              total: previous.total + createdCards.length,
              unrated: previous.unrated + createdCards.length,
            }));
          }
        } else {
          setCards(previous => {
            const patchedIds = new Set(patches.map(patch => patch.card.id));
            const untouchedCards = previous.filter(card => !patchedIds.has(card.id));
            return [...creates, ...patches.map(patch => patch.card), ...untouchedCards];
          });
        }

        if (createdCards.length > 0) addXp(createdCards.length * 10);
        return { createdCount: createdCards.length };
      },

      touchExisting: async (card, touchedAt) => {
        await updateCard(card.id, { lastOpenedAt: touchedAt }, card);
      },

      generate: async (word, generatedBefore) => {
        const { card: generatedCard, mediaPromise } = await createCard(word);
        const pending = await upsertDeviceCards(
          [generatedCard],
          Math.max(knownLibraryTotal, cloudStats.total) + generatedBefore + 1,
        );
        let createdCard = generatedCard;
        let created = true;

        if (isFirebaseConfigured && db && user) {
          const result = await createCardIfAbsent(db, user.uid, generatedCard, { libraryEpoch });
          createdCard = result.card;
          created = result.created;
          await acknowledgeDevicePending(pending);
          if (!created) {
            await updateCard(result.card.id, { lastOpenedAt: new Date().toISOString() }, result.card);
          }
        }

        if (created) {
          setCards(previous => [createdCard, ...previous.filter(card => card.id !== createdCard.id)]);
          addXp(10);
          const lifecycle = getCardUpdateLifecycle(createdCard.id);
          void mediaPromise.then(media => updateCard(createdCard.id, media, createdCard, lifecycle));
        }
        return { created, category: createdCard.category || 'Other' };
      },

      completeFlat: async ({ successCount, generatedCount, categoryDeltas }) => {
        if (!user || successCount === 0) return;
        if (generatedCount > 0) {
          void updateCategoryFacets(categoryDeltas);
          setCloudStats(previous => ({
            ...previous,
            total: previous.total + generatedCount,
            unrated: previous.unrated + generatedCount,
          }));
        }
        pageCursorsRef.current = [null];
        setCurrentPage(1);
      },
    },
    feedback: {
      start: () => setIsLoading(true),
      clearError: () => setError(null),
      progress: setImportProgress,
      error: setError,
      finish: () => setIsLoading(false),
      resetSource: () => {
        if (fileInputRef.current) fileInputRef.current.value = '';
      },
    },
    diagnostics: {
      itemFailed: (word, error) => console.error(`Failed to generate: ${word}`, error),
      workbookFailed: error => console.error('Excel parse error', error),
    },
  });

  return (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    void importer.import({
      sizeBytes: file.size,
      loadWorkbook: () => loadSpreadsheetWorkbook(file),
    });
  };
}
