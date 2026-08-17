import { useCallback, useEffect, useRef, type RefObject } from 'react';
import {
  buildVocabularyImageQuery,
  fetchImageUrl,
  isSupportedImageUrl,
  matchesCurrentCardImage,
  matchesCurrentImageOwner,
} from '../lib/images';
import { cardWordKey } from '../lib/cardIdentity';
import { retainCardsForSession } from '../lib/sessionCards';
import type { CardData } from '../types/card';
import { useCardMediaHydration } from '../features/library/useCardMediaHydration';
import { writeLocalCardCache } from '../features/library/libraryStorage';
import type { AppViewMode } from '../features/navigation/useAppNavigation';
import type { LearningWorkspaceActions } from '../features/learning/useLearningWorkspace';
import type { AppLibraryRuntime } from './useAppLibraryRuntime';

interface PracticeCardLookup {
  findCard(cardId: string): CardData | undefined;
}

interface UseAppCardMediaCoordinationOptions {
  ownerKey: string | null;
  cardsOwnerKey: string | null;
  cards: readonly CardData[];
  cardsPerPage: number;
  viewMode: AppViewMode;
  libraryPorts: AppLibraryRuntime['ports'];
  learningActionsRef: RefObject<LearningWorkspaceActions | null>;
  practiceSnapshotRef: RefObject<PracticeCardLookup>;
  reportError(message: string | null): void;
}

const cardImageRejectionKey = (card: CardData) =>
  JSON.stringify([card.id, card.createdAt ?? null]);

export function useAppCardMediaCoordination({
  ownerKey,
  cardsOwnerKey,
  cards,
  cardsPerPage,
  viewMode,
  libraryPorts,
  learningActionsRef,
  practiceSnapshotRef,
  reportError,
}: UseAppCardMediaCoordinationOptions) {
  const ownerKeyRef = useRef(ownerKey);
  const rejectedImageUrlsRef = useRef(new Map<string, Set<string>>());
  ownerKeyRef.current = ownerKey;

  useEffect(() => {
    rejectedImageUrlsRef.current.clear();
  }, [ownerKey]);

  const mediaHydration = useCardMediaHydration({
    ownerKey,
    cards,
    enabled: viewMode === 'library',
    reportError,
    port: {
      hasMedia: card => isSupportedImageUrl(card.imageUrl)
        && !rejectedImageUrlsRef.current.get(cardImageRejectionKey(card))?.has(card.imageUrl),
      fetchMedia: async card => {
        try {
          const context = {
            word: (card.normalizedWord || card.word).trim(),
            searchQuery: card.imageSearchQuery,
            category: card.category,
            partOfSpeech: card.partOfSpeech,
            explanation: card.explanation,
          };
          if (!context.word) return null;
          const imageUrl = await fetchImageUrl(context);
          if (!isSupportedImageUrl(imageUrl)) return null;
          if (rejectedImageUrlsRef.current.get(cardImageRejectionKey(card))?.has(imageUrl)) return null;
          const imageSearchQuery = card.imageSearchQuery?.trim() || buildVocabularyImageQuery(context);
          return { imageUrl, ...(imageSearchQuery ? { imageSearchQuery } : {}) };
        } catch (cause) {
          console.warn('The missing card image could not be loaded yet.', cause);
          return null;
        }
      },
      previewCard: (cardId, fields, options) => {
        const promotedKey = cardWordKey(options.source);
        const promoted = libraryPorts.recentlyPromotedCardsRef.current.get(promotedKey);
        if (promoted) {
          libraryPorts.recentlyPromotedCardsRef.current.set(promotedKey, { ...promoted, ...fields });
        }
        libraryPorts.setCards(current =>
          current.map(card => card.id === cardId ? { ...card, ...fields } : card));
      },
      updateCard: (cardId, fields, options) =>
        learningActionsRef.current?.updateCard(cardId, fields, options) ?? Promise.resolve(),
    },
  });

  const updateCard = useCallback(async (
    cardId: string,
    fields: Partial<CardData>,
    explicitSource?: CardData,
    expectedLifecycle?: string,
  ) => {
    await learningActionsRef.current?.updateCard(cardId, fields, {
      source: explicitSource,
      expectedLifecycle,
    });
  }, [learningActionsRef]);

  const imageUnavailable = useCallback(async (source: CardData, failedImageUrl: string) => {
    if (!matchesCurrentImageOwner(cardsOwnerKey, ownerKeyRef.current)) return;
    const current = libraryPorts.cardsRef.current.find(card => card.id === source.id)
      ?? practiceSnapshotRef.current.findCard(source.id);
    if (!current
      || !matchesCurrentCardImage(current, source.id, failedImageUrl)
      || current.createdAt !== source.createdAt) return;

    const rejectionKey = cardImageRejectionKey(current);
    const rejected = rejectedImageUrlsRef.current.get(rejectionKey) ?? new Set<string>();
    rejected.add(failedImageUrl);
    rejectedImageUrlsRef.current.set(rejectionKey, rejected);
    mediaHydration.actions.invalidateCard(source.id);
    try {
      await mediaHydration.actions.hydrateCard(
        { ...current, imageUrl: null },
        { force: true, allowInactive: true },
      );
    } catch {
      reportError('The card image could not be replaced. Please try again later.');
    }
  }, [cardsOwnerKey, libraryPorts.cardsRef, mediaHydration.actions, practiceSnapshotRef, reportError]);

  const publishCardPatch = useCallback((cardId: string, fields: Partial<CardData>) => {
    libraryPorts.setCards(current => {
      const updated = current.map(card => card.id === cardId ? { ...card, ...fields } : card);
      writeLocalCardCache(retainCardsForSession(updated, Boolean(ownerKey), cardsPerPage), ownerKey);
      return updated;
    });
  }, [cardsPerPage, libraryPorts, ownerKey]);

  return { mediaHydration, updateCard, imageUnavailable, publishCardPatch };
}
