import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  app: { kind: 'firebase-app' },
  appCheck: { kind: 'app-check' },
  database: { kind: 'firestore' },
  memoryCache: { kind: 'memory-cache' },
  persistentCache: { kind: 'persistent-cache' },
  auth: { kind: 'auth' },
  initializeApp: vi.fn(),
  initializeAppCheck: vi.fn(),
  initializeFirestore: vi.fn(),
  appCheckSiteKeys: [] as string[],
  idTokenObservers: [] as Array<(user: unknown) => void>,
  getFunctions: vi.fn(() => ({ kind: 'functions' })),
}));

const appCheckDebugRuntime = globalThis as typeof globalThis & {
  FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean;
};

vi.mock('firebase/app', () => ({
  getApps: vi.fn(() => []),
  getApp: vi.fn(() => runtime.app),
  initializeApp: runtime.initializeApp,
}));

vi.mock('firebase/app-check', () => ({
  initializeAppCheck: runtime.initializeAppCheck,
  ReCaptchaEnterpriseProvider: class ReCaptchaEnterpriseProvider {
    constructor(siteKey: string) {
      runtime.appCheckSiteKeys.push(siteKey);
    }
  },
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => runtime.auth),
  connectAuthEmulator: vi.fn(),
  GoogleAuthProvider: class GoogleAuthProvider {},
  onIdTokenChanged: vi.fn((_auth: unknown, observer: (user: unknown) => void) => {
    runtime.idTokenObservers.push(observer);
    return () => undefined;
  }),
}));

vi.mock('firebase/functions', () => ({
  getFunctions: runtime.getFunctions,
  connectFunctionsEmulator: vi.fn(),
}));

const memorySessionStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
};

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => runtime.database),
  initializeFirestore: runtime.initializeFirestore,
  memoryLocalCache: vi.fn(() => runtime.memoryCache),
  persistentLocalCache: vi.fn(() => runtime.persistentCache),
  persistentMultipleTabManager: vi.fn(() => ({ kind: 'tabs' })),
  connectFirestoreEmulator: vi.fn(),
}));

