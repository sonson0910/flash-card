import type React from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { User } from 'firebase/auth';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import { doc, setDoc, writeBatch } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../../lib/firebase';
import { findCardsByNormalizedWords } from '../../lib/cardRepository';
import { cardWordKey, createWordCardId, normalizeCardWord } from '../../lib/cardIdentity';
import { acknowledgeDevicePending, type DevicePendingOperation } from '../../lib/deviceSync';
import type { CardData } from '../../types/card';
import { MAX_AI_CARDS_PER_IMPORT } from '../library/libraryStorage';
import { extractFlatWords, parseStructuredCardRows } from './spreadsheetModel';

interface CloudStats { total: number; easy: number; good: number; hard: number; unrated: number; bookmarked: number; due: number; legacyUnindexed: number }
interface MediaResult { audioUrl: string | null; imageUrl: string | null }

interface SpreadsheetImportOptions {
  user: User | null;
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
  patchDeviceCards: (changes: readonly { card: CardData; fields: Partial<CardData> }[], nextTotal?: number) => Promise<DevicePendingOperation[]>;
  updateCategoryFacets: (deltas: Record<string, number>) => Promise<void>;
  createCard: (word: string) => Promise<{ card: CardData; mediaPromise: Promise<MediaResult> }>;
  updateCard: (cardId: string, media: Partial<CardData>, sourceCard?: CardData, expectedLifecycle?: string) => Promise<void>;
  getCardUpdateLifecycle: (cardId: string) => string;
  addXp: (amount: number) => void;
}

