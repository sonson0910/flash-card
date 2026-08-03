import { doc, onSnapshot, type Firestore, type QueryDocumentSnapshot } from 'firebase/firestore';
import {
  countCards,
  fetchLibraryStats,
  subscribeCardPage,
} from '../../lib/cardRepository';
import type { CloudLibraryPageAdapter } from './cloudLibraryPageController';

export function createCloudLibraryPageFirebaseAdapter({
  database,
  configured = Boolean(database),
}: {
  database: Firestore | null;
  configured?: boolean;
}): CloudLibraryPageAdapter {
  const cursors = new Map<string, QueryDocumentSnapshot>();
  let cursorSequence = 0;

  const requireDatabase = (): Firestore => {
    if (!configured || !database) throw new Error('Cloud library storage is not configured.');
    return database;
  };

  return {
    available: Boolean(configured && database),
    subscribePage: (request, onPage, onError) => subscribeCardPage({
      db: requireDatabase(),
      userId: request.ownerId,
      filters: request.query,
      cursor: request.cursor ? cursors.get(request.cursor) ?? null : null,
      pageSize: request.pageSize,
    }, page => {
      let cursor: string | null = null;
      if (page.lastCursor) {
        cursor = `cursor-${++cursorSequence}`;
        cursors.set(cursor, page.lastCursor);
      }
      void onPage({
        items: page.items,
        hasNext: page.hasNext,
        cursor,
        changeTypes: page.changeTypes,
        fromCache: page.fromCache,
        hasPendingWrites: page.hasPendingWrites,
      });
    }, onError),
    countCards: (ownerId, query) => countCards(requireDatabase(), ownerId, query),
    loadStats: ownerId => fetchLibraryStats(requireDatabase(), ownerId),
    subscribeFacets: (ownerId, onFacets, onError) => onSnapshot(
      doc(requireDatabase(), 'users', ownerId, 'profile', 'library_facets'),
      snapshot => {
        const data = snapshot.data();
        const categories = data?.categories && typeof data.categories === 'object' && !Array.isArray(data.categories)
          ? data.categories as Record<string, number>
          : {};
        onFacets({ categories, complete: data?.complete === true });
      },
      onError,
    ),
  };
}
