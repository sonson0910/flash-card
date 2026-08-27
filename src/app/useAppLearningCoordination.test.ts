import { describe, expect, it } from 'vitest';
import { resolvePracticeWorkspaceMode } from './useAppLearningCoordination';

describe('resolvePracticeWorkspaceMode', () => {
  it('passes every practice mode through unchanged', () => {
    const modes = ['study', 'quiz', 'spelling', 'story', 'match', 'shadowing'] as const;

    expect(modes.map(resolvePracticeWorkspaceMode)).toEqual(modes);
  });

  it('uses the library mode outside a practice session', () => {
    expect(resolvePracticeWorkspaceMode('library')).toBe('library');
  });
});
