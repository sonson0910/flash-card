import { createHash } from 'node:crypto';

export type CleanupCard = Record<string, unknown> & {
  id: string;
  word?: unknown;
  normalizedWord?: unknown;
};

export type DuplicateCleanupPlan = {
  normalizedWord: string;
  primaryId: string;
  strongestSourceId: string;
  loserIds: string[];
  merged: CleanupCard;
  tombstones: Array<{
    cardId: string;
    opId: string;
    libraryEpoch: number;
    revision: number;
    deletedAt: null;
  }>;
};

export function createCanonicalCleanupCardId(normalizedWord: string): string {
  const legacySafeId = `word-${normalizedWord}`;
  if (/^[a-zA-Z0-9_-]+$/.test(normalizedWord) && legacySafeId.length <= 128) {
    return legacySafeId;
  }
  const slug = normalizedWord
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  const hash = createHash('sha256').update(normalizedWord).digest('hex').slice(0, 24);
  return `word-${slug ? `${slug}-` : ''}${hash}`;
}

export function normalizeCleanupWord(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ');
}

const nonNegative = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const progressTuple = (card: CleanupCard): number[] => {
  const fsrs = record(card.fsrs);
  return [
    nonNegative(fsrs.reps),
    nonNegative(card.reviews),
    Array.isArray(card.reviewHistory) ? card.reviewHistory.length : 0,
    nonNegative(card.correctStreak),
    nonNegative(fsrs.stability),
    card.bookmarked === true ? 1 : 0,
    nonNegative(card.revision),
  ];
};

const createdAtTime = (card: CleanupCard): number => {
  if (typeof card.createdAt !== 'string') return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(card.createdAt);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};

const comparePrimary = (left: CleanupCard, right: CleanupCard): number => {
  const leftProgress = progressTuple(left);
  const rightProgress = progressTuple(right);
  for (let index = 0; index < leftProgress.length; index += 1) {
    if (leftProgress[index] !== rightProgress[index]) {
      return rightProgress[index] - leftProgress[index];
    }
  }
  const dateDifference = createdAtTime(left) - createdAtTime(right);
  if (dateDifference !== 0) return dateDifference;
  return left.id.localeCompare(right.id, 'en-US');
};

const firstText = (cards: CleanupCard[], field: string): string | null => {
  for (const card of cards) {
    const value = card[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
};

const cleanupOperationId = (jobId: string, cardId: string): string => {
  const candidate = `duplicate-cleanup-${jobId}-${cardId}`;
  if (candidate.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(candidate)) return candidate;
  const hash = createHash('sha256').update(candidate).digest('hex').slice(0, 24);
  return `duplicate-cleanup-${jobId.slice(0, 48)}-${hash}`.slice(0, 128);
};

export function planDuplicateGroup(
  cards: CleanupCard[],
  context: { jobId: string; libraryEpoch: number },
): DuplicateCleanupPlan | null {
  if (cards.length < 2) return null;
  const normalizedWord = normalizeCleanupWord(cards[0].normalizedWord)
    || normalizeCleanupWord(cards[0].word);
  if (!normalizedWord) return null;
  if (!cards.every(card => (
    normalizeCleanupWord(card.normalizedWord) || normalizeCleanupWord(card.word)
  ) === normalizedWord)) {
    throw new Error('Duplicate cleanup group contains more than one normalized word.');
  }

  const ranked = [...cards].sort(comparePrimary);
  const strongest = ranked[0];
  const canonicalId = createCanonicalCleanupCardId(normalizedWord);
  const canonical = cards.find(card => card.id === canonicalId);
  const losers = cards
    .filter(card => card.id !== canonicalId)
    .sort((left, right) => left.id.localeCompare(right.id, 'en-US'));
  const earliest = [...cards].sort((left, right) => (
    createdAtTime(left) - createdAtTime(right)
  ))[0];
  const earliestCreatedAt = Number.isFinite(createdAtTime(earliest))
    ? new Date(createdAtTime(earliest)).toISOString()
    : undefined;
  const revision = Math.max(
    Math.floor(nonNegative(strongest.revision)),
    Math.floor(nonNegative(canonical?.revision)),
  ) + 1;
  const merged: CleanupCard = {
    ...strongest,
    id: canonicalId,
    normalizedWord,
    schemaVersion: 2,
    revision,
    libraryEpoch: Math.floor(nonNegative(context.libraryEpoch)),
    ...(earliestCreatedAt ? { createdAt: earliestCreatedAt } : {}),
    imageUrl: firstText(ranked, 'imageUrl'),
    audioUrl: firstText(ranked, 'audioUrl'),
    imageSearchQuery: firstText(ranked, 'imageSearchQuery') ?? '',
    bookmarked: cards.some(card => card.bookmarked === true),
  };

  return {
    normalizedWord,
    primaryId: canonicalId,
    strongestSourceId: strongest.id,
    loserIds: losers.map(card => card.id),
    merged,
    tombstones: losers.map(card => ({
      cardId: card.id,
      opId: cleanupOperationId(context.jobId, card.id),
      libraryEpoch: Math.floor(nonNegative(context.libraryEpoch)),
      revision: Math.floor(nonNegative(card.revision)) + 1,
      deletedAt: null,
    })),
  };
}

export function summarizeFacetCounts(cards: CleanupCard[]): Record<string, number> {
  const categories: Record<string, number> = {};
  for (const card of cards) {
    const category = typeof card.category === 'string' && card.category.trim()
      ? card.category.trim().slice(0, 128)
      : 'Other';
    categories[category] = (categories[category] ?? 0) + 1;
    if (Object.keys(categories).length > 500) {
      throw new Error('Facet rebuild exceeded 500 distinct categories.');
    }
  }
  return Object.fromEntries(Object.entries(categories).sort(([left], [right]) => (
    left.localeCompare(right, 'en-US')
  )));
}
