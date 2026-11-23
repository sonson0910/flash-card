import {
  firestoreDailyReadLimitMessage,
  isCloudQuotaError,
} from '../../lib/cloudError';

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
  authenticationRecovery: 'session-lost' | null;
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

const safetyError = 'Cloud connection is unavailable. Saving is paused until it is back.';
/** Waits before each timed retry of a failed owner epoch read; later retries wait for the connection to return. */
const EPOCH_RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 30_000] as const;
const unavailableError = 'Cloud sync is not enabled. Check the Firebase configuration and reload the app.';
const ownerTimeoutError = 'Cloud session check timed out. You can keep learning offline and retry sign-in later.';
const signInTimeoutError = 'Sign-in took too long. Please check your connection and try again.';
const timeoutError = () => Object.assign(new Error(signInTimeoutError), { code: 'auth/timeout' });

const validEpoch = (value: unknown): number | null =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;

/** Calls back when the browser reports the connection is back or the page becomes visible again. */
const subscribeBrowserReconnect = (onReconnect: () => void): (() => void) => {
  const onVisibility = () => { if (globalThis.document?.visibilityState === 'visible') onReconnect(); };
  globalThis.addEventListener?.('online', onReconnect);
  globalThis.document?.addEventListener?.('visibilitychange', onVisibility);
  return () => {
    globalThis.removeEventListener?.('online', onReconnect);
    globalThis.document?.removeEventListener?.('visibilitychange', onVisibility);
  };
};

const errorCode = (error: unknown): string => {
  if (!error || typeof error !== 'object' || !('code' in error)) return '';
  return String((error as { code?: unknown }).code);
};

const shouldRetryWithRedirect = (error: unknown): boolean => {
  const code = errorCode(error);
  return code === 'auth/popup-blocked' || code === 'auth/internal-error';
};

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : 'Could not sign in to Firebase.';

const ownerEpochFailureMessage = (error: unknown): string =>
  isCloudQuotaError(error) ? firestoreDailyReadLimitMessage : safetyError;

