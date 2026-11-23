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
  applyCategoryDeltas: vi.fn(),
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
    const memoryStorage = (): Pick<Storage, 'getItem' | 'setItem'> => {
      const values = new Map<string, string>();
      return {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => { values.set(key, value); },
      };
    };
    const createAdapter = (storage: Pick<Storage, 'getItem' | 'setItem'> | null = memoryStorage()) =>
      createIdentitySessionFirebaseAdapter({
        app: null,
        auth: { kind: 'auth' } as never,
        database: database as never,
        configured: true,
        storage,
      });

    beforeEach(() => {
      repository.getLibraryState.mockReset();
      repository.deleteAllCards.mockReset().mockResolvedValue({});
      repository.clearLibraryFacets.mockReset().mockResolvedValue({ categories: {}, complete: true });
      repository.applyCategoryDeltas.mockReset().mockResolvedValue({ categories: {}, complete: true });
      repository.settleLibraryClear.mockReset().mockResolvedValue(undefined);
    });

    it('finishes a clear of the current generation that stopped part way before returning the epoch', async () => {
      const order: string[] = [];
      repository.getLibraryState.mockResolvedValue({ libraryEpoch: 5, clearPendingEpoch: 5 });
      repository.deleteAllCards.mockImplementation(async () => { order.push('delete-cards'); return {}; });
      repository.clearLibraryFacets.mockImplementation(async () => { order.push('clear-facets'); });
      repository.settleLibraryClear.mockImplementation(async () => { order.push('settle'); });

      await expect(createAdapter().loadOwnerEpoch('owner-1')).resolves.toBe(5);

      expect(order).toEqual(['delete-cards', 'clear-facets', 'settle']);
      expect(repository.deleteAllCards).toHaveBeenCalledWith(database, 'owner-1', 5);
      expect(repository.clearLibraryFacets).toHaveBeenCalledWith(database, 'owner-1');
      expect(repository.applyCategoryDeltas).not.toHaveBeenCalled();
      expect(repository.settleLibraryClear).toHaveBeenCalledWith(database, 'owner-1', 5);
    });

    it('counts the cards of the current generation again after resetting the facets', async () => {
      const order: string[] = [];
      repository.getLibraryState.mockResolvedValue({ libraryEpoch: 5, clearPendingEpoch: 5 });
      repository.deleteAllCards.mockImplementation(async () => {
        order.push('delete-cards');
        return { Food: 20, Other: 2 };
      });
      repository.clearLibraryFacets.mockImplementation(async () => { order.push('clear-facets'); });
      repository.applyCategoryDeltas.mockImplementation(async () => { order.push('recount'); });
      repository.settleLibraryClear.mockImplementation(async () => { order.push('settle'); });

      await expect(createAdapter().loadOwnerEpoch('owner-1')).resolves.toBe(5);

      expect(order).toEqual(['delete-cards', 'clear-facets', 'recount', 'settle']);
      expect(repository.applyCategoryDeltas).toHaveBeenCalledWith(database, 'owner-1', { Food: 20, Other: 2 });
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

    it('stops finishing the same unfinished clear on load after a bounded number of attempts', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const storage = memoryStorage();
      repository.getLibraryState.mockResolvedValue({ libraryEpoch: 5, clearPendingEpoch: 5 });
      repository.clearLibraryFacets.mockRejectedValue(new Error('facet operation could not be stored'));

      for (let load = 0; load < 5; load += 1) {
        await expect(createAdapter(storage).loadOwnerEpoch('owner-1')).resolves.toBe(5);
      }
      expect(repository.deleteAllCards).toHaveBeenCalledTimes(3);

      repository.getLibraryState.mockResolvedValue({ libraryEpoch: 6, clearPendingEpoch: 6 });
      await expect(createAdapter(storage).loadOwnerEpoch('owner-1')).resolves.toBe(6);
      expect(repository.deleteAllCards).toHaveBeenCalledTimes(4);
      expect(repository.deleteAllCards).toHaveBeenLastCalledWith(database, 'owner-1', 6);
      warn.mockRestore();
    });

    it('does not start the clear pass when browser storage cannot record the attempt', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      repository.getLibraryState.mockResolvedValue({ libraryEpoch: 5, clearPendingEpoch: 5 });
      const blocked: Pick<Storage, 'getItem' | 'setItem'> = {
        getItem: () => null,
        setItem: () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); },
      };

      await expect(createAdapter(blocked).loadOwnerEpoch('owner-1')).resolves.toBe(5);
      await expect(createAdapter(null).loadOwnerEpoch('owner-1')).resolves.toBe(5);

      expect(repository.deleteAllCards).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
