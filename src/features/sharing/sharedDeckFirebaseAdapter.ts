import type { FirebaseApp } from 'firebase/app';
import type { SharedDeckAdapter } from './sharedDeckSessionController';
import {
  createSharedDeckShare,
  loadSharedDeckShare,
  revokeSharedDeckShare,
} from './sharedDeckService';

interface SharedDeckFirebaseAdapterOptions {
  app: FirebaseApp | null;
  configured: boolean;
}

export function createSharedDeckFirebaseAdapter({
  app,
  configured,
}: SharedDeckFirebaseAdapterOptions): SharedDeckAdapter {
  const requireApp = (): FirebaseApp => {
    if (!configured || !app) throw new Error('Shared-deck service is unavailable.');
    return app;
  };

  return {
    load: shareId => loadSharedDeckShare(requireApp(), shareId),
    create: ({ category, cards }) => createSharedDeckShare(
      requireApp(),
      category,
      [...cards],
    ),
    revoke: shareId => revokeSharedDeckShare(requireApp(), shareId),
  };
}
