import type { CardData } from '../types/card';
import { cardWordKey } from './cardIdentity';
import { selectMutableCardPatch } from './cardMutationProtocol';
import { cardMatchesQuery, type CardQueryState } from './cardQuery';
import { mergePendingOperations, type DevicePendingOperation } from './deviceSync';

interface PendingCardOverlayOptions {
  cloudCards: readonly CardData[];
  pendingOperations: readonly DevicePendingOperation[];
  filters: CardQueryState;
  page: number;
  pageSize: number;
}

export function overlayPendingCardsOnPage({
  cloudCards,
  pendingOperations,
  filters,
  page,
  pageSize,
}: PendingCardOverlayOptions): CardData[] {
  const deletedIds = new Set<string>();
  const upsertsById = new Map<string, CardData>();
  const upsertsByWord = new Map<string, CardData>();
  const patchesById = new Map<string, Partial<CardData>>();

  mergePendingOperations([...pendingOperations]).forEach(operation => {
    if (operation.type === 'delete') {
      deletedIds.add(operation.cardId);
      upsertsById.delete(operation.cardId);
      patchesById.delete(operation.cardId);
      return;
    }
    if (operation.type === 'patch') {
      const fieldMask = operation.fieldMask
        ?? Object.keys(operation.fields) as Array<keyof CardData>;
      patchesById.set(
        operation.cardId,
        selectMutableCardPatch(operation.fields, fieldMask),
      );
      return;
    }
    deletedIds.delete(operation.card.id);
    upsertsById.set(operation.card.id, operation.card);
    const wordKey = cardWordKey(operation.card);
    if (wordKey) upsertsByWord.set(wordKey, operation.card);
  });

  const applyPendingPatch = (card: CardData, fallbackCardId?: string): CardData => {
    const patch = patchesById.get(card.id)
      ?? (fallbackCardId ? patchesById.get(fallbackCardId) : undefined);
    return patch ? { ...card, ...patch, id: card.id } : card;
  };

  const representedPendingIds = new Set<string>();
  const resolvedCloudCards = cloudCards.flatMap(cloudCard => {
    if (deletedIds.has(cloudCard.id)) return [];
    const pendingCard = upsertsById.get(cloudCard.id)
      ?? upsertsByWord.get(cardWordKey(cloudCard));
    const visibleCard = applyPendingPatch(pendingCard ?? cloudCard, cloudCard.id);
    if (pendingCard) representedPendingIds.add(pendingCard.id);
    return cardMatchesQuery(visibleCard, filters) ? [visibleCard] : [];
  });

  const pendingCardsForFirstPage = page === 1
    ? [...upsertsByWord.values()]
      .map(pendingCard => applyPendingPatch(pendingCard))
      .filter(pendingCard =>
        !representedPendingIds.has(pendingCard.id)
        && !deletedIds.has(pendingCard.id)
        && cardMatchesQuery(pendingCard, filters))
    : [];

  const uniqueCards: CardData[] = [];
  const seenIdentities = new Set<string>();
  [...pendingCardsForFirstPage, ...resolvedCloudCards].forEach(card => {
    const identity = cardWordKey(card) || card.id;
    if (seenIdentities.has(identity)) return;
    seenIdentities.add(identity);
    uniqueCards.push(card);
  });
  return uniqueCards.slice(0, Math.max(1, Math.floor(pageSize) || 1));
}
