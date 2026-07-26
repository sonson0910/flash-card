import { describe, expect, it } from 'vitest';
import { resolvePracticeLibraryCount } from './practiceAvailability';

describe('resolvePracticeLibraryCount', () => {
  it('keeps practice available on a short final page when the known library is large enough', () => {
    expect(resolvePracticeLibraryCount(2, 42)).toBe(42);
  });

  it('falls back to the visible cards when a cloud count has not loaded yet', () => {
    expect(resolvePracticeLibraryCount(6, 0)).toBe(6);
  });
});
