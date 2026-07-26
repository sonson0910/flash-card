import { dedupeCardsByNormalizedWord } from './cardIdentity';

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

export function mergeCardsById(existing: readonly unknown[], incoming: readonly unknown[]): StoredCardLike[] {
  const cardsById = new Map<string, StoredCardLike>();
  for (const candidate of existing) {
    if (isStoredCard(candidate)) cardsById.set(candidate.id, candidate);
  }
  for (const candidate of incoming) {
    if (isStoredCard(candidate)) cardsById.set(candidate.id, candidate);
  }
  return dedupeCardsByNormalizedWord(Array.from(cardsById.values()))
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
}
