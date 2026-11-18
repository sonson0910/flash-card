import type { RefObject } from 'react';
import { buildVocabularyImageQuery, fetchImageUrl, isRetryableImageSearchError, isSupportedImageUrl } from '../lib/images';
import { cardWordKey } from '../lib/cardIdentity';
import type { CardData } from '../types/card';
import { useCardMediaHydration } from '../features/library/useCardMediaHydration';
import { hasImageNegativeCache, markImageNegativeCache } from '../features/library/libraryStorage';
import type { LearningWorkspaceActions } from '../features/learning/useLearningWorkspace';
import type { AppLibraryRuntime } from './useAppLibraryRuntime';

interface AppCardMediaHydrationOptions {
  ownerId: string | null;
  cards: readonly CardData[];
  enabled: boolean;
  ports: AppLibraryRuntime['ports'];
  learningActionsRef: RefObject<LearningWorkspaceActions | null>;
}

export function useAppCardMediaHydration({
  ownerId, cards, enabled, ports, learningActionsRef,
}: AppCardMediaHydrationOptions) {
  return useCardMediaHydration({
    ownerKey: ownerId,
    cards,
    enabled,
    port: {
      hasMedia: card => isSupportedImageUrl(card.imageUrl) || hasImageNegativeCache(ownerId, card.id),
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
          if (!isSupportedImageUrl(imageUrl)) {
            markImageNegativeCache(ownerId, card.id);
            return null;
          }
          const imageSearchQuery = card.imageSearchQuery?.trim() || buildVocabularyImageQuery(context);
          return { imageUrl, ...(imageSearchQuery ? { imageSearchQuery } : {}) };
        } catch (cause) {
          if (isRetryableImageSearchError(cause)) throw cause;
          console.warn('The missing card image could not be loaded yet.', cause);
          return null;
        }
      },
      previewCard: (cardId, fields) => ports.setCards(current =>
        current.map(card => card.id === cardId ? { ...card, ...fields } : card)),
      updateCard: async (cardId, fields, options) => {
        const promoted = ports.recentlyPromotedCardsRef.current.get(cardWordKey(options.source));
        if (promoted) {
          ports.recentlyPromotedCardsRef.current.set(cardWordKey(options.source), { ...promoted, ...fields });
        }
        await learningActionsRef.current?.updateCard(cardId, fields, options);
      },
    },
  });
}