export function createIdentitySessionController({
  adapter,
  hostname = globalThis.location?.hostname ?? 'this domain',
  initialOwnerTimeoutMs = 8_000,
  signInTimeoutMs = 15_000,
  subscribeReconnect = subscribeBrowserReconnect,
}: {
  adapter: IdentitySessionAdapter;
  hostname?: string;
  initialOwnerTimeoutMs?: number;
  signInTimeoutMs?: number;
  subscribeReconnect?: (onReconnect: () => void) => () => void;
}) {
  let snapshot: IdentitySessionSnapshot = {
    status: adapter.available ? 'loading' : 'anonymous',
    owner: null,
    ownerEpoch: null,
    canPublishMutations: false,
    authenticationRecovery: null,
    isSigningIn: false,
    isSigningOut: false,
    error: null,
  };
  let ownerPublication = 0;
  let observationGeneration = 0;
  let unsubscribeOwner: (() => void) | null = null;
  let initialOwnerTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let signingIn = false;
  let signingOut = false;
  const listeners = new Set<(next: IdentitySessionSnapshot) => void>();

  const publish = (patch: Partial<IdentitySessionSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach(listener => listener(snapshot));
  };

  const publishAnonymous = (error: string | null = null) => publish({
    status: 'anonymous',
    owner: null,
    ownerEpoch: null,
    canPublishMutations: false,
    authenticationRecovery: null,
    error,
  });

  const clearInitialOwnerTimer = () => {
    if (initialOwnerTimer !== null) globalThis.clearTimeout(initialOwnerTimer);
    initialOwnerTimer = null;
  };

  const waitBounded = <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> => new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(timeoutError()), Math.max(1, timeoutMs));
    void promise.then(value => {
      globalThis.clearTimeout(timer);
      resolve(value);
    }, error => {
      globalThis.clearTimeout(timer);
      reject(error);
    });
  });

  // The pending retry of a failed owner epoch read: a backoff timer and a reconnect subscription.
  let epochRetry: { retry: () => void; timer: ReturnType<typeof globalThis.setTimeout> | null; unsubscribe: () => void } | null = null;

  const cancelEpochRetry = () => {
    if (!epochRetry) return;
    if (epochRetry.timer !== null) globalThis.clearTimeout(epochRetry.timer);
    epochRetry.unsubscribe();
    epochRetry = null;
  };

  const stop = () => {
    cancelEpochRetry();
    observationGeneration += 1;
    ownerPublication += 1;
    clearInitialOwnerTimer();
    unsubscribeOwner?.();
    unsubscribeOwner = null;
  };

  /** Reads the owner's library epoch. A failed read is retried, because card writes stay paused until it succeeds. */
  const verifyOwnerEpoch = async (
    owner: IdentityOwner,
    publication: number,
    activeObservation: number,
    attempt: number,
  ): Promise<void> => {
    const current = () => activeObservation === observationGeneration && publication === ownerPublication;
    let epoch: number | null = null;
    let epochFailure: unknown = null;
    try {
      const refreshedEpoch = validEpoch(await adapter.loadOwnerEpoch(owner.id));
      if (!current()) return;
      if (refreshedEpoch !== null) {
        const acceptedEpoch = snapshot.ownerEpoch?.ownerId === owner.id
          ? snapshot.ownerEpoch.value
          : null;
        if (acceptedEpoch !== null && refreshedEpoch < acceptedEpoch) return;
        epoch = refreshedEpoch;
        try {
          adapter.cacheOwnerEpoch(owner.id, refreshedEpoch);
        } catch {
          // A verified in-memory epoch remains usable when cache storage is denied.
        }
      }
    } catch (error) {
      epochFailure = error;
      if (!current()) return;
    }

    if (!current()) return;
    cancelEpochRetry();
    publish({
      status: 'authenticated',
      owner,
      ownerEpoch: epoch === null ? null : { ownerId: owner.id, value: epoch },
      canPublishMutations: epoch !== null,
      error: epoch === null ? ownerEpochFailureMessage(epochFailure) : null,
    });
    if (epoch !== null) return;

    const retry = () => {
      if (epochRetry?.retry !== retry) return;
      cancelEpochRetry();
      if (!current() || snapshot.ownerEpoch?.ownerId === owner.id) return;
      void verifyOwnerEpoch(owner, publication, activeObservation, attempt + 1);
    };
    const delay = EPOCH_RETRY_DELAYS_MS[attempt];
    epochRetry = {
      retry,
      timer: delay === undefined || isCloudQuotaError(epochFailure)
        ? null
        : globalThis.setTimeout(retry, delay),
      unsubscribe: subscribeReconnect(retry),
    };
  };

  const start = () => {
    stop();
    if (!adapter.available) {
      publishAnonymous();
      return () => undefined;
    }

    publish({ status: 'loading', error: null });
    const activeObservation = observationGeneration;
    initialOwnerTimer = globalThis.setTimeout(() => {
      if (activeObservation !== observationGeneration) return;
      initialOwnerTimer = null;
      if (!snapshot.owner && snapshot.status === 'loading') publishAnonymous(ownerTimeoutError);
    }, Math.max(1, initialOwnerTimeoutMs));

    const onOwner = async (owner: IdentityOwner | null) => {
      if (activeObservation !== observationGeneration) return;
      clearInitialOwnerTimer();
      const publication = ++ownerPublication;
      if (!owner) {
        if (snapshot.owner && !signingOut) {
          // Keep the local owner context while cloud credentials recover.
          publish({
            status: 'authenticated',
            ownerEpoch: null,
            canPublishMutations: false,
            authenticationRecovery: 'session-lost',
            error: null,
          });
        } else {
          publishAnonymous();
        }
        return;
      }

      // Authentication and mutation safety are separate concerns. Expose the
      // signed-in identity immediately so a slow remote epoch read cannot
      // hold the whole application in its loading state. A cached epoch is
      // only a performance hint and never authorizes cloud writes; mutation
      // capability remains paused until the current owner is verified remotely.
      if (snapshot.owner?.id === owner.id) {
        publish({ status: 'authenticated', owner, authenticationRecovery: null, error: null });
      } else {
        publish({
          status: 'authenticated',
          owner,
          ownerEpoch: null,
          canPublishMutations: false,
          authenticationRecovery: null,
          error: null,
        });
      }

      await verifyOwnerEpoch(owner, publication, activeObservation, 0);
    };
    const onOwnerError = (error: unknown) => {
      if (activeObservation !== observationGeneration) return;
      clearInitialOwnerTimer();
      ownerPublication += 1;
      publish({
        status: snapshot.owner ? 'authenticated' : 'anonymous',
        ownerEpoch: null,
        canPublishMutations: false,
        error: error instanceof Error && error.message
          ? error.message
          : 'Could not restore your cloud session.',
      });
    };
    try {
      unsubscribeOwner = adapter.observeOwner(onOwner, onOwnerError);
    } catch (error) {
      onOwnerError(error);
      unsubscribeOwner = null;
    }
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
      await waitBounded(adapter.signInWithPopup(), signInTimeoutMs);
      return { status: 'completed' };
    } catch (error) {
      if (shouldRetryWithRedirect(error)) {
        try {
          await waitBounded(adapter.signInWithRedirect(), signInTimeoutMs);
          return { status: 'redirecting' };
        } catch (redirectError) {
          publish({ error: errorMessage(redirectError) });
          return { status: 'failed', error: redirectError };
        }
      }

      const code = errorCode(error);
      publish({
        error: code === 'auth/timeout'
          ? signInTimeoutError
          : code === 'auth/unauthorized-domain'
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

  const acceptVerifiedOwnerEpoch = (ownerId: string, value: number) => {
    const epoch = validEpoch(value);
    if (!snapshot.owner || snapshot.owner.id !== ownerId || epoch === null || snapshot.authenticationRecovery !== null) return false;
    if (snapshot.ownerEpoch?.ownerId === ownerId && epoch < snapshot.ownerEpoch.value) return false;
    try { adapter.cacheOwnerEpoch(ownerId, epoch); } catch { /* verified memory state remains valid */ }
    publish({ ownerEpoch: { ownerId, value: epoch }, canPublishMutations: true, error: null });
    return true;
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
    clearError: () => publish({ error: null }),
    acceptVerifiedOwnerEpoch,
  };
}
