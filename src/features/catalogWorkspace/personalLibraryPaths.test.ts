import { describe, expect, it } from 'vitest';
import { createPersonalLibraryPathPresentation } from './personalLibraryPaths';

describe('personal library paths', () => {
  it('builds bounded useful paths from the learner library without claiming a reviewed catalog', () => {
    expect(createPersonalLibraryPathPresentation({
      total: 1_167,
      dueToday: 82,
      learning: 410,
      learned: 757,
    })).toEqual({
      total: 1_167,
      dueToday: 82,
      learning: 410,
      learned: 757,
    });
  });

  it('clamps stale aggregate counts to a safe personal-library snapshot', () => {
    expect(createPersonalLibraryPathPresentation({
      total: 5,
      dueToday: 12,
      learning: -3,
      learned: 9,
    })).toEqual({
      total: 9,
      dueToday: 9,
      learning: 0,
      learned: 9,
    });
  });
});
