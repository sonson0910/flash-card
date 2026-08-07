import { useCallback, useMemo } from 'react';
import type { CardData } from '../../types/card';
import type { IntakeSharingSessionActions } from '../intake/useIntakeSharingSession';
import {
  catalogEntryIsInLibrary,
  catalogEntryToLibraryCard,
  createCatalogLibraryIdentityIndex,
} from './catalogLearningFlow';
import type { CatalogVocabularyPresentation } from './catalogPresentation';

interface UseCatalogLibraryActionsOptions {
  readonly cards: readonly CardData[];
  readonly adoptCards: IntakeSharingSessionActions['adoptCards'];
  readonly notify: (message: string) => void;
}

export function useCatalogLibraryActions({
  cards,
  adoptCards,
  notify,
}: UseCatalogLibraryActionsOptions) {
  const libraryIdentityIndex = useMemo(
    () => createCatalogLibraryIdentityIndex(cards),
    [cards],
  );
  const isInLibrary = useCallback(
    (entry: CatalogVocabularyPresentation) => catalogEntryIsInLibrary(libraryIdentityIndex, entry),
    [libraryIdentityIndex],
  );
  const addToLibrary = useCallback(async (entry: CatalogVocabularyPresentation) => {
    if (!adoptCards) return 'failed' as const;
    const result = await adoptCards([catalogEntryToLibraryCard(entry)]);
    if (result.status !== 'completed') return 'failed' as const;
    if (result.createdCount > 0) {
      notify(`“${entry.lemma}” was added to your library and today’s plan.`);
      return 'created' as const;
    }
    notify(`“${entry.lemma}” is already in your library.`);
    return 'existing' as const;
  }, [adoptCards, notify]);

  return { isInLibrary, addToLibrary };
}
