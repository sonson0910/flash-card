import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createIdentitySessionController,
  type IdentityOwner,
  type IdentitySessionAdapter,
} from './identitySessionController';

const owner = (id: string): IdentityOwner => ({
  id,
  displayName: `Owner ${id}`,
  email: `${id}@example.test`,
  photoUrl: null,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createFakeAdapter = () => {
  let ownerChanged: ((nextOwner: IdentityOwner | null) => void | Promise<void>) | null = null;
  let observationFailed: ((error: unknown) => void) | null = null;
  const adapter: IdentitySessionAdapter = {
    available: true,
    observeOwner: vi.fn((onOwner, onError) => {
      ownerChanged = onOwner;
      observationFailed = onError;
      return vi.fn();
    }),
    signInWithPopup: vi.fn(async () => undefined),
    signInWithRedirect: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    readCachedOwnerEpoch: vi.fn(() => null),
    cacheOwnerEpoch: vi.fn(),
    loadOwnerEpoch: vi.fn(async () => 0),
  };
  return {
    adapter,
    emitOwner: (value: IdentityOwner | null) => ownerChanged?.(value),
    emitError: (error: unknown) => observationFailed?.(error),
  };
};

describe('identity session controller', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps the controller contract vendor-free and isolates Firebase imports', () => {
    const controllerSource = readFileSync(
      fileURLToPath(new URL('./identitySessionController.ts', import.meta.url)),
      'utf8',
    );
    const adapterSource = readFileSync(
      fileURLToPath(new URL('./identitySessionFirebaseAdapter.ts', import.meta.url)),
      'utf8',
    );

    expect(controllerSource).not.toMatch(/from\s+['"]firebase(?:\/|['"])/);
    expect(controllerSource).not.toMatch(/Firestore|GoogleAuthProvider|QueryDocumentSnapshot/);
    expect(adapterSource).toMatch(/from\s+['"]firebase\/auth['"]/);
  });

  it('falls back from a blocked popup to redirect and releases the sign-in lock', async () => {
    const { adapter } = createFakeAdapter();
    vi.mocked(adapter.signInWithPopup).mockRejectedValue({ code: 'auth/popup-blocked' });
    const session = createIdentitySessionController({ adapter });

    await expect(session.signIn()).resolves.toEqual({ status: 'redirecting' });

    expect(adapter.signInWithRedirect).toHaveBeenCalledOnce();
    expect(session.getSnapshot()).toMatchObject({ isSigningIn: false, error: null });
  });

  it('prevents concurrent popup attempts before the first promise settles', async () => {
    const { adapter } = createFakeAdapter();
    const popup = deferred<void>();
    vi.mocked(adapter.signInWithPopup).mockReturnValue(popup.promise);
    const session = createIdentitySessionController({ adapter });

    const first = session.signIn();
    await expect(session.signIn()).resolves.toEqual({ status: 'busy' });
    expect(adapter.signInWithPopup).toHaveBeenCalledOnce();
    popup.resolve();
    await expect(first).resolves.toEqual({ status: 'completed' });
  });

  it('releases the app from loading when initial owner observation never resolves', async () => {
    vi.useFakeTimers();
    const { adapter } = createFakeAdapter();
    const session = createIdentitySessionController({ adapter, initialOwnerTimeoutMs: 50 });

    session.start();
    await vi.advanceTimersByTimeAsync(50);

    expect(session.getSnapshot()).toMatchObject({
      status: 'anonymous',
      owner: null,
      canPublishMutations: false,
      error: 'Cloud session check timed out. You can keep learning offline and retry sign-in later.',
    });
  });

  it('bounds a popup that never resolves and releases the sign-in lock', async () => {
    vi.useFakeTimers();
    const { adapter } = createFakeAdapter();
    vi.mocked(adapter.signInWithPopup).mockReturnValue(new Promise(() => undefined));
    const session = createIdentitySessionController({ adapter, signInTimeoutMs: 50 });

    const result = session.signIn();
    await vi.advanceTimersByTimeAsync(50);

    await expect(result).resolves.toMatchObject({ status: 'failed' });
    expect(session.getSnapshot()).toMatchObject({
      isSigningIn: false,
      error: 'Sign-in took too long. Please check your connection and try again.',
    });
  });

  it('publishes only the newest owner when an older epoch request resolves late', async () => {
    const { adapter, emitOwner } = createFakeAdapter();
    const ownerAEpoch = deferred<number>();
    const ownerBEpoch = deferred<number>();
    vi.mocked(adapter.loadOwnerEpoch).mockImplementation(id =>
      id === 'a' ? ownerAEpoch.promise : ownerBEpoch.promise);
    const session = createIdentitySessionController({ adapter });
    session.start();

    const ownerATask = emitOwner(owner('a'));
    const ownerBTask = emitOwner(owner('b'));
    ownerBEpoch.resolve(7);
    await ownerBTask;
    expect(session.getSnapshot()).toMatchObject({
      status: 'authenticated',
      owner: { id: 'b' },
      ownerEpoch: { ownerId: 'b', value: 7 },
    });

    ownerAEpoch.resolve(3);
    await ownerATask;
    expect(session.getSnapshot()).toMatchObject({
      owner: { id: 'b' },
      ownerEpoch: { ownerId: 'b', value: 7 },
    });
    expect(adapter.cacheOwnerEpoch).not.toHaveBeenCalledWith('a', 3);
  });

  it('ignores a queued owner callback from an observer that was stopped and replaced', async () => {
    const observers: Array<(owner: IdentityOwner | null) => void | Promise<void>> = [];
    const { adapter } = createFakeAdapter();
    vi.mocked(adapter.observeOwner).mockImplementation(onOwner => {
      observers.push(onOwner);
      return vi.fn();
    });
    const session = createIdentitySessionController({ adapter });

    session.start();
    session.start();
    await observers[1](owner('current'));
    await observers[0](owner('stale'));

    expect(session.getSnapshot()).toMatchObject({
      owner: { id: 'current' },
      ownerEpoch: { ownerId: 'current', value: 0 },
      canPublishMutations: true,
    });
    expect(adapter.loadOwnerEpoch).not.toHaveBeenCalledWith('stale');
  });

  it('publishes the signed-in owner immediately while epoch verification continues', async () => {
    const { adapter, emitOwner } = createFakeAdapter();
    const epoch = deferred<number>();
    vi.mocked(adapter.loadOwnerEpoch).mockReturnValue(epoch.promise);
    const session = createIdentitySessionController({ adapter });
    session.start();

    const ownerTask = emitOwner(owner('slow-cloud'));

    expect(session.getSnapshot()).toMatchObject({
      status: 'authenticated',
      owner: { id: 'slow-cloud' },
      ownerEpoch: null,
      canPublishMutations: false,
      error: null,
    });

    epoch.resolve(6);
    await ownerTask;
    expect(session.getSnapshot()).toMatchObject({
      ownerEpoch: { ownerId: 'slow-cloud', value: 6 },
      canPublishMutations: true,
    });
  });

  it('never authorizes mutations from a stale cached epoch before cloud verification', async () => {
    const { adapter, emitOwner } = createFakeAdapter();
    const refreshedEpoch = deferred<number>();
    vi.mocked(adapter.loadOwnerEpoch).mockReturnValue(refreshedEpoch.promise);
    vi.mocked(adapter.readCachedOwnerEpoch).mockReturnValue(4);
    const session = createIdentitySessionController({ adapter });
    session.start();

    const ownerTask = emitOwner(owner('cached'));
    expect(session.getSnapshot()).toMatchObject({
      owner: { id: 'cached' },
      ownerEpoch: null,
      canPublishMutations: false,
      error: null,
    });

    refreshedEpoch.resolve(5);
    await ownerTask;
    expect(session.getSnapshot()).toMatchObject({
      ownerEpoch: { ownerId: 'cached', value: 5 },
      canPublishMutations: true,
    });
  });

  it('keeps mutations paused when owner epoch verification fails', async () => {
    const { adapter, emitOwner } = createFakeAdapter();
    vi.mocked(adapter.readCachedOwnerEpoch).mockReturnValue(4);
    vi.mocked(adapter.loadOwnerEpoch).mockRejectedValue(new Error('offline'));
    const session = createIdentitySessionController({ adapter });
    session.start();

    await emitOwner(owner('cached'));

    expect(session.getSnapshot()).toMatchObject({
      owner: { id: 'cached' },
      ownerEpoch: null,
      canPublishMutations: false,
      error: 'Cloud sync safety could not be verified. Your library remains readable, but changes are paused until Firebase reconnects.',
    });
  });

  it('signs out immediately and suppresses an epoch result still pending for the old owner', async () => {
    const { adapter, emitOwner } = createFakeAdapter();
    const epoch = deferred<number>();
    vi.mocked(adapter.loadOwnerEpoch).mockReturnValue(epoch.promise);
    const session = createIdentitySessionController({ adapter });
    session.start();
    const ownerTask = emitOwner(owner('a'));

    await expect(session.signOut()).resolves.toEqual({ status: 'completed' });
    expect(session.getSnapshot()).toMatchObject({
      status: 'anonymous',
      owner: null,
      ownerEpoch: null,
      canPublishMutations: false,
    });

    epoch.resolve(9);
    await ownerTask;
    expect(session.getSnapshot().owner).toBeNull();
  });

  it('maps popup-close and unauthorized-domain errors without leaking adapter values', async () => {
    const { adapter } = createFakeAdapter();
    const session = createIdentitySessionController({ adapter, hostname: 'vocab.example' });
    vi.mocked(adapter.signInWithPopup).mockRejectedValueOnce({ code: 'auth/popup-closed-by-user' });
    await session.signIn();
    expect(session.getSnapshot().error).toBe('The sign-in window was closed before authentication finished.');

    vi.mocked(adapter.signInWithPopup).mockRejectedValueOnce({ code: 'auth/unauthorized-domain' });
    await session.signIn();
    expect(session.getSnapshot().error).toContain('Firebase does not allow vocab.example yet.');
  });
});
