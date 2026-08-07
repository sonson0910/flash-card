import type { FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getLibraryEpoch } from '../../lib/cardRepository';
import type { IdentitySessionAdapter } from './identitySessionController';

const epochCacheKey = (ownerId: string) => `lingoflash_library_epoch_${encodeURIComponent(ownerId)}`;

const browserStorage = (): Pick<Storage, 'getItem' | 'setItem'> | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export function createIdentitySessionFirebaseAdapter({
  app,
  auth = app ? getAuth(app) : null,
  database = app ? getFirestore(app) : null,
  provider = new GoogleAuthProvider(),
  configured = Boolean(app && auth),
  storage: suppliedStorage,
}: {
  app: FirebaseApp | null;
  auth?: Auth | null;
  database?: Firestore | null;
  provider?: GoogleAuthProvider;
  configured?: boolean;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}): IdentitySessionAdapter {
  const storage = suppliedStorage === undefined ? browserStorage() : suppliedStorage;
  const requireAuth = (): Auth => {
    if (!configured || !auth) throw new Error('Cloud authentication is not configured.');
    return auth;
  };

  return {
    available: Boolean(configured && auth && provider),
    observeOwner: (onOwner, onError) => {
      if (!configured || !auth) {
        void onOwner(null);
        return () => undefined;
      }
      return onAuthStateChanged(auth, current => {
        void onOwner(current ? {
          id: current.uid,
          displayName: current.displayName,
          email: current.email,
          photoUrl: current.photoURL,
        } : null);
      }, onError);
    },
    signInWithPopup: async () => {
      await signInWithPopup(requireAuth(), provider);
    },
    signInWithRedirect: async () => {
      await signInWithRedirect(requireAuth(), provider);
    },
    signOut: async () => {
      await signOut(requireAuth());
    },
    readCachedOwnerEpoch: ownerId => {
      try {
        const cached = storage?.getItem(epochCacheKey(ownerId)) ?? null;
        if (cached === null) return null;
        const value = Number(cached);
        return Number.isSafeInteger(value) && value >= 0 ? value : null;
      } catch {
        return null;
      }
    },
    cacheOwnerEpoch: (ownerId, epoch) => {
      storage?.setItem(epochCacheKey(ownerId), String(epoch));
    },
    loadOwnerEpoch: async ownerId => {
      if (!database) throw new Error('Cloud library storage is not configured.');
      return getLibraryEpoch(database, ownerId);
    },
  };
}
