import type { CardData } from '../types/card';
import {
  buildVocabularyImageQuery,
  isSupportedImageUrl,
  type VocabularyImageContext,
} from './images';

interface HydrateMissingCardImageOptions {
  card: CardData;
  force?: boolean;
  scopeKey?: string;
  attemptedCardIds: Set<string>;
  inFlightRequests: Map<string, Promise<Partial<CardData> | null>>;
  fetchImage: (context: VocabularyImageContext) => Promise<string | null>;
  canPersist?: () => boolean;
  persistUpdate: (card: CardData, updates: Partial<CardData>) => void | Promise<void>;
}

export async function hydrateMissingCardImage({
  card,
  force = false,
  scopeKey,
  attemptedCardIds,
  inFlightRequests,
  fetchImage,
  canPersist,
  persistUpdate,
}: HydrateMissingCardImageOptions): Promise<Partial<CardData> | null> {
  const operationKey = scopeKey ? `${scopeKey}:${card.id}` : card.id;
  if (isSupportedImageUrl(card.imageUrl)) return null;
  const existingRequest = inFlightRequests.get(operationKey);
  if (existingRequest) {
    try {
      const existingResult = await existingRequest;
      if (existingResult || !force) return existingResult;
    } catch (error) {
      if (!force) throw error;
    }
  }
  if (!force && attemptedCardIds.has(operationKey)) return null;

  attemptedCardIds.add(operationKey);
  const request = (async (): Promise<Partial<CardData> | null> => {
    const context: VocabularyImageContext = {
      word: (card.normalizedWord || card.word).trim(),
      searchQuery: card.imageSearchQuery,
      category: card.category,
      partOfSpeech: card.partOfSpeech,
      explanation: card.explanation,
    };
    if (!context.word) return null;
    const imageUrl = await fetchImage(context);
    if (!isSupportedImageUrl(imageUrl)) return null;
    if (canPersist && !canPersist()) return null;
    const imageSearchQuery = card.imageSearchQuery?.trim()
      || buildVocabularyImageQuery(context);
    const updates: Partial<CardData> = {
      imageUrl,
      ...(imageSearchQuery ? { imageSearchQuery } : {}),
    };
    await persistUpdate(card, updates);
    return updates;
  })();
  inFlightRequests.set(operationKey, request);
  try {
    return await request;
  } finally {
    if (inFlightRequests.get(operationKey) === request) {
      inFlightRequests.delete(operationKey);
    }
  }
}
