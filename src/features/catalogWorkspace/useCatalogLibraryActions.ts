import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useCallback, useMemo } from 'react';
import type { CardData } from '../../types/card';
import type { IntakeSharingSessionActions } from '../intake/useIntakeSharingSession';
import {
  catalogEntryIsInLibrary,
  catalogEntryToLibraryCard,
  createCatalogLibraryIdentityIndex,
} from './catalogLearningFlow';
import type { CatalogVocabularyPresentation } from './catalogPresentation';

/** The toast shown after a catalog word is added, or found already in the library. */
export const catalogAddNotice = (created: boolean, lemma: string): string => {
  const descriptor = created
    ? msg({ id: 'catalog.workspace.added-to-library', message: '“{lemma}” was added to your library and today’s plan.' })
    : msg({ id: 'catalog.workspace.already-in-library', message: '“{lemma}” is already in your library.' });
  return i18n._(descriptor.id!, { lemma }, { message: descriptor.message });
};

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
    const created = result.createdCount > 0;
    notify(catalogAddNotice(created, entry.lemma));
    return created ? 'created' as const : 'existing' as const;
  }, [adoptCards, notify]);

  return { isInLibrary, addToLibrary };
}
