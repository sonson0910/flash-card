import { cardWordKey, dedupeCardsByNormalizedWord } from './cardIdentity';

export interface StoredCardLike {
  id: string;
  createdAt?: unknown;
  [key: string]: unknown;
}

const isStoredCard = (value: unknown): value is StoredCardLike => Boolean(
  value
  && typeof value === 'object'
  && !Array.isArray(value)
  && typeof (value as { id?: unknown }).id === 'string'
  && (value as { id: string }).id.length > 0,
);

const safeProtocolNumber = (value: unknown): number =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;

export function compareStoredCardVersions(left: unknown, right: unknown): number {
  const leftCard = left && typeof left === 'object' ? left as Record<string, unknown> : {};
  const rightCard = right && typeof right === 'object' ? right as Record<string, unknown> : {};
  const leftEpoch = safeProtocolNumber(leftCard.libraryEpoch);
  const rightEpoch = safeProtocolNumber(rightCard.libraryEpoch);
  if (leftEpoch !== rightEpoch) return leftEpoch < rightEpoch ? -1 : 1;
  const leftRevision = safeProtocolNumber(leftCard.revision);
  const rightRevision = safeProtocolNumber(rightCard.revision);
  if (leftRevision === rightRevision) return 0;
  return leftRevision < rightRevision ? -1 : 1;
}

export function mergeCardsById(existing: readonly unknown[], incoming: readonly unknown[]): StoredCardLike[] {
  const cardsById = new Map<string, StoredCardLike>();
  for (const candidate of existing) {
    if (isStoredCard(candidate)) cardsById.set(candidate.id, candidate);
  }
  for (const candidate of incoming) {
    if (!isStoredCard(candidate)) continue;
    const current = cardsById.get(candidate.id);
    if (!current || compareStoredCardVersions(current, candidate) <= 0) {
      cardsById.set(candidate.id, candidate);
    }
  }
  return dedupeCardsByNormalizedWord(Array.from(cardsById.values()))
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
}

export function reconcileCardsByAuthoritativeWord(
  existing: readonly unknown[],
  authoritative: readonly unknown[],
): StoredCardLike[] {
  const cardsById = new Map<string, StoredCardLike>();
  for (const candidate of existing) {
    if (isStoredCard(candidate)) cardsById.set(candidate.id, candidate);
  }
  for (const candidate of authoritative) {
    if (!isStoredCard(candidate)) continue;
    const sameId = cardsById.get(candidate.id);
    if (sameId && compareStoredCardVersions(sameId, candidate) > 0) continue;
    const wordKey = cardWordKey(candidate);
    if (wordKey) {
      const sameWordCards = [...cardsById.values()].filter(card =>
        card.id !== candidate.id && cardWordKey(card) === wordKey);
      const candidateEpoch = safeProtocolNumber(candidate.libraryEpoch);
      if (sameWordCards.some(card => safeProtocolNumber(card.libraryEpoch) > candidateEpoch)) {
        continue;
      }
      sameWordCards.forEach(card => cardsById.delete(card.id));
    }
    cardsById.set(candidate.id, candidate);
  }
  return dedupeCardsByNormalizedWord(Array.from(cardsById.values()))
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
}
