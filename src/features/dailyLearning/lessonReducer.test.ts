import { describe, expect, it } from 'vitest';
import type { CardData } from '../../types/card';
import { buildExercise } from './exerciseEngine';
import { createLessonState, reduceLessonState } from './lessonReducer';

const card = (id: string): CardData => ({
  id,
  word: id,
  translation: `meaning ${id}`,
  explanation: '',
  phonetic: '',
  emoji: '',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
});

describe('lesson reducer', () => {
  const exercises = ['one', 'two'].map(id => {
    const source = card(id);
    return buildExercise(source, [source], 'spelling');
  });

  it('requires answer feedback and an explicit rating before persistence', () => {
    let state = createLessonState(exercises);
    state = reduceLessonState(state, { type: 'submit', answer: 'one' });
    expect(state.phase).toBe('feedback');
    expect(state.feedback?.correct).toBe(true);

    state = reduceLessonState(state, { type: 'rate', rating: 'good', operationId: 'review-1' });
    expect(state.phase).toBe('persisting');
    expect(state.pendingReview).toEqual({ itemId: 'one', operationId: 'review-1', rating: 'good' });
    expect(state.index).toBe(0);
  });

  it('advances only after the matching persistence succeeds and ignores duplicate/stale acknowledgements', () => {
    let state = createLessonState(exercises);
    state = reduceLessonState(state, { type: 'submit', answer: 'one' });
    state = reduceLessonState(state, { type: 'rate', rating: 'good', operationId: 'review-1' });
    state = reduceLessonState(state, { type: 'persisted', operationId: 'wrong' });
    expect(state.index).toBe(0);
    state = reduceLessonState(state, { type: 'persisted', operationId: 'review-1' });
    expect(state).toMatchObject({ phase: 'answering', index: 1, pendingReview: null });
    const duplicate = reduceLessonState(state, { type: 'persisted', operationId: 'review-1' });
    expect(duplicate).toBe(state);
  });

  it('keeps a failed review actionable and retries the same idempotent operation', () => {
    let state = createLessonState(exercises);
    state = reduceLessonState(state, { type: 'submit', answer: 'wrong' });
    state = reduceLessonState(state, { type: 'rate', rating: 'again', operationId: 'review-1' });
    state = reduceLessonState(state, { type: 'persist-failed', operationId: 'review-1', message: 'offline' });
    expect(state).toMatchObject({ phase: 'save-error', index: 0, error: 'offline' });
    const pending = state.pendingReview;
    state = reduceLessonState(state, { type: 'retry-persist' });
    expect(state).toMatchObject({ phase: 'persisting', pendingReview: pending, error: null });
  });

  it('completes after the final persisted rating and rejects invalid lesson input', () => {
    const one = createLessonState(exercises.slice(0, 1));
    const feedback = reduceLessonState(one, { type: 'submit', answer: 'one' });
    const saving = reduceLessonState(feedback, { type: 'rate', rating: 'easy', operationId: 'review-final' });
    const complete = reduceLessonState(saving, { type: 'persisted', operationId: 'review-final' });
    expect(complete).toMatchObject({ phase: 'completed', index: 1 });
    expect(() => createLessonState([])).toThrow(/exercise/i);
    expect(() => createLessonState([...exercises, ...exercises])).toThrow(/duplicate/i);
  });

  it('does not allow a completed operation id to be reused for another item', () => {
    let state = createLessonState(exercises);
    state = reduceLessonState(state, { type: 'submit', answer: 'one' });
    state = reduceLessonState(state, { type: 'rate', rating: 'good', operationId: 'same-operation' });
    state = reduceLessonState(state, { type: 'persisted', operationId: 'same-operation' });
    state = reduceLessonState(state, { type: 'submit', answer: 'two' });
    const rejected = reduceLessonState(state, { type: 'rate', rating: 'good', operationId: 'same-operation' });
    expect(rejected).toBe(state);
  });
});
