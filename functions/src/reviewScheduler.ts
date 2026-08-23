import { Rating, State, createEmptyCard, fsrs, type Card as FSRSCard, type Grade } from 'ts-fsrs';
import type { CardRecord } from './cardPersistence.js';

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

const MAX_REVIEW_HISTORY = 100;
const scheduler = fsrs({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: false,
  enable_short_term: true,
  learning_steps: ['1m', '10m'],
  relearning_steps: ['10m'],
});

const ratingMap: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

const record = (value: unknown): CardRecord | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as CardRecord : undefined;

const numberValue = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const dateValue = (value: unknown): Date | undefined => {
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const reviewHistory = (card: CardRecord): CardRecord[] =>
  Array.isArray(card.reviewHistory)
    ? card.reviewHistory.flatMap(item => record(item) ? [item as CardRecord] : [])
    : [];

const legacyFSRSCard = (card: CardRecord, now: Date): FSRSCard => {
  const history = reviewHistory(card);
  const reviewCounter = Math.max(0, Math.floor(numberValue(card.reviews, 0)));
  const legacyReviews = Math.max(reviewCounter, history.length);
  const parsedDue = dateValue(card.nextReviewDate);
  if (legacyReviews === 0 && !parsedDue) return createEmptyCard(now);

  const scheduledDays = Math.max(1, Math.floor(numberValue(card.interval, 1)));
  const parsedHistoryDate = dateValue(history.at(-1)?.reviewedAt);
  const inferredLastReview = parsedDue
    ? new Date(parsedDue.getTime() - scheduledDays * 86_400_000)
    : new Date(now.getTime() - scheduledDays * 86_400_000);
  const lastReview = parsedHistoryDate ?? inferredLastReview;
  const elapsedDays = Math.max(0, Math.floor((now.getTime() - lastReview.getTime()) / 86_400_000));
  const easeFactor = numberValue(card.easeFactor, 2.5);
  const difficulty = Math.min(10, Math.max(1, 11 - easeFactor * 2.4));
  const lapses = history.filter(review => review.rating === 'again').length;

  return {
    due: parsedDue ?? now,
    stability: Math.max(0.1, scheduledDays),
    difficulty,
    elapsed_days: elapsedDays,
    scheduled_days: scheduledDays,
    learning_steps: 0,
    reps: legacyReviews,
    lapses,
    state: State.Review,
    last_review: lastReview,
  };
};

const toFSRSCard = (card: CardRecord, now: Date): FSRSCard => {
  const stored = record(card.fsrs);
  const due = dateValue(stored?.due);
  const lastReview = dateValue(stored?.lastReview);
  const numericValues = [
    stored?.stability,
    stored?.difficulty,
    stored?.elapsedDays,
    stored?.scheduledDays,
    stored?.learningSteps,
    stored?.reps,
    stored?.lapses,
  ];
  const state = stored?.state;
  const isValid = Boolean(due)
    && (!stored?.lastReview || Boolean(lastReview))
    && numericValues.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)
    && Number.isInteger(state)
    && Number(state) >= State.New
    && Number(state) <= State.Relearning;
  if (!isValid || !stored || !due) return legacyFSRSCard(card, now);
  return {
    due,
    stability: Number(stored.stability),
    difficulty: Number(stored.difficulty),
    elapsed_days: Number(stored.elapsedDays),
    scheduled_days: Number(stored.scheduledDays),
    learning_steps: Number(stored.learningSteps),
    reps: Number(stored.reps),
    lapses: Number(stored.lapses),
    state: Number(state) as State,
    last_review: lastReview,
  };
};

export const scheduleReviewTransition = (
  card: CardRecord,
  rating: ReviewRating,
  now: Date,
): Record<string, unknown> => {
  const result = scheduler.next(toFSRSCard(card, now), now, ratingMap[rating]);
  const nextCard = result.card;
  return {
    difficulty: rating === 'again' ? 'hard' : rating,
    nextReviewDate: nextCard.due.toISOString(),
    reviews: nextCard.reps,
    interval: nextCard.scheduled_days,
    easeFactor: Math.max(1.3, 3 - (nextCard.difficulty / 10)),
    fsrs: {
      due: nextCard.due.toISOString(),
      stability: nextCard.stability,
      difficulty: nextCard.difficulty,
      elapsedDays: nextCard.elapsed_days,
      scheduledDays: nextCard.scheduled_days,
      learningSteps: nextCard.learning_steps,
      reps: nextCard.reps,
      lapses: nextCard.lapses,
      state: nextCard.state,
      lastReview: nextCard.last_review?.toISOString(),
    },
    reviewHistory: [
      ...reviewHistory(card),
      {
        rating,
        reviewedAt: now.toISOString(),
        scheduledDays: result.log.scheduled_days,
        elapsedDays: result.log.elapsed_days,
      },
    ].slice(-MAX_REVIEW_HISTORY),
    correctStreak: rating === 'good' || rating === 'easy'
      ? numberValue(card.correctStreak, 0) + 1
      : 0,
  };
};
