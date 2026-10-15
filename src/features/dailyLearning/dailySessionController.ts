import type { ReviewRatingValue } from '../../types/card';
import type { LearningStateOutcome } from '../learning/learningStateController';
import type { Exercise, ExerciseAnswer } from './exerciseEngine';
import {
  createLessonState,
  reduceLessonState,
  type LessonState,
  type PendingLessonReview,
} from './lessonReducer';

export type DailySessionPersistenceResult =
  | { readonly status: 'advanced' | 'completed'; readonly xpAwarded: number }
  | { readonly status: 'stale-session' | 'not-ready' }
  | { readonly status: 'failed'; readonly error: string };

export interface DailySessionController {
  getSnapshot(): LessonState | null;
  subscribe(listener: (snapshot: LessonState | null) => void): () => void;
  start(exercises: readonly Exercise[]): void;
  append(exercises: readonly Exercise[]): void;
  submit(answer: ExerciseAnswer): boolean;
  rate(rating: ReviewRatingValue): Promise<DailySessionPersistenceResult>;
  retry(): Promise<DailySessionPersistenceResult>;
  close(): void;
}

export interface DailySessionControllerOptions {
  /** Existing Learning State command; no second scheduler or persistence store is created. */
  readonly reviewCard: (
    cardId: string,
    rating: ReviewRatingValue,
    operationId: string,
  ) => Promise<LearningStateOutcome>;
  readonly createOperationId?: () => string;
}

let fallbackOperationSequence = 0;
const createDailyOperationId = () => {
  if (globalThis.crypto?.randomUUID) return `daily-lesson-${globalThis.crypto.randomUUID()}`;
  fallbackOperationSequence += 1;
  return `daily-lesson-${Date.now()}-${fallbackOperationSequence}`;
};

const errorMessage = (error: unknown): string => (
  error instanceof Error && error.message.trim()
    ? error.message.slice(0, 512)
    : 'Could not save the review result.'
);

export function createDailySessionController({
  reviewCard,
  createOperationId = createDailyOperationId,
}: DailySessionControllerOptions): DailySessionController {
  let sessionGeneration = 0;
  let snapshot: LessonState | null = null;
  const listeners = new Set<(value: LessonState | null) => void>();
  const pending = new Map<string, Promise<DailySessionPersistenceResult>>();

  const publish = (next: LessonState | null) => {
    snapshot = next;
    listeners.forEach(listener => listener(snapshot));
  };

  const persist = (review: PendingLessonReview): Promise<DailySessionPersistenceResult> => {
    const existing = pending.get(review.operationId);
    if (existing) return existing;
    const generation = sessionGeneration;
    let operation!: Promise<DailySessionPersistenceResult>;
    operation = (async () => {
      try {
        const outcome = await reviewCard(review.itemId, review.rating, review.operationId);
        if (outcome?.status !== 'published') {
          throw new Error(`The review was not saved (${outcome?.status ?? 'missing outcome'}).`);
        }
        if (generation !== sessionGeneration || !snapshot) return { status: 'stale-session' };
        if (typeof outcome.result.xpAwarded !== 'number') {
          throw new Error('The review was saved without an authoritative XP award.');
        }
        const next = reduceLessonState(snapshot, {
          type: 'persisted',
          operationId: review.operationId,
        });
        if (next === snapshot) return { status: 'stale-session' };
        publish(next);
        return { status: next.phase === 'completed' ? 'completed' : 'advanced', xpAwarded: outcome.result.xpAwarded };
      } catch (error) {
        if (generation !== sessionGeneration || !snapshot) return { status: 'stale-session' };
        const message = errorMessage(error);
        publish(reduceLessonState(snapshot, {
          type: 'persist-failed',
          operationId: review.operationId,
          message,
        }));
        return { status: 'failed', error: message };
      } finally {
        if (pending.get(review.operationId) === operation) pending.delete(review.operationId);
      }
    })();
    pending.set(review.operationId, operation);
    return operation;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start(exercises) {
      sessionGeneration += 1;
      pending.clear();
      publish(createLessonState(exercises));
    },
    append(exercises) {
      if (!snapshot || exercises.length === 0) return;
      const existingIds = new Set(snapshot.exercises.map(exercise => exercise.cardId));
      const additions: Exercise[] = [];
      for (const exercise of exercises) {
        if (!existingIds.has(exercise.cardId)) {
          existingIds.add(exercise.cardId);
          additions.push(exercise);
        }
      }
      if (additions.length === 0) return;
      if (snapshot.exercises.length + additions.length > 15) {
        throw new TypeError('A lesson cannot contain more than 15 exercises.');
      }
      const insertionIndex = snapshot.phase === 'completed' ? snapshot.exercises.length : snapshot.index + 1;
      publish({
        ...snapshot,
        exercises: [...snapshot.exercises.slice(0, insertionIndex), ...additions, ...snapshot.exercises.slice(insertionIndex)],
        ...(snapshot.phase === 'completed' ? { phase: 'answering', feedback: null, pendingReview: null, error: null } : {}),
      });
    },
    submit(answer) {
      if (!snapshot || snapshot.phase !== 'answering') return false;
      const next = reduceLessonState(snapshot, { type: 'submit', answer });
      if (next === snapshot) return false;
      publish(next);
      return true;
    },
    rate(rating) {
      if (!snapshot) return Promise.resolve({ status: 'not-ready' });
      if (snapshot.phase === 'persisting' && snapshot.pendingReview) {
        return persist(snapshot.pendingReview);
      }
      if (snapshot.phase !== 'feedback') return Promise.resolve({ status: 'not-ready' });
      const operationId = createOperationId().trim();
      if (!operationId) return Promise.resolve({ status: 'not-ready' });
      const next = reduceLessonState(snapshot, { type: 'rate', rating, operationId });
      if (!next.pendingReview) return Promise.resolve({ status: 'not-ready' });
      publish(next);
      return persist(next.pendingReview);
    },
    retry() {
      if (!snapshot || snapshot.phase !== 'save-error' || !snapshot.pendingReview) {
        return Promise.resolve({ status: 'not-ready' });
      }
      const review = snapshot.pendingReview;
      publish(reduceLessonState(snapshot, { type: 'retry-persist' }));
      return persist(review);
    },
    close() {
      sessionGeneration += 1;
      pending.clear();
      publish(null);
    },
  };
}
