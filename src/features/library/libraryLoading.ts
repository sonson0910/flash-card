interface LibraryImportProgress {
  current: number;
  total: number;
  word: string;
}

interface LibraryGridLoadingState {
  currentPage: number;
  isPageLoading: boolean;
  importProgress: LibraryImportProgress | null;
}

export function getLibraryGridLoadingLabel({
  currentPage,
  isPageLoading,
  importProgress,
}: LibraryGridLoadingState): string | null {
  if (importProgress) return `Creating ${importProgress.current}/${importProgress.total}`;
  if (isPageLoading) return `Loading page ${currentPage}`;
  return null;
}
