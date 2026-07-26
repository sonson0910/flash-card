import { describe, expect, it } from 'vitest';
import { getLibraryGridLoadingLabel } from './libraryLoading';

describe('getLibraryGridLoadingLabel', () => {
  it('does not describe card generation as a page load', () => {
    expect(getLibraryGridLoadingLabel({
      currentPage: 1,
      isPageLoading: false,
      importProgress: null,
    })).toBeNull();
  });

  it('labels only real page loads and spreadsheet imports', () => {
    expect(getLibraryGridLoadingLabel({
      currentPage: 2,
      isPageLoading: true,
      importProgress: null,
    })).toBe('Loading page 2');
    expect(getLibraryGridLoadingLabel({
      currentPage: 1,
      isPageLoading: false,
      importProgress: { current: 3, total: 8, word: 'chance' },
    })).toBe('Creating 3/8');
  });
});
