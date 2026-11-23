import type { FirebaseApp } from 'firebase/app';
import {
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type Auth,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import {
  applyCategoryDeltas,
  clearLibraryFacets,
  deleteAllCards,
  getLibraryState,
  settleLibraryClear,
} from '../../lib/cardRepository';
import type { IdentitySessionAdapter } from './identitySessionController';

const epochCacheKey = (ownerId: string) => `lingoflash_library_epoch_${encodeURIComponent(ownerId)}`;
const clearResumeKey = (ownerId: string) => `lingoflash_library_clear_resume_${encodeURIComponent(ownerId)}`;

/**
 * Loads in one browser that may try to finish the same unfinished clear. Each
 * try reads every card, so a failure that keeps repeating stops costing reads;
 * clearing the library again starts a new generation with its own tries.
 */
export const MAX_UNFINISHED_CLEAR_RESUME_ATTEMPTS = 3;

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
  // Records one more try for this generation. Without browser storage the tries
  // cannot be bounded and the facet reset cannot run, so the clear is not started.
  const recordClearResumeAttempt = (ownerId: string, libraryEpoch: number): boolean => {
    try {
      if (!storage) return false;
      let stored: unknown = null;
      try {
        stored = JSON.parse(storage.getItem(clearResumeKey(ownerId)) ?? 'null');
      } catch {
        // An unreadable record counts as no earlier try.
      }
      const previous = stored && typeof stored === 'object' && (stored as { epoch?: unknown }).epoch === libraryEpoch
        ? Number((stored as { attempts?: unknown }).attempts)
        : 0;
      const attempts = Number.isSafeInteger(previous) && previous > 0 ? previous : 0;
      if (attempts >= MAX_UNFINISHED_CLEAR_RESUME_ATTEMPTS) return false;
      storage.setItem(clearResumeKey(ownerId), JSON.stringify({ epoch: libraryEpoch, attempts: attempts + 1 }));
      return true;
    } catch (error) {
      console.warn('An unfinished library clear was not resumed because browser storage is unavailable.', error);
      return false;
    }
  };
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
      let active = true;
      const unsubscribe = onAuthStateChanged(auth, current => {
        void onOwner(current ? {
          id: current.uid,
          displayName: current.displayName,
          email: current.email,
          photoUrl: current.photoURL,
        } : null);
      }, onError);
      // Firebase completes the redirect during Auth initialization, but it
      // deliberately hides redirect errors until getRedirectResult is called.
      // Consume it so a failed redirect does not silently return as anonymous.
      void getRedirectResult(auth).catch(error => {
        if (active) onError(error);
      });
      return () => {
        active = false;
        unsubscribe();
      };
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
      const { libraryEpoch, clearPendingEpoch } = await getLibraryState(database, ownerId);
      if (clearPendingEpoch === libraryEpoch && recordClearResumeAttempt(ownerId, libraryEpoch)) {
        // A clear of this generation stopped part way, so older cards may still be stored.
        // Finish it before card writes resume; a failure leaves the marker for the next load.
        try {
          const keptCategories = await deleteAllCards(database, ownerId, libraryEpoch);
          await clearLibraryFacets(database, ownerId);
          // Cards of this generation may have been added since the clear started.
          if (Object.keys(keptCategories).length > 0) await applyCategoryDeltas(database, ownerId, keptCategories);
          await settleLibraryClear(database, ownerId, libraryEpoch);
        } catch (error) {
          console.warn('An unfinished library clear could not be completed yet.', error);
        }
      }
      return libraryEpoch;
    },
  };
}