describe('Firebase protected-functions runtime composition', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    runtime.appCheckSiteKeys.length = 0;
    runtime.idTokenObservers.length = 0;
    vi.stubGlobal('document', {});
    delete appCheckDebugRuntime.FIREBASE_APPCHECK_DEBUG_TOKEN;
    runtime.initializeApp.mockReturnValue(runtime.app);
    runtime.initializeAppCheck.mockReturnValue(runtime.appCheck);
    runtime.initializeFirestore.mockReturnValue(runtime.database);
  });

  afterEach(() => {
    delete appCheckDebugRuntime.FIREBASE_APPCHECK_DEBUG_TOKEN;
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not start App Check when the module loads', async () => {
    const firebase = await import('./firebase');

    expect(runtime.initializeApp).toHaveBeenCalledOnce();
    expect(runtime.initializeAppCheck).not.toHaveBeenCalled();
    expect(firebase.appCheck).toBeNull();
    expect(firebase.protectedFunctionsCapability).toEqual({ available: true });
  });

  it('starts App Check once for the first protected calls, even when they run concurrently', async () => {
    const firebase = await import('./firebase');

    await Promise.all([
      firebase.getSonFlashFunctions(runtime.app as never),
      Promise.resolve().then(() => runtime.idTokenObservers[0]({ uid: 'learner' })),
      Promise.resolve().then(() => firebase.ensureAppCheckForSignIn('popup')),
    ]);
    await firebase.getSonFlashFunctions(runtime.app as never);

    expect(runtime.initializeAppCheck).toHaveBeenCalledOnce();
    expect(runtime.initializeAppCheck.mock.invocationCallOrder[0])
      .toBeLessThan(runtime.getFunctions.mock.invocationCallOrder[0]);
    expect(firebase.appCheck).toBe(runtime.appCheck);
  });

  it('starts App Check when a session is restored or signed in, and not for a signed-out visitor', async () => {
    await import('./firebase');
    expect(runtime.idTokenObservers).toHaveLength(1);

    runtime.idTokenObservers[0](null);
    expect(runtime.initializeAppCheck).not.toHaveBeenCalled();

    runtime.idTokenObservers[0]({ uid: 'learner' });
    runtime.idTokenObservers[0]({ uid: 'learner' });
    expect(runtime.initializeAppCheck).toHaveBeenCalledOnce();
  });

  it('starts App Check before a sign-in and again on the page a redirect sign-in returns to', async () => {
    const sessionStorage = memorySessionStorage();
    vi.stubGlobal('sessionStorage', sessionStorage);
    const firebase = await import('./firebase');

    firebase.ensureAppCheckForSignIn('redirect');
    expect(runtime.initializeAppCheck).toHaveBeenCalledOnce();

    vi.resetModules();
    runtime.initializeAppCheck.mockClear();
    await import('./firebase');
    expect(runtime.initializeAppCheck).toHaveBeenCalledOnce();

    vi.resetModules();
    runtime.initializeAppCheck.mockClear();
    await import('./firebase');
    expect(runtime.initializeAppCheck).not.toHaveBeenCalled();
  });

  it('never starts App Check in the emulator build', async () => {
    vi.stubEnv('VITE_SONFLASH_E2E_EMULATOR', 'true');
    vi.stubGlobal('window', {});
    const firebase = await import('./firebase');

    runtime.idTokenObservers[0]({ uid: 'learner' });
    await firebase.getSonFlashFunctions(runtime.app as never);

    expect(runtime.initializeAppCheck).not.toHaveBeenCalled();
    expect(firebase.ensureAppCheck()).toEqual({ available: true });
  });

  it('fails closed when App Check initialization throws', async () => {
    runtime.initializeAppCheck.mockImplementation(() => {
      throw new Error('provider detail');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const firebase = await import('./firebase');
    const unavailable = { available: false, reason: 'app-check-initialization-failed' };

    expect(firebase.ensureAppCheck()).toEqual(unavailable);
    expect(firebase.protectedFunctionsCapability).toEqual(unavailable);
    expect(firebase.ensureAppCheck()).toEqual(unavailable);
    expect(runtime.initializeAppCheck).toHaveBeenCalledOnce();
  });

  it('keeps the sealed host provider when an environment override requests another provider', async () => {
    vi.stubEnv('VITE_FIREBASE_APP_CHECK_PROVIDER', 'v3');
    const firebase = await import('./firebase');
    firebase.ensureAppCheck();
    expect(runtime.initializeAppCheck).toHaveBeenCalledOnce();
    expect(runtime.appCheckSiteKeys).toHaveLength(1);
  });

  it('enables protected functions only after App Check initializes', async () => {

    const firebase = await import('./firebase');

    expect(firebase.ensureAppCheck()).toEqual({ available: true });
    expect(firebase.protectedFunctionsCapability).toEqual({ available: true });
    expect(runtime.initializeAppCheck).toHaveBeenCalledOnce();
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'uses the registered App Check debug token before initialization on %s',
    async hostname => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_FIREBASE_APP_CHECK_DEBUG', 'true');
      vi.stubGlobal('location', { hostname });
      runtime.initializeAppCheck.mockImplementation(() => {
        expect(appCheckDebugRuntime.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(true);
        return runtime.appCheck;
      });

      const firebase = await import('./firebase');
      firebase.ensureAppCheck();

      expect(runtime.initializeAppCheck).toHaveBeenCalledOnce();
      expect(appCheckDebugRuntime.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(true);
    },
  );

  it('does not enable App Check debug mode on a non-loopback DEV host', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_FIREBASE_APP_CHECK_DEBUG', 'true');
    vi.stubGlobal('location', { hostname: '192.0.2.1' });

    const firebase = await import('./firebase');
    firebase.ensureAppCheck();

    expect(appCheckDebugRuntime.FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined();
  });

  it('uses memory Firestore cache in Safari to avoid a stalled persistent multi-tab queue', async () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15',
    });

    await import('./firebase');

    expect(runtime.initializeFirestore).toHaveBeenCalledWith(
      runtime.app,
      expect.objectContaining({
        localCache: runtime.memoryCache,
      }),
      expect.any(String),
    );
  });

  it.each([
    {
      name: 'emulator Firefox',
      emulator: true,
      userAgent: 'Mozilla/5.0 Firefox/128.0',
      cache: 'memory',
      forceLongPolling: false,
    },
    {
      name: 'emulator Safari',
      emulator: true,
      userAgent: 'Mozilla/5.0 AppleWebKit/605.1.15 Version/18.6 Safari/605.1.15',
      cache: 'memory',
      forceLongPolling: true,
    },
    {
      name: 'production Firefox',
      emulator: false,
      userAgent: 'Mozilla/5.0 Firefox/128.0',
      cache: 'persistent',
      forceLongPolling: false,
    },
  ])('configures Firestore transport for $name', async ({ emulator, userAgent, cache, forceLongPolling }) => {
    vi.stubEnv('VITE_SONFLASH_E2E_EMULATOR', String(emulator));
    vi.stubGlobal('navigator', { userAgent });
    if (emulator) vi.stubGlobal('window', {});

    await import('./firebase');

    expect(runtime.initializeFirestore).toHaveBeenCalledWith(
      runtime.app,
      expect.objectContaining({
        localCache: cache === 'memory' ? runtime.memoryCache : runtime.persistentCache,
        experimentalForceLongPolling: forceLongPolling,
      }),
      expect.any(String),
    );
  });

  it('uses the isolated Firestore port only in an emulator build', async () => {
    vi.stubEnv('VITE_SONFLASH_E2E_EMULATOR', 'true');
    vi.stubEnv('VITE_SONFLASH_FIRESTORE_EMULATOR_PORT', '8185');
    vi.stubGlobal('window', {});
    await import('./firebase');
    const { connectFirestoreEmulator } = await import('firebase/firestore');
    expect(connectFirestoreEmulator).toHaveBeenCalledWith(runtime.database, '127.0.0.1', 8185);
  });

  it('keeps the Firebase-registered auth domain for production OAuth redirects', async () => {
    vi.stubGlobal('location', {
      hostname: 'encoded-hangout-433912-h2.web.app',
    });

    await import('./firebase');

    expect(runtime.initializeApp).toHaveBeenCalledWith(expect.objectContaining({
      authDomain: 'encoded-hangout-433912-h2.web.app',
    }));
  });

  it('selects the isolated Firebase project on the approved staging host', async () => {
    vi.stubGlobal('location', {
      hostname: 'sonflash-staging-20260906.web.app',
    });

    const firebase = await import('./firebase');
    firebase.ensureAppCheck();

    expect(runtime.initializeApp).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'sonflash-staging-20260906',
      authDomain: 'sonflash-staging-20260906.firebaseapp.com',
    }));
    expect(runtime.appCheckSiteKeys).toEqual(['6LfU3qstAAAAAO7T8BCllqTgTkhd_nWRHlqXhNU6']);
  });

  it('fails closed on an unapproved deployed host', async () => {
    vi.stubGlobal('location', { hostname: 'attacker.example' });

    const firebase = await import('./firebase');

    expect(firebase.isFirebaseConfigured).toBe(false);
    expect(runtime.initializeApp).not.toHaveBeenCalled();
  });
});
