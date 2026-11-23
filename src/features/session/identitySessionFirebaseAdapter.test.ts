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

const repository = vi.hoisted(() => ({
  getLibraryState: vi.fn(),
  deleteAllCards: vi.fn(),
  clearLibraryFacets: vi.fn(),
  settleLibraryClear: vi.fn(),
}));

vi.mock('../../lib/cardRepository', () => repository);

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

  describe('owner epoch load', () => {
    const database = { kind: 'database' };
    const createAdapter = () => createIdentitySessionFirebaseAdapter({
      app: null,
      auth: { kind: 'auth' } as never,
      database: database as never,
      configured: true,
      storage: null,
    });

    it('finishes a clear of the current generation that stopped part way before returning the epoch', async () => {
      const order: string[] = [];
      repository.getLibraryState.mockResolvedValue({ libraryEpoch: 5, clearPendingEpoch: 5 });
      repository.deleteAllCards.mockImplementation(async () => { order.push('delete-cards'); });
      repository.clearLibraryFacets.mockImplementation(async () => { order.push('clear-facets'); });
      repository.settleLibraryClear.mockImplementation(async () => { order.push('settle'); });

      await expect(createAdapter().loadOwnerEpoch('owner-1')).resolves.toBe(5);

      expect(order).toEqual(['delete-cards', 'clear-facets', 'settle']);
      expect(repository.deleteAllCards).toHaveBeenCalledWith(database, 'owner-1', 5);
      expect(repository.clearLibraryFacets).toHaveBeenCalledWith(database, 'owner-1');
      expect(repository.settleLibraryClear).toHaveBeenCalledWith(database, 'owner-1', 5);
    });

    it('adds no clear work when no clear of the current generation is pending', async () => {
      repository.getLibraryState
        .mockResolvedValueOnce({ libraryEpoch: 5, clearPendingEpoch: null })
        .mockResolvedValueOnce({ libraryEpoch: 6, clearPendingEpoch: 5 });

      await expect(createAdapter().loadOwnerEpoch('owner-1')).resolves.toBe(5);
      await expect(createAdapter().loadOwnerEpoch('owner-1')).resolves.toBe(6);

      expect(repository.deleteAllCards).not.toHaveBeenCalled();
      expect(repository.clearLibraryFacets).not.toHaveBeenCalled();
      expect(repository.settleLibraryClear).not.toHaveBeenCalled();
    });

    it('keeps the marker and still verifies the epoch when finishing the clear fails', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      repository.getLibraryState.mockResolvedValue({ libraryEpoch: 5, clearPendingEpoch: 5 });
      repository.deleteAllCards.mockRejectedValue(new Error('clear page unavailable'));

      await expect(createAdapter().loadOwnerEpoch('owner-1')).resolves.toBe(5);

      expect(repository.clearLibraryFacets).not.toHaveBeenCalled();
      expect(repository.settleLibraryClear).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
