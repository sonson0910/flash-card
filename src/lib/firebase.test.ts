import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  app: { kind: 'firebase-app' },
  appCheck: { kind: 'app-check' },
  database: { kind: 'firestore' },
  auth: { kind: 'auth' },
  initializeAppCheck: vi.fn(),
}));

vi.mock('firebase/app', () => ({
  getApps: vi.fn(() => []),
  getApp: vi.fn(() => runtime.app),
  initializeApp: vi.fn(() => runtime.app),
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
  initializeFirestore: vi.fn(() => runtime.database),
  persistentLocalCache: vi.fn(() => ({ kind: 'cache' })),
  persistentMultipleTabManager: vi.fn(() => ({ kind: 'tabs' })),
}));

describe('Firebase protected-functions runtime composition', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    runtime.initializeAppCheck.mockReturnValue(runtime.appCheck);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
});
