import type { FirebaseApp } from 'firebase/app';
import { doc, getDoc, type Firestore } from 'firebase/firestore';
import type { SharedDeckAdapter } from './sharedDeckSessionController';
import { createSharedDeckShare, revokeSharedDeckShare } from './sharedDeckService';

interface SharedDeckFirebaseAdapterOptions {
  app: FirebaseApp | null;
  database: Firestore | null;
  configured: boolean;
}

export function createSharedDeckFirebaseAdapter({
  app,
  database,
  configured,
}: SharedDeckFirebaseAdapterOptions): SharedDeckAdapter {
  const requireApp = (): FirebaseApp => {
    if (!configured || !app) throw new Error('Shared-deck service is unavailable.');
    return app;
  };

  const requireDatabase = (): Firestore => {
    if (!configured || !database) throw new Error('Shared-deck storage is unavailable.');
    return database;
  };

  return {
    async load(shareId) {
      const snapshot = await getDoc(doc(requireDatabase(), 'shared_decks', shareId));
      if (!snapshot.exists()) throw new Error('Shared deck was not found.');
      return snapshot.data();
    },
    create: ({ ownerId, category, cards, opId, operationCreatedAt }) => createSharedDeckShare(
      requireApp(),
      category,
      [...cards],
      ownerId,
      opId,
      operationCreatedAt,
    ),
    revoke: (shareId, ownerId) => revokeSharedDeckShare(requireApp(), shareId, ownerId),
  };
}
