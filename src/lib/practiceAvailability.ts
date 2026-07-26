export const resolvePracticeLibraryCount = (visibleCardCount: number, knownLibraryTotal: number) => (
  Math.max(0, visibleCardCount, knownLibraryTotal)
);
