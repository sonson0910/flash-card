import { useCallback, useRef } from 'react';
import { fetchCatalogUnitCards } from '../lib/cardRepository';
import { db } from '../lib/firebase';
import type { CardData } from '../types/card';
import {
  continueCatalogUnitCards,
  type CatalogUnitContinueOutcome,
  type CatalogUnitContinuePorts,
  type CatalogUnitScope,
} from './catalog-unit-continue';

interface CatalogUnitContinuationOptions {
  scope: CatalogUnitScope;
  createMissing: CatalogUnitContinuePorts['createMissing'];
  startStudy: CatalogUnitContinuePorts['startStudy'];
}

export function useCatalogUnitContinuation({ scope, createMissing, startStudy }: CatalogUnitContinuationOptions) {
  const currentScope = useRef(scope);
  currentScope.current = scope;

  return useCallback(async (
    candidates: readonly CardData[],
    isWorkspaceCurrent: () => boolean,
  ): Promise<CatalogUnitContinueOutcome> => {
    const database = db;
    if (!database) return 'unavailable';
    return continueCatalogUnitCards(candidates, currentScope.current, {
      readCards: (lexemeIds, expectedScope) => fetchCatalogUnitCards(database, expectedScope.ownerId!, {
        lexemeIds, targetLanguage: expectedScope.targetLanguage, libraryEpoch: expectedScope.libraryEpoch!,
      }),
      createMissing,
      startStudy,
      isCurrent: expectedScope => isWorkspaceCurrent()
        && currentScope.current.ownerId === expectedScope.ownerId
        && currentScope.current.libraryEpoch === expectedScope.libraryEpoch
        && currentScope.current.targetLanguage === expectedScope.targetLanguage,
    });
  }, [createMissing, startStudy]);
}
