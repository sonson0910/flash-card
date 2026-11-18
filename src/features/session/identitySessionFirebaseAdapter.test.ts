import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseAuth = vi.hoisted(() => ({
  getRedirectResult: vi.fn(),
  onAuthStateChanged: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(),
  getRedirectResult: firebaseAuth.getRedirectResult,
  GoogleAuthProvider: class GoogleAuthProvider {},
  onAuthStateChanged: firebaseAuth.onAuthStateChanged,
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
}));

vi.mock('../../lib/cardRepository', () => ({
  getLibraryEpoch: vi.fn(),
}));

import { createIdentitySessionFirebaseAdapter } from './identitySessionFirebaseAdapter';
import { createIdentitySessionController } from './identitySessionController';

describe('identity session Firebase adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firebaseAuth.getRedirectResult.mockResolvedValue(null);
    firebaseAuth.onAuthStateChanged.mockReturnValue(() => undefined);
  });

  it('completes a pending redirect and exposes redirect failures', async () => {
    const auth = { kind: 'auth' };
    const redirectError = Object.assign(new Error('Redirect session unavailable.'), {
      code: 'auth/web-storage-unsupported',
    });
    firebaseAuth.getRedirectResult.mockRejectedValue(redirectError);
    const onError = vi.fn();
    const adapter = createIdentitySessionFirebaseAdapter({
      app: null,
      auth: auth as never,
      configured: true,
      storage: null,
    });

    adapter.observeOwner(vi.fn(), onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(redirectError));

    expect(firebaseAuth.getRedirectResult).toHaveBeenCalledWith(auth);
  });

  it('enters recoverable state when the Firebase auth observer loses a known user', async () => {
    let emitAuthState: ((user: unknown) => void) | null = null;
    firebaseAuth.onAuthStateChanged.mockImplementation((_auth, next) => {
      emitAuthState = next as (user: unknown) => void;
      return () => undefined;
    });
    const auth = { kind: 'auth' };
    const adapter = createIdentitySessionFirebaseAdapter({
      app: null,
      auth: auth as never,
      configured: true,
      storage: null,
    });
    const session = createIdentitySessionController({ adapter });
    session.start();
    const sendAuthState = (user: unknown) => {
      if (!emitAuthState) throw new Error('Firebase auth observer was not registered.');
      emitAuthState(user);
    };

    sendAuthState({ uid: 'known-owner', displayName: 'Learner', email: null, photoURL: null });
    await vi.waitFor(() => expect(session.getSnapshot().owner?.id).toBe('known-owner'));
    sendAuthState(null);
    await vi.waitFor(() => expect(session.getSnapshot().authenticationRecovery).toBe('session-lost'));

    expect(session.getSnapshot()).toMatchObject({
      owner: { id: 'known-owner' },
      ownerEpoch: null,
      canPublishMutations: false,
      authenticationRecovery: 'session-lost',
    });
  });
});
