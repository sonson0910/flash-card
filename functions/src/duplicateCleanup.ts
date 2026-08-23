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

export const nextSafeRevision = (value: number, field: string): number => {
  if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`${field} cannot be advanced beyond the maximum safe integer.`);
  }
  return value + 1;
};

const boundedEaseFactor = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 5
    ? value
    : 2.5;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const boundedText = (value: unknown, maximum: number, fallback = ''): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : fallback;

const boundedList = (value: unknown): string[] => Array.isArray(value)
  ? value.slice(0, 4).flatMap(item => {
    const text = boundedText(item, 100);
    return text ? [text] : [];
  })
  : [];

const validIsoText = (value: unknown): string | null => {
  if (
    value
    && typeof value === 'object'
    && 'toDate' in value
    && typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    try {
      const converted = (value as { toDate(): unknown }).toDate();
      return converted instanceof Date && Number.isFinite(converted.getTime())
        ? converted.toISOString()
        : null;
    } catch {
      return null;
    }
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
};

const trustedUrl = (
  value: unknown,
  allowedHosts: ReadonlySet<string>,
): string | null => {
  if (typeof value !== 'string' || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && allowedHosts.has(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
};

const trustedAudioHosts = new Set(['api.dictionaryapi.dev', 'ssl.gstatic.com']);
const trustedImageHosts = new Set([
  'images.pexels.com',
  'images.unsplash.com',
  'upload.wikimedia.org',
]);
const validReviewRatings = new Set(['again', 'hard', 'good', 'easy']);

const firstTrustedUrl = (
  cards: CleanupCard[],
  field: string,
  hosts: ReadonlySet<string>,
): string | null => {
  for (const card of cards) {
    const url = trustedUrl(card[field], hosts);
    if (url) return url;
  }
  return null;
};

const sanitizedFsrs = (value: unknown): Record<string, unknown> | null => {
  const source = record(value);
  const due = validIsoText(source.due);
  const lastReview = source.lastReview === undefined ? null : validIsoText(source.lastReview);
  const nonNegativeNumbers = ['stability', 'difficulty', 'elapsedDays', 'scheduledDays', 'learningSteps'] as const;
  if (
    !due
    || (source.lastReview !== undefined && !lastReview)
    || !nonNegativeNumbers.every(key => (
      typeof source[key] === 'number' && Number.isFinite(source[key]) && Number(source[key]) >= 0
    ))
    || Number(source.difficulty) > 10
    || !Number.isSafeInteger(source.reps) || Number(source.reps) < 0
    || !Number.isSafeInteger(source.lapses) || Number(source.lapses) < 0
    || !Number.isSafeInteger(source.state) || Number(source.state) < 0 || Number(source.state) > 3
  ) return null;
  return {
    due,
    stability: source.stability,
    difficulty: source.difficulty,
    elapsedDays: source.elapsedDays,
    scheduledDays: source.scheduledDays,
    learningSteps: source.learningSteps,
    reps: source.reps,
    lapses: source.lapses,
    state: source.state,
    ...(lastReview ? { lastReview } : {}),
  };
};

const sanitizedReviewHistory = (value: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => {
    const review = record(entry);
    const reviewedAt = validIsoText(review.reviewedAt);
    if (
      typeof review.rating !== 'string'
      || !validReviewRatings.has(review.rating)
      || !reviewedAt
      || typeof review.scheduledDays !== 'number'
      || !Number.isFinite(review.scheduledDays)
      || review.scheduledDays < 0
      || typeof review.elapsedDays !== 'number'
      || !Number.isFinite(review.elapsedDays)
      || review.elapsedDays < 0
    ) return [];
    return [{
      rating: review.rating,
      reviewedAt,
      scheduledDays: review.scheduledDays,
      elapsedDays: review.elapsedDays,
    }];
  }).slice(-100);
};

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
  const timestamp = card.createdAt;
  if (
    timestamp
    && typeof timestamp === 'object'
    && 'toDate' in timestamp
    && typeof (timestamp as { toDate?: unknown }).toDate === 'function'
  ) {
    try {
      const converted = (timestamp as { toDate(): unknown }).toDate();
      return converted instanceof Date && Number.isFinite(converted.getTime())
        ? converted.getTime()
        : Number.POSITIVE_INFINITY;
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }
  if (typeof timestamp !== 'string') return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(timestamp);
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
  return planLegacyIdentityGroup(cards, context);
}

export function planLegacyIdentityGroup(
  cards: CleanupCard[],
  context: { jobId: string; libraryEpoch: number },
): DuplicateCleanupPlan {
  if (cards.length === 0) {
    throw new Error('Legacy migration group requires at least one card.');
  }
  const normalizedWord = normalizeCleanupWord(cards[0].normalizedWord)
    || normalizeCleanupWord(cards[0].word);
  if (!normalizedWord || normalizedWord.length > 256) {
    throw new Error('Legacy migration group requires a valid normalized word.');
  }
  if (!cards.every(card => (
    normalizeCleanupWord(card.normalizedWord) || normalizeCleanupWord(card.word)
  ) === normalizedWord)) {
    throw new Error('Duplicate cleanup group contains more than one normalized word.');
  }

  const ranked = [...cards].sort(comparePrimary);
  const strongest = ranked[0];
  const canonicalId = createCanonicalCleanupCardId(normalizedWord);
  const losers = cards
    .filter(card => card.id !== canonicalId)
    .sort((left, right) => left.id.localeCompare(right.id, 'en-US'));
  const earliest = [...cards].sort((left, right) => (
    createdAtTime(left) - createdAtTime(right)
  ))[0];
  const earliestCreatedAt = Number.isFinite(createdAtTime(earliest))
    ? new Date(createdAtTime(earliest)).toISOString()
    : new Date(0).toISOString();
  const revision = nextSafeRevision(
    Math.max(...cards.map(card => Math.floor(nonNegative(card.revision)))),
    'Card revision',
  );
  const validDifficulty = ['easy', 'good', 'hard', 'unrated'].includes(String(strongest.difficulty))
    ? strongest.difficulty
    : 'unrated';
  const customDeck = typeof strongest.customDeck === 'string' && strongest.customDeck.trim()
    ? strongest.customDeck.trim().slice(0, 128)
    : null;
  const nextReviewDate = validIsoText(strongest.nextReviewDate);
  const lastOpenedAt = validIsoText(strongest.lastOpenedAt);
  const sortTouchedAt = validIsoText(strongest.sortTouchedAt);
  const fsrs = sanitizedFsrs(strongest.fsrs);
  const merged: CleanupCard = {
    id: canonicalId,
    word: normalizedWord,
    normalizedWord,
    translation: boundedText(strongest.translation, 256),
    explanation: boundedText(strongest.explanation, 2_048),
    explanationTranslation: boundedText(strongest.explanationTranslation, 2_048),
    phonetic: boundedText(strongest.phonetic, 256),
    category: boundedText(strongest.category, 128, 'Other') || 'Other',
    emoji: boundedText(strongest.emoji, 64, '📝') || '📝',
    audioUrl: firstTrustedUrl(ranked, 'audioUrl', trustedAudioHosts),
    imageUrl: firstTrustedUrl(ranked, 'imageUrl', trustedImageHosts),
    imageSearchQuery: boundedText(firstText(ranked, 'imageSearchQuery'), 120),
    createdAt: earliestCreatedAt,
    ...(lastOpenedAt ? { lastOpenedAt } : {}),
    ...(sortTouchedAt ? { sortTouchedAt } : {}),
    bookmarked: cards.some(card => card.bookmarked === true),
    customDeck,
    difficulty: validDifficulty,
    ...(nextReviewDate ? { nextReviewDate } : {}),
    reviews: Math.floor(nonNegative(strongest.reviews)),
    interval: nonNegative(strongest.interval),
    easeFactor: boundedEaseFactor(strongest.easeFactor),
    correctStreak: Math.floor(nonNegative(strongest.correctStreak)),
    partOfSpeech: boundedText(strongest.partOfSpeech, 64),
    cefrLevel: boundedText(strongest.cefrLevel, 8),
    exampleSentence: boundedText(strongest.exampleSentence, 2_048),
    exampleTranslation: boundedText(strongest.exampleTranslation, 2_048),
    collocations: boundedList(strongest.collocations),
    synonyms: boundedList(strongest.synonyms),
    antonyms: boundedList(strongest.antonyms),
    register: boundedText(strongest.register, 64),
    commonMistake: boundedText(strongest.commonMistake, 2_048),
    reviewHistory: sanitizedReviewHistory(strongest.reviewHistory),
    ...(fsrs ? { fsrs } : {}),
    schemaVersion: 2,
    revision,
    libraryEpoch: Math.floor(nonNegative(context.libraryEpoch)),
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
      revision: nextSafeRevision(Math.floor(nonNegative(card.revision)), 'Tombstone revision'),
      deletedAt: null,
    })),
  };
}

export function summarizeFacetCounts(cards: CleanupCard[]): Record<string, number> {
  const categories = new Map<string, number>();
  for (const card of cards) {
    const category = typeof card.category === 'string' && card.category.trim()
      ? card.category.trim().slice(0, 128)
      : 'Other';
    categories.set(category, (categories.get(category) ?? 0) + 1);
    if (categories.size > 500) {
      throw new Error('Facet rebuild exceeded 500 distinct categories.');
    }
  }
  return Object.fromEntries([...categories.entries()].sort(([left], [right]) => (
    left.localeCompare(right, 'en-US')
  )));
}
