import type { ReviewRatingValue } from '../../types/card';
import type { CardData } from '../../types/card';
import { evaluateExerciseAnswer, type Exercise, type ExerciseAnswer, type ExerciseEvaluation } from './exerciseEngine';

export type LessonStage = 'introduction' | 'guided' | 'independent-recall' | 'review';
export type LessonPhase = 'introduction' | 'answering' | 'feedback' | 'persisting' | 'save-error' | 'completed';

export interface LessonStep {
  readonly stage: LessonStage;
  readonly exercise: Exercise;
  readonly card?: CardData;
}

export interface PendingLessonReview {
  readonly itemId: string;
  readonly operationId: string;
  readonly rating: ReviewRatingValue;
}

export interface LessonState {
  readonly exercises: readonly Exercise[];
  readonly steps: readonly LessonStep[];
  readonly index: number;
  readonly phase: LessonPhase;
  readonly feedback: ExerciseEvaluation | null;
  readonly pendingReview: PendingLessonReview | null;
  readonly completedOperationIds: readonly string[];
  readonly error: string | null;
}

export type LessonAction =
  | { readonly type: 'submit'; readonly answer: ExerciseAnswer }
  | { readonly type: 'introduction-choice'; readonly choice: 'guided' | 'independent-recall' }
  | { readonly type: 'continue-guided' }
  | { readonly type: 'rate'; readonly rating: ReviewRatingValue; readonly operationId: string }
  | { readonly type: 'persisted'; readonly operationId: string }
  | { readonly type: 'persist-failed'; readonly operationId: string; readonly message: string }
  | { readonly type: 'retry-persist' };

const isLessonStep = (value: Exercise | LessonStep): value is LessonStep => (
  'stage' in value && 'exercise' in value
);

const normalizeSteps = (input: readonly (Exercise | LessonStep)[]): readonly LessonStep[] => input.map(value => (
  isLessonStep(value) ? value : { stage: 'review', exercise: value }
));

const currentStepFor = (state: LessonState): LessonStep | undefined => state.steps[state.index];

const phaseForStep = (step: LessonStep | undefined): LessonPhase => (
  step?.stage === 'introduction' ? 'introduction' : 'answering'
);

const advanceTo = (state: LessonState, nextIndex: number): LessonState => {
  if (nextIndex >= state.steps.length) {
    return {
      ...state, index: nextIndex, phase: 'completed', feedback: null, pendingReview: null, error: null,
    };
  }
  return {
    ...state, index: nextIndex, phase: phaseForStep(state.steps[nextIndex]), feedback: null, pendingReview: null, error: null,
  };
};

export const currentLessonStep = currentStepFor;

export function createLessonState(input: readonly (Exercise | LessonStep)[]): LessonState {
  const steps = normalizeSteps(input);
  const scoredSteps = steps.filter(step => step.stage === 'review' || step.stage === 'independent-recall');
  if (steps.length < 1 || steps.length > 45 || scoredSteps.length > 15) {
    throw new TypeError('A lesson must contain between 1 and 15 exercises.');
  }
  const reviewIds = steps
    .filter(step => step.stage === 'review' || step.stage === 'independent-recall')
    .map(step => step.exercise.cardId);
  if (new Set(reviewIds).size !== reviewIds.length) throw new TypeError('A lesson cannot contain duplicate card reviews.');
  const exercises = steps.map(step => step.exercise);
  return {
    exercises, steps: [...steps], index: 0, phase: phaseForStep(steps[0]), feedback: null,
    pendingReview: null, completedOperationIds: [], error: null,
  };
}

export function reduceLessonState(state: LessonState, action: LessonAction): LessonState {
  const step = currentStepFor(state);
  if (action.type === 'introduction-choice') {
    if (state.phase !== 'introduction' || step?.stage !== 'introduction') return state;
    const nextIndex = action.choice === 'guided'
      ? state.index + 1
      : state.steps.findIndex((candidate, index) => index > state.index && candidate.stage === 'independent-recall');
    return nextIndex < 0 ? state : advanceTo(state, nextIndex);
  }
  if (action.type === 'continue-guided') {
    if (state.phase !== 'answering' || step?.stage !== 'guided') return state;
    return advanceTo(state, state.index + 1);
  }
  if (action.type === 'submit') {
    if (state.phase !== 'answering') return state;
    if (!step || step.stage === 'introduction' || step.stage === 'guided') return state;
    return { ...state, phase: 'feedback', feedback: evaluateExerciseAnswer(step.exercise, action.answer), error: null };
  }
  if (action.type === 'rate') {
    if (state.phase !== 'feedback' || !action.operationId.trim()
      || state.completedOperationIds.includes(action.operationId)) return state;
    if (!step || (step.stage !== 'review' && step.stage !== 'independent-recall')) return state;
    return {
      ...state,
      phase: 'persisting',
      pendingReview: { itemId: step.exercise.cardId, operationId: action.operationId, rating: action.rating },
      error: null,
    };
  }
  if (action.type === 'persisted') {
    if (state.phase !== 'persisting' || state.pendingReview?.operationId !== action.operationId) return state;
    return {
      ...advanceTo(state, state.index + 1),
      completedOperationIds: [...state.completedOperationIds, action.operationId],
    };
  }
  if (action.type === 'persist-failed') {
    if (state.phase !== 'persisting' || state.pendingReview?.operationId !== action.operationId) return state;
    return { ...state, phase: 'save-error', error: action.message.trim().slice(0, 512) || 'Could not save this review.' };
  }
  if (state.phase !== 'save-error' || !state.pendingReview) return state;
  return { ...state, phase: 'persisting', error: null };
}
