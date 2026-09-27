import type { ReviewRatingValue } from '../../types/card';
import { evaluateExerciseAnswer, type Exercise, type ExerciseAnswer, type ExerciseEvaluation } from './exerciseEngine';

export type LessonPhase = 'answering' | 'feedback' | 'persisting' | 'save-error' | 'completed';

export interface PendingLessonReview {
  readonly itemId: string;
  readonly operationId: string;
  readonly rating: ReviewRatingValue;
}

export interface LessonState {
  readonly exercises: readonly Exercise[];
  readonly index: number;
  readonly phase: LessonPhase;
  readonly feedback: ExerciseEvaluation | null;
  readonly pendingReview: PendingLessonReview | null;
  readonly completedOperationIds: readonly string[];
  readonly error: string | null;
}

export type LessonAction =
  | { readonly type: 'submit'; readonly answer: ExerciseAnswer }
  | { readonly type: 'rate'; readonly rating: ReviewRatingValue; readonly operationId: string }
  | { readonly type: 'persisted'; readonly operationId: string }
  | { readonly type: 'persist-failed'; readonly operationId: string; readonly message: string }
  | { readonly type: 'retry-persist' };

export function createLessonState(exercises: readonly Exercise[]): LessonState {
  if (exercises.length < 1 || exercises.length > 15) {
    throw new TypeError('A lesson must contain between 1 and 15 exercises.');
  }
  const ids = exercises.map(exercise => exercise.cardId);
  if (new Set(ids).size !== ids.length) throw new TypeError('A lesson cannot contain duplicate card exercises.');
  return {
    exercises: [...exercises], index: 0, phase: 'answering', feedback: null,
    pendingReview: null, completedOperationIds: [], error: null,
  };
}

export function reduceLessonState(state: LessonState, action: LessonAction): LessonState {
  if (action.type === 'submit') {
    if (state.phase !== 'answering') return state;
    const exercise = state.exercises[state.index];
    if (!exercise) return state;
    return { ...state, phase: 'feedback', feedback: evaluateExerciseAnswer(exercise, action.answer), error: null };
  }
  if (action.type === 'rate') {
    if (state.phase !== 'feedback' || !action.operationId.trim()
      || state.completedOperationIds.includes(action.operationId)) return state;
    const exercise = state.exercises[state.index];
    if (!exercise) return state;
    return {
      ...state,
      phase: 'persisting',
      pendingReview: { itemId: exercise.cardId, operationId: action.operationId, rating: action.rating },
      error: null,
    };
  }
  if (action.type === 'persisted') {
    if (state.phase !== 'persisting' || state.pendingReview?.operationId !== action.operationId) return state;
    const nextIndex = state.index + 1;
    return {
      ...state,
      index: nextIndex,
      phase: nextIndex >= state.exercises.length ? 'completed' : 'answering',
      feedback: null,
      pendingReview: null,
      completedOperationIds: [...state.completedOperationIds, action.operationId],
      error: null,
    };
  }
  if (action.type === 'persist-failed') {
    if (state.phase !== 'persisting' || state.pendingReview?.operationId !== action.operationId) return state;
    return { ...state, phase: 'save-error', error: action.message.trim().slice(0, 512) || 'Could not save this review.' };
  }
  if (state.phase !== 'save-error' || !state.pendingReview) return state;
  return { ...state, phase: 'persisting', error: null };
}
