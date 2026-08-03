export interface IdentityOwner {
  id: string;
  displayName: string | null;
  email: string | null;
  photoUrl: string | null;
}

export interface IdentitySessionAdapter {
  readonly available: boolean;
  observeOwner(
    onOwner: (owner: IdentityOwner | null) => void | Promise<void>,
    onError: (error: unknown) => void,
  ): () => void;
  signInWithPopup(): Promise<void>;
  signInWithRedirect(): Promise<void>;
  signOut(): Promise<void>;
  readCachedOwnerEpoch(ownerId: string): number | null;
  cacheOwnerEpoch(ownerId: string, epoch: number): void;
  loadOwnerEpoch(ownerId: string): Promise<number>;
}

export interface IdentitySessionSnapshot {
  status: 'loading' | 'anonymous' | 'authenticated';
  owner: IdentityOwner | null;
  ownerEpoch: { ownerId: string; value: number } | null;
  canPublishMutations: boolean;
  isSigningIn: boolean;
  isSigningOut: boolean;
  error: string | null;
}

type IdentityActionResult =
  | { status: 'completed' }
  | { status: 'redirecting' }
  | { status: 'busy' }
  | { status: 'unavailable' }
  | { status: 'failed'; error: unknown };

const safetyError = 'Cloud sync safety could not be verified. Your library remains readable, but changes are paused until Firebase reconnects.';
const unavailableError = 'Cloud sync is not enabled. Check the Firebase configuration and reload the app.';

const validEpoch = (value: unknown): number | null =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;

const errorCode = (error: unknown): string => {
  if (!error || typeof error !== 'object' || !('code' in error)) return '';
  return String((error as { code?: unknown }).code);
};

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : 'Could not sign in to Firebase.';

export function createIdentitySessionController({
  adapter,
  hostname = globalThis.location?.hostname ?? 'this domain',
}: {
  adapter: IdentitySessionAdapter;
  hostname?: string;
}) {
  let snapshot: IdentitySessionSnapshot = {
    status: adapter.available ? 'loading' : 'anonymous',
    owner: null,
    ownerEpoch: null,
    canPublishMutations: false,
    isSigningIn: false,
    isSigningOut: false,
    error: null,
  };
  let ownerPublication = 0;
  let unsubscribeOwner: (() => void) | null = null;
  let signingIn = false;
  let signingOut = false;
  const listeners = new Set<(next: IdentitySessionSnapshot) => void>();

  const publish = (patch: Partial<IdentitySessionSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach(listener => listener(snapshot));
  };

  const publishAnonymous = () => publish({
    status: 'anonymous',
    owner: null,
    ownerEpoch: null,
    canPublishMutations: false,
    error: null,
  });

  const stop = () => {
    ownerPublication += 1;
    unsubscribeOwner?.();
    unsubscribeOwner = null;
  };

  const start = () => {
    stop();
    if (!adapter.available) {
      publishAnonymous();
      return () => undefined;
    }

    publish({ status: 'loading', error: null });
    unsubscribeOwner = adapter.observeOwner(async owner => {
      const publication = ++ownerPublication;
      if (!owner) {
        publishAnonymous();
        return;
      }

      publish({
        status: 'loading',
        owner: null,
        ownerEpoch: null,
        canPublishMutations: false,
        error: null,
      });

      let epoch: number | null = null;
      try {
        epoch = validEpoch(adapter.readCachedOwnerEpoch(owner.id));
      } catch {
        epoch = null;
      }

      try {
        const refreshedEpoch = validEpoch(await adapter.loadOwnerEpoch(owner.id));
        if (publication !== ownerPublication) return;
        if (refreshedEpoch !== null) {
          epoch = refreshedEpoch;
          try {
            adapter.cacheOwnerEpoch(owner.id, refreshedEpoch);
          } catch {
            // A verified in-memory epoch remains usable when cache storage is denied.
          }
        }
      } catch {
        if (publication !== ownerPublication) return;
      }

      if (publication !== ownerPublication) return;
      publish({
        status: 'authenticated',
        owner,
        ownerEpoch: epoch === null ? null : { ownerId: owner.id, value: epoch },
        canPublishMutations: epoch !== null,
        error: epoch === null ? safetyError : null,
      });
    }, error => {
      ownerPublication += 1;
      publish({
        status: snapshot.owner ? 'authenticated' : 'anonymous',
        canPublishMutations: Boolean(snapshot.owner && snapshot.ownerEpoch),
        error: error instanceof Error && error.message
          ? error.message
          : 'Could not restore your cloud session.',
      });
    });
    return stop;
  };

  const signIn = async (): Promise<IdentityActionResult> => {
    if (signingIn) return { status: 'busy' };
    if (!adapter.available) {
      publish({ error: unavailableError });
      return { status: 'unavailable' };
    }

    signingIn = true;
    publish({ isSigningIn: true, error: null });
    try {
      await adapter.signInWithPopup();
      return { status: 'completed' };
    } catch (error) {
      if (errorCode(error) === 'auth/popup-blocked') {
        try {
          await adapter.signInWithRedirect();
          return { status: 'redirecting' };
        } catch (redirectError) {
          publish({ error: errorMessage(redirectError) });
          return { status: 'failed', error: redirectError };
        }
      }

      const code = errorCode(error);
      publish({
        error: code === 'auth/unauthorized-domain'
          ? `Firebase does not allow ${hostname} yet. Add this domain under Authentication → Settings → Authorized domains.`
          : code === 'auth/popup-closed-by-user'
            ? 'The sign-in window was closed before authentication finished.'
            : errorMessage(error),
      });
      return { status: 'failed', error };
    } finally {
      signingIn = false;
      publish({ isSigningIn: false });
    }
  };

  const signOut = async (): Promise<IdentityActionResult> => {
    if (signingOut) return { status: 'busy' };
    if (!adapter.available) return { status: 'unavailable' };

    signingOut = true;
    ownerPublication += 1;
    publish({ isSigningOut: true, error: null });
    try {
      await adapter.signOut();
      publishAnonymous();
      return { status: 'completed' };
    } catch (error) {
      publish({ error: 'Could not sign out right now. Please try again.' });
      return { status: 'failed', error };
    } finally {
      signingOut = false;
      publish({ isSigningOut: false });
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: (next: IdentitySessionSnapshot) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start,
    stop,
    signIn,
    signOut,
  };
}
