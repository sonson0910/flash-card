import { Rating, State, createEmptyCard, fsrs, type Card as FSRSCard, type Grade } from 'ts-fsrs';
import type { CardData } from '../types/card';

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export type ScheduledReviewUpdate = Pick<
  CardData,
  'difficulty' | 'nextReviewDate' | 'reviews' | 'interval' | 'easeFactor' | 'fsrs' | 'reviewHistory' | 'correctStreak'
> & { nextReviewDate: string };

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

function legacyFSRSCard(card: CardData, now: Date): FSRSCard {
  const reviewCounter = typeof card.reviews === 'number' && Number.isFinite(card.reviews)
    ? Math.max(0, Math.floor(card.reviews))
    : 0;
  const legacyReviews = Math.max(reviewCounter, card.reviewHistory?.length ?? 0);
  const parsedDue = card.nextReviewDate ? new Date(card.nextReviewDate) : null;
  const hasValidDue = Boolean(parsedDue && !Number.isNaN(parsedDue.getTime()));
  if (legacyReviews === 0 && !hasValidDue) return createEmptyCard(now);

  const scheduledDays = Math.max(1, Math.floor(card.interval ?? 1));
  const lastHistoryDate = card.reviewHistory?.at(-1)?.reviewedAt;
  const parsedHistoryDate = lastHistoryDate ? new Date(lastHistoryDate) : null;
  const inferredLastReview = hasValidDue
    ? new Date((parsedDue as Date).getTime() - scheduledDays * 86_400_000)
    : new Date(now.getTime() - scheduledDays * 86_400_000);
  const lastReview = parsedHistoryDate && !Number.isNaN(parsedHistoryDate.getTime())
    ? parsedHistoryDate
    : inferredLastReview;
  const elapsedDays = Math.max(0, Math.floor((now.getTime() - lastReview.getTime()) / 86_400_000));
  const easeFactor = Number.isFinite(card.easeFactor) ? card.easeFactor as number : 2.5;
  const difficulty = Math.min(10, Math.max(1, 11 - easeFactor * 2.4));
  const lapses = card.reviewHistory?.filter(review => review.rating === 'again').length ?? 0;

  return {
    due: hasValidDue ? parsedDue as Date : now,
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
}

function toFSRSCard(card: CardData, now: Date): FSRSCard {
  const stored = card.fsrs;
  if (!stored) return legacyFSRSCard(card, now);
  const due = new Date(stored.due);
  const lastReview = stored.lastReview ? new Date(stored.lastReview) : undefined;
  const numericValues = [
    stored.stability,
    stored.difficulty,
    stored.elapsedDays,
    stored.scheduledDays,
    stored.learningSteps,
    stored.reps,
    stored.lapses,
  ];
  const isValid = !Number.isNaN(due.getTime())
    && (!lastReview || !Number.isNaN(lastReview.getTime()))
    && numericValues.every(value => Number.isFinite(value) && value >= 0)
    && Number.isInteger(stored.state)
    && stored.state >= State.New
    && stored.state <= State.Relearning;
  if (!isValid) return legacyFSRSCard(card, now);

  return {
    due,
    stability: stored.stability,
    difficulty: stored.difficulty,
    elapsed_days: stored.elapsedDays,
    scheduled_days: stored.scheduledDays,
    learning_steps: stored.learningSteps,
    reps: stored.reps,
    lapses: stored.lapses,
    state: stored.state as State,
    last_review: lastReview,
  };
}

export function scheduleReview(card: CardData, rating: ReviewRating, now = new Date()): ScheduledReviewUpdate {
  const result = scheduler.next(toFSRSCard(card, now), now, ratingMap[rating]);
  const nextCard = result.card;
  const history = [
    ...(card.reviewHistory || []),
    {
      rating,
      reviewedAt: now.toISOString(),
      scheduledDays: result.log.scheduled_days,
      elapsedDays: result.log.elapsed_days,
    },
  ].slice(-100);

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
    reviewHistory: history,
    correctStreak: rating === 'good' || rating === 'easy' ? (card.correctStreak || 0) + 1 : 0,
  };
}
