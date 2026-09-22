import { doc, onSnapshot, type Firestore, type QueryDocumentSnapshot } from 'firebase/firestore';
import {
  countCards,
  fetchLibraryStats,
  subscribeCardPage,
} from '../../lib/cardRepository';
import type { CardQueryState } from '../../lib/cardQuery';
import type { CardData } from '../../types/card';
import type { CloudLibraryPageAdapter } from './cloudLibraryPageController';

export function createCloudLibraryPageFirebaseAdapter({
  database,
  configured = Boolean(database),
  transformPage,
}: {
  database: Firestore | null;
  configured?: boolean;
  transformPage?: (request: { ownerId: string; query: CardQueryState; queryKey: string; page: number; pageSize: number }, items: CardData[]) => Promise<CardData[]>;
}): CloudLibraryPageAdapter {
  const cursors = new Map<string, QueryDocumentSnapshot>();
  let cursorSequence = 0;

  const requireDatabase = (): Firestore => {
    if (!configured || !database) throw new Error('Cloud library storage is not configured.');
    return database;
  };

  return {
    available: Boolean(configured && database),
    subscribePage: (request, onPage, onError) => {
      let active = true;
      let snapshotSequence = 0;
      const unsubscribe = subscribeCardPage({
      db: requireDatabase(),
      userId: request.ownerId,
      filters: request.query,
      cursor: request.cursor ? cursors.get(request.cursor) ?? null : null,
      pageSize: request.pageSize,
    }, page => {
      const sequence = ++snapshotSequence;
      let cursor: string | null = null;
      if (page.lastCursor) {
        cursor = `cursor-${++cursorSequence}`;
        cursors.set(cursor, page.lastCursor);
      }
      void Promise.resolve(transformPage ? transformPage(request, page.items) : page.items).then(items => {
        if (!active || sequence !== snapshotSequence) return;
        return onPage({
        items,
        hasNext: page.hasNext,
        cursor,
        changeTypes: page.changeTypes,
        fromCache: page.fromCache,
        hasPendingWrites: page.hasPendingWrites,
        });
      }).catch(error => {
        if (active && sequence === snapshotSequence) onError(error);
      });
    }, onError);
      return () => { active = false; unsubscribe(); };
    },
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