export function useSpreadsheetImport({
  user, cards, knownLibraryTotal, cloudStats, setCloudStats, setCards, setCurrentPage,
  pageCursorsRef, fileInputRef, setError, setIsLoading, setImportProgress,
  upsertDeviceCards, patchDeviceCards, updateCategoryFacets, createCard, updateCard, getCardUpdateLifecycle, addXp,
}: SpreadsheetImportOptions) {
  const handleUpdateCard = updateCard;
  const handleAddXp = addXp;

  const handleExcelImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('The spreadsheet is too large. Maximum file size is 10 MB.');
      e.target.value = '';
      return;
    }

    // Own the shared mutation guard before FileReader/XLSX begins, not only once parsing finishes.
    setIsLoading(true);
    setError(null);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const bstr = evt.target?.result;
      if (!bstr) {
        setIsLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      
      try {
        const XLSX = await import('@e965/xlsx');
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        
        // Try parsing as structured object first
        const objectData = (XLSX.utils.sheet_to_json(ws) as any[]).slice(0, 5000);
        
        const structuredRows = parseStructuredCardRows(objectData);
        const hasWordColumn = structuredRows.length > 0;

        if (hasWordColumn) {
          setIsLoading(true);
          setError(null);
          
          let successCount = 0;
          const importProcessedSet = new Set<string>();
          const newCardsToSave: CardData[] = [];
          const existingCardsToUpdate: CardData[] = [];
          const importWords = structuredRows.map(row => row.word);
          const cloudExistingCards = isFirebaseConfigured && db && user
            ? await findCardsByNormalizedWords(db, user.uid, importWords)
            : new Map<string, CardData>();
          
          for (const imported of structuredRows) {
            const lowerWord = imported.word;
            if (importProcessedSet.has(lowerWord)) continue;
            
            const existingCard = cloudExistingCards.get(lowerWord) ?? cards.find(c => cardWordKey(c) === lowerWord);
            if (existingCard) {
              existingCardsToUpdate.push({
                ...existingCard,
                createdAt: new Date().toISOString(),
                partOfSpeech: imported.partOfSpeech || existingCard.partOfSpeech,
              });
              importProcessedSet.add(lowerWord);
              successCount++;
              continue;
            }
            
            const newCard: CardData = {
              id: createWordCardId(lowerWord),
              ...imported,
              word: lowerWord,
              normalizedWord: lowerWord,
              createdAt: new Date().toISOString(),
              customDeck: null,
              difficulty: 'unrated',
              bookmarked: false,
            };
            
            newCardsToSave.push(newCard);
            importProcessedSet.add(lowerWord);
            successCount++;
          }
          
          if (newCardsToSave.length > 0 || existingCardsToUpdate.length > 0) {
            const nextTotal = Math.max(knownLibraryTotal, cloudStats.total) + newCardsToSave.length;
            const pendingOperations = [
              ...await upsertDeviceCards(newCardsToSave, nextTotal),
              ...await patchDeviceCards(
                existingCardsToUpdate.map(card => ({
                  card,
                  fields: { createdAt: card.createdAt, partOfSpeech: card.partOfSpeech },
                })),
                nextTotal,
              ),
            ];
            if (isFirebaseConfigured && db && user) {
              const database = db;
              const currentUser = user;
              const operations = [
                ...newCardsToSave.map(card => ({ card, type: 'set' as const })),
                ...existingCardsToUpdate.map(card => ({ card, type: 'update' as const })),
              ];
              for (let offset = 0; offset < operations.length; offset += 450) {
                const batch = writeBatch(database);
                operations.slice(offset, offset + 450).forEach(({ card, type }) => {
                  const cardRef = doc(database, 'users', currentUser.uid, 'cards', card.id);
                  if (type === 'set') batch.set(cardRef, card);
                  else batch.update(cardRef, { createdAt: card.createdAt, partOfSpeech: card.partOfSpeech || '' });
                });
              await batch.commit();
              }
              await acknowledgeDevicePending(pendingOperations);
              pageCursorsRef.current = [null];
              setCurrentPage(1);
              if (newCardsToSave.length > 0) {
                const categoryDeltas = newCardsToSave.reduce<Record<string, number>>((deltas, card) => {
                  const category = card.category || 'Other';
                  deltas[category] = (deltas[category] || 0) + 1;
                  return deltas;
                }, {});
                void updateCategoryFacets(categoryDeltas);
                setCloudStats(previous => ({
                  ...previous,
                  total: previous.total + newCardsToSave.length,
                  unrated: previous.unrated + newCardsToSave.length,
                }));
              }
            } else {
              setCards(prev => {
                const updatedIds = new Set(existingCardsToUpdate.map(c => c.id));
                const filtered = prev.filter(c => !updatedIds.has(c.id));
                return [...newCardsToSave, ...existingCardsToUpdate, ...filtered];
              });
            }
            if (newCardsToSave.length > 0) {
              handleAddXp(newCardsToSave.length * 10);
            }
          }
          
          if (successCount === 0) {
            setError('No new words found to import from structured excel.');
          }
          setIsLoading(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
        }

        // Fallback to old flat word list generation
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
        const words = extractFlatWords(data);

        if (words.length === 0) {
          setError('No words found in the Excel file.');
          return;
        }

        setIsLoading(true);
        setError(null);
        
        let successCount = 0;
        let generatedCount = 0;
        let skippedForAiLimit = 0;
        const generatedCategoryDeltas: Record<string, number> = {};
        const importProcessedSet = new Set<string>();
        const cloudExistingCards = isFirebaseConfigured && db && user
          ? await findCardsByNormalizedWords(db, user.uid, words)
          : new Map<string, CardData>();

        for (let i = 0; i < words.length; i++) {
          const word = words[i];
          setImportProgress({ current: i + 1, total: words.length, word });
          
          const lowerWord = normalizeCardWord(word);
          if (importProcessedSet.has(lowerWord)) continue;
          
          const existingCard = cloudExistingCards.get(lowerWord) ?? cards.find(c => cardWordKey(c) === lowerWord);
          if (existingCard) {
            const updatedCard = { ...existingCard, createdAt: new Date().toISOString() };
            await handleUpdateCard(existingCard.id, { createdAt: updatedCard.createdAt }, existingCard);
            importProcessedSet.add(lowerWord);
            successCount++;
            continue;
          }

          if (generatedCount >= MAX_AI_CARDS_PER_IMPORT) {
            skippedForAiLimit += 1;
            continue;
          }
          
          try {
            const { card: newCard, mediaPromise } = await createCard(word);
            const pendingOperations = await upsertDeviceCards([newCard], Math.max(knownLibraryTotal, cloudStats.total) + generatedCount + 1);
            if (isFirebaseConfigured && db && user) {
              await setDoc(doc(db, 'users', user.uid, 'cards', newCard.id), newCard);
              await acknowledgeDevicePending(pendingOperations);
            } else {
              setCards(prev => [newCard, ...prev]);
            }
            handleAddXp(10); // Reward for importing card
            const mediaLifecycle = getCardUpdateLifecycle(newCard.id);
            void mediaPromise.then(media => handleUpdateCard(newCard.id, media, newCard, mediaLifecycle));
            importProcessedSet.add(lowerWord);
            successCount++;
            generatedCount++;
            const generatedCategory = newCard.category || 'Other';
            generatedCategoryDeltas[generatedCategory] = (generatedCategoryDeltas[generatedCategory] || 0) + 1;
            
            // 2.5s delay to strictly avoid Gemini rate limits (429 Too Many Requests)
            if (i < words.length - 1) {
              await new Promise(r => setTimeout(r, 2500));
            }
          } catch (err) {
            console.error(`Failed to generate: ${word}`, err);
          }
        }
        if (user && successCount > 0) {
          if (generatedCount > 0) {
            void updateCategoryFacets(generatedCategoryDeltas);
            setCloudStats(previous => ({
              ...previous,
              total: previous.total + generatedCount,
              unrated: previous.unrated + generatedCount,
            }));
          }
          pageCursorsRef.current = [null];
          setCurrentPage(1);
        }
        
        if (skippedForAiLimit > 0) {
          setError(`Created the safe limit of ${MAX_AI_CARDS_PER_IMPORT} AI cards in one import; ${skippedForAiLimit} words were left for a later batch.`);
        } else if (successCount === 0 && words.length > 0) {
          setError('Failed to import some or all words. Rate limits or connectivity issues might have occurred.');
        }
        setImportProgress(null);
      } catch (err) {
        console.error('Excel parse error', err);
        setError('Failed to parse Excel file.');
      } finally {
        setIsLoading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.onerror = () => {
      setError('Failed to read the Excel file.');
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsBinaryString(file);
  };


  return handleExcelImport;
}
