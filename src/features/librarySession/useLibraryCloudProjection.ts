import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { CardData } from '../../types/card';
import type { LibrarySessionModel } from './useLibrarySession';

export interface LibraryCloudProjectionValue {
  items: CardData[];
  total: number;
  hasNext: boolean;
  isLoading: boolean;
  unavailable: boolean;
  stats: LibrarySessionModel['cloud']['stats'];
  facets: Record<string, number>;
  facetsComplete: boolean;
}

export interface LibraryCloudProjectionPublication {
  presentCards(cards: CardData[]): void;
  presentCloud(value: LibraryCloudProjectionValue): void;
  resetCloud(): void;
  resetPage(): void;
  previousPage(): void;
  reportError(message: string): void;
  clearError(message: string): void;
}

export interface LibraryCloudProjectionInput {
  session: LibrarySessionModel;
  page: number;
}

export interface LibraryCloudProjectionModel {
  ownerId: string | null;
  status: 'idle' | 'ready';
  source: 'none' | 'cloud';
}

interface LibraryCloudProjectionOptions {
  publication: LibraryCloudProjectionPublication;
}

const EMPTY_MODEL: LibraryCloudProjectionModel = {
  ownerId: null,
  status: 'idle',
  source: 'none',
};

const sameModel = (
  left: LibraryCloudProjectionModel,
  right: LibraryCloudProjectionModel,
): boolean => left.ownerId === right.ownerId
  && left.status === right.status
  && left.source === right.source;

export function createLibraryCloudProjectionController({
  publication,
}: LibraryCloudProjectionOptions) {
  let model = EMPTY_MODEL;
  let identityKey: string | null = null;
  let lastReportedError: string | null = null;
  let publishedCloudItems: CardData[] | null = null;
  let exhaustedPageKey: string | null = null;

  const listeners = new Set<() => void>();

  const publishModel = (next: LibraryCloudProjectionModel) => {
    if (sameModel(model, next)) return;
    model = next;
    listeners.forEach(listener => listener());
  };

  const beginIdentity = (key: string, ownerId: string | null) => {
    if (identityKey === key) return;
    if (lastReportedError) publication.clearError(lastReportedError);
    identityKey = key;
    lastReportedError = null;
    exhaustedPageKey = null;
    publication.presentCards([]);
    publication.resetCloud();
    publishedCloudItems = null;
    publishModel({ ownerId, status: 'idle', source: 'none' });
  };

  const update = (input: LibraryCloudProjectionInput): void => {
    const identity = input.session.identity;
    if (identity.status === 'loading') {
      beginIdentity('loading', null);
      return;
    }
    const ownerId = identity.owner?.id ?? null;
    const key = ownerId ? `owner:${ownerId}` : 'anonymous';
    beginIdentity(key, ownerId);

    if (!ownerId) {
      publishModel({ ownerId: null, status: 'ready', source: 'none' });
      return;
    }

    const cloud = input.session.cloud;
    if (cloud.ownerId !== ownerId) return;
    if (publishedCloudItems !== cloud.items) {
      publishedCloudItems = cloud.items;
      publication.presentCards(cloud.items);
    }
    publication.presentCloud({
      items: cloud.items,
      total: cloud.total,
      hasNext: cloud.hasNext,
      isLoading: cloud.isLoading,
      unavailable: cloud.cloudUnavailable,
      stats: cloud.stats,
      facets: cloud.facets,
      facetsComplete: cloud.facetsComplete,
    });
    if (!cloud.error && lastReportedError) {
      publication.clearError(lastReportedError);
      lastReportedError = null;
    } else if (cloud.error && cloud.error !== lastReportedError) {
      publication.reportError(cloud.error);
      lastReportedError = cloud.error;
    }
    const exhausted = !cloud.isLoading
      && input.page > 1
      && cloud.items.length === 0
      && !cloud.hasNext;
    const pageKey = exhausted ? `${ownerId}:${cloud.queryKey}:${input.page}` : null;
    if (pageKey && exhaustedPageKey !== pageKey) publication.previousPage();
    exhaustedPageKey = pageKey;
    publishModel({ ownerId, status: 'ready', source: 'cloud' });
  };

  return {
    getSnapshot: () => model,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update,
  };
}

export interface UseLibraryCloudProjectionOptions extends LibraryCloudProjectionInput {
  publication: LibraryCloudProjectionPublication;
}

export function useLibraryCloudProjection({
  session,
  page,
  publication,
}: UseLibraryCloudProjectionOptions) {
  const controller = useMemo(
    () => createLibraryCloudProjectionController({ publication }),
    [publication],
  );
  const model = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    controller.update({ session, page });
  }, [controller, page, session]);

  return { model };
}
