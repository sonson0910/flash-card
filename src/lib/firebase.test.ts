import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  app: { kind: 'firebase-app' },
  appCheck: { kind: 'app-check' },
  database: { kind: 'firestore' },
  memoryCache: { kind: 'memory-cache' },
  auth: { kind: 'auth' },
  initializeApp: vi.fn(),
  initializeAppCheck: vi.fn(),
  initializeFirestore: vi.fn(),
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
  ReCaptchaEnterpriseProvider: class ReCaptchaEnterpriseProvider {},
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => runtime.auth),
  GoogleAuthProvider: class GoogleAuthProvider {},
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => runtime.database),
  initializeFirestore: runtime.initializeFirestore,
  memoryLocalCache: vi.fn(() => runtime.memoryCache),
  persistentLocalCache: vi.fn(() => ({ kind: 'cache' })),
  persistentMultipleTabManager: vi.fn(() => ({ kind: 'tabs' })),
}));

describe('Firebase protected-functions runtime composition', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
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

  it('fails closed when the App Check site key is missing', async () => {
    vi.stubEnv('VITE_FIREBASE_APP_CHECK_SITE_KEY', '');

    const firebase = await import('./firebase');

    expect(firebase.protectedFunctionsCapability).toEqual({
      available: false,
      reason: 'app-check-unconfigured',
    });
    expect(runtime.initializeAppCheck).not.toHaveBeenCalled();
  });

  it('fails closed when App Check initialization throws', async () => {
    vi.stubEnv('VITE_FIREBASE_APP_CHECK_SITE_KEY', 'enterprise-site-key');
    runtime.initializeAppCheck.mockImplementation(() => {
      throw new Error('provider detail');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const firebase = await import('./firebase');

    expect(firebase.protectedFunctionsCapability).toEqual({
      available: false,
      reason: 'app-check-initialization-failed',
    });
  });

  it('enables protected functions only after App Check initializes', async () => {
    vi.stubEnv('VITE_FIREBASE_APP_CHECK_SITE_KEY', 'enterprise-site-key');

    const firebase = await import('./firebase');

    expect(firebase.protectedFunctionsCapability).toEqual({ available: true });
    expect(runtime.initializeAppCheck).toHaveBeenCalledOnce();
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'uses the registered App Check debug token before initialization on %s',
    async hostname => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_FIREBASE_APP_CHECK_SITE_KEY', 'enterprise-site-key');
    vi.stubEnv('VITE_FIREBASE_APP_CHECK_DEBUG', 'true');
      vi.stubGlobal('location', { hostname });
      runtime.initializeAppCheck.mockImplementation(() => {
        expect(appCheckDebugRuntime.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(true);
        return runtime.appCheck;
      });

      await import('./firebase');

      expect(appCheckDebugRuntime.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(true);
    },
  );

  it('does not enable App Check debug mode on a non-loopback DEV host', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_FIREBASE_APP_CHECK_SITE_KEY', 'enterprise-site-key');
    vi.stubEnv('VITE_FIREBASE_APP_CHECK_DEBUG', 'true');
    vi.stubGlobal('location', { hostname: '192.0.2.1' });

    await import('./firebase');

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

  it('keeps the Firebase-registered auth domain for production OAuth redirects', async () => {
    vi.stubGlobal('location', {
      hostname: 'encoded-hangout-433912-h2.web.app',
    });

    await import('./firebase');

    expect(runtime.initializeApp).toHaveBeenCalledWith(expect.objectContaining({
      authDomain: 'encoded-hangout-433912-h2.web.app',
    }));
  });
});
