import type { CardData } from '../../types/card';

export type DailyPlanReason = 'due' | 'weak' | 'new';

export interface DailyPlanItem {
  readonly card: CardData;
  readonly logicalId: string;
  readonly reason: DailyPlanReason;
}

export interface DailyPlan {
  readonly items: readonly DailyPlanItem[];
  readonly counts: Readonly<Record<DailyPlanReason | 'total', number>>;
  readonly isShort: boolean;
}

export interface DailyPlanOptions {
  readonly now: Date;
  readonly maximum?: number;
  readonly targetMinimum?: number;
}

const DEFAULT_MAXIMUM = 15;
const DEFAULT_TARGET_MINIMUM = 10;

const boundedInteger = (value: number, minimum: number, maximum: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
};

const logicalIdentity = (card: CardData): string => {
  const word = (card.normalizedWord || card.word).normalize('NFKC').trim().toLocaleLowerCase();
  return word || card.id;
};

const reviewCount = (card: CardData): number => Math.max(
  Number.isFinite(card.reviews) ? Math.max(0, card.reviews ?? 0) : 0,
  Number.isFinite(card.fsrs?.reps) ? Math.max(0, card.fsrs?.reps ?? 0) : 0,
  card.reviewHistory?.length ?? 0,
);

const hasReviewEvidence = (card: CardData): boolean => (
  !(card.reviews === 0
    && (card.reviewHistory?.length ?? 0) === 0
    && (card.fsrs?.reps ?? 0) === 0
    && (!card.difficulty || card.difficulty === 'unrated'))
  && (reviewCount(card) > 0
    || card.difficulty === 'easy'
    || card.difficulty === 'good'
    || card.difficulty === 'hard'
    || Boolean(card.nextReviewDate || card.fsrs))
);

const progressScore = (card: CardData): number => (
  reviewCount(card) * 100
  + (card.fsrs ? 20 : 0)
  + (card.nextReviewDate ? 10 : 0)
  + (card.difficulty && card.difficulty !== 'unrated' ? 5 : 0)
  + Math.max(0, card.correctStreak ?? 0)
);

const timestamp = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const result = new Date(value).getTime();
  return Number.isFinite(result) ? result : fallback;
};

const reasonFor = (card: CardData, now: number): DailyPlanReason | null => {
  if (!hasReviewEvidence(card)) return 'new';
  if (timestamp(card.nextReviewDate ?? card.fsrs?.due, Number.NEGATIVE_INFINITY) <= now) return 'due';
  if (card.difficulty === 'hard' || (card.correctStreak !== undefined && card.correctStreak <= 1)) return 'weak';
  return null;
};

const sortTime = (item: DailyPlanItem): number => {
  if (item.reason === 'due') {
    return timestamp(item.card.nextReviewDate ?? item.card.fsrs?.due, Number.NEGATIVE_INFINITY);
  }
  const lastReview = item.card.reviewHistory?.at(-1)?.reviewedAt ?? item.card.fsrs?.lastReview;
  if (item.reason === 'weak') return timestamp(lastReview, Number.NEGATIVE_INFINITY);
  return timestamp(item.card.createdAt, Number.POSITIVE_INFINITY);
};

const compareItems = (left: DailyPlanItem, right: DailyPlanItem): number => (
  sortTime(left) - sortTime(right)
  || left.logicalId.localeCompare(right.logicalId)
  || left.card.id.localeCompare(right.card.id)
);

export function buildDailyPlan(cards: readonly CardData[], options: DailyPlanOptions): DailyPlan {
  const now = options.now.getTime();
  if (!Number.isFinite(now)) throw new TypeError('now must be a valid date.');
  const maximum = boundedInteger(options.maximum ?? DEFAULT_MAXIMUM, 1, DEFAULT_MAXIMUM, 'maximum');
  const targetMinimum = boundedInteger(options.targetMinimum ?? DEFAULT_TARGET_MINIMUM, 1, maximum, 'targetMinimum');

  const unique = new Map<string, CardData>();
  for (const card of [...cards].sort((left, right) => left.id.localeCompare(right.id))) {
    const logicalId = logicalIdentity(card);
    const current = unique.get(logicalId);
    if (!current || progressScore(card) > progressScore(current)) unique.set(logicalId, card);
  }

  const buckets: Record<DailyPlanReason, DailyPlanItem[]> = { due: [], weak: [], new: [] };
  for (const [logicalId, card] of unique) {
    const reason = reasonFor(card, now);
    if (reason) buckets[reason].push({ card, logicalId, reason });
  }
  for (const bucket of Object.values(buckets)) bucket.sort(compareItems);

  const items = [...buckets.due, ...buckets.weak, ...buckets.new].slice(0, maximum);
  const counts = {
    due: items.filter(item => item.reason === 'due').length,
    weak: items.filter(item => item.reason === 'weak').length,
    new: items.filter(item => item.reason === 'new').length,
    total: items.length,
  } as const;
  return { items, counts, isShort: items.length < targetMinimum };
}
