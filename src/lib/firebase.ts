import { initializeApp, getApp, getApps, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  ReCaptchaV3Provider,
  type AppCheck,
} from 'firebase/app-check';
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  signInWithCustomToken,
  type Auth,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
// Type-only: erased at compile time, so this never pulls the 'firebase/functions'
// runtime module (and its weight) into any bundle, including the initial one.
import type { Functions } from 'firebase/functions';
import productionFirebaseConfig from '../../firebase-applet-config.json';
import { resolveProtectedFunctionsCapability } from './protectedFunctionsCapability';

// The sealed artifact serves both approved live hosts; emulator builds stay isolated.
const isE2eEmulatorBuild = import.meta.env.VITE_SONFLASH_E2E_EMULATOR === 'true';
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const host = typeof location === 'undefined' ? '' : location.hostname;
const configuredTargets = productionFirebaseConfig.targets;
const fallbackTarget = import.meta.env.VITE_SONFLASH_BUILD_TARGET === 'staging'
  ? configuredTargets.staging : configuredTargets.production;
const selectedTarget = Object.values(configuredTargets).find(target => target.allowedHosts.includes(host))
  ?? (host === '' || loopbackHosts.has(host) ? fallbackTarget : null);
const { allowedHosts: _allowedHosts, ...selectedFirebaseConfig } = selectedTarget ?? {
  allowedHosts: [], appCheckSiteKey: '', appCheckProvider: 'enterprise', apiKey: '', authDomain: '', projectId: '',
  storageBucket: '', messagingSenderId: '', appId: '', measurementId: '', firestoreDatabaseId: '',
};
const firebaseConfig: FirebaseOptions & { firestoreDatabaseId?: string } = isE2eEmulatorBuild ? {
  apiKey: 'demo-api-key', authDomain: 'demo-lingoflash.firebaseapp.com',
  projectId: 'demo-lingoflash', appId: 'demo-app-id',
  firestoreDatabaseId: configuredTargets.production.firestoreDatabaseId,
} : selectedFirebaseConfig;
export const isFirebaseConfigured = !!firebaseConfig.apiKey?.trim();
const appCheckSiteKey = typeof document === 'undefined' ? '' : selectedFirebaseConfig.appCheckSiteKey.trim();

let appInstance: FirebaseApp | null = null;
let appCheckInstance: AppCheck | null = null;
let dbInstance: Firestore | null = null;
let authInstance: Auth | null = null;
let googleProviderInstance: GoogleAuthProvider | null = null;

function isSafariBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent;
  return /Safari\//.test(userAgent)
    && !/(Chrome|Chromium|CriOS|FxiOS|Edg|EdgiOS|OPR|OPiOS)\//.test(userAgent);
}

if (isFirebaseConfigured) {
  try {
    appInstance = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    // The emulator suite runs with App Check enforcement off; initializing it
    // there would send the local site key and a debug token to Google.
    if (appCheckSiteKey && !isE2eEmulatorBuild) {
      try {
        const isLocalhost = typeof location !== 'undefined'
          && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
        if (isLocalhost && import.meta.env.VITE_FIREBASE_APP_CHECK_DEBUG === 'true') {
          (globalThis as typeof globalThis & { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
        }
        appCheckInstance = initializeAppCheck(appInstance, {
          // Provider and site key travel together with the sealed host target.
          provider: selectedFirebaseConfig.appCheckProvider === 'v3'
            ? new ReCaptchaV3Provider(appCheckSiteKey)
            : new ReCaptchaEnterpriseProvider(appCheckSiteKey),
          isTokenAutoRefreshEnabled: true,
        });
      } catch (appCheckError) {
        console.error('Firebase App Check could not initialize; protected calls may be unavailable.', appCheckError);
      }
    }
    const dbId = 'firestoreDatabaseId' in firebaseConfig && typeof firebaseConfig.firestoreDatabaseId === 'string'
      ? firebaseConfig.firestoreDatabaseId
      : undefined;
    try {
      const safari = isSafariBrowser();
      dbInstance = initializeFirestore(appInstance, {
        // Safari can leave Firestore's persistent multi-tab queue wedged after
        // rapid local dev reloads. The Firefox emulator suite also reloads
        // quickly enough to stall that queue; production Firefox keeps persistence.
        localCache: safari || (isE2eEmulatorBuild && typeof navigator !== 'undefined' && /Firefox\//.test(navigator.userAgent))
          ? memoryLocalCache()
          : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
        // The WebKit emulator's WebChannel can buffer query results indefinitely.
        experimentalForceLongPolling: isE2eEmulatorBuild && safari,
      }, dbId);
    } catch {
      dbInstance = dbId ? getFirestore(appInstance, dbId) : getFirestore(appInstance);
    }
    authInstance = getAuth(appInstance);
    googleProviderInstance = new GoogleAuthProvider();
    if (isE2eEmulatorBuild && dbInstance) {
      connectEmulatorsForTests(authInstance, dbInstance);
    }
  } catch (err) {
    console.error("Failed to initialize Firebase with current configuration:", err);
  }
}

function connectEmulatorsForTests(auth: Auth, db: Firestore) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', Number(import.meta.env.VITE_SONFLASH_FIRESTORE_EMULATOR_PORT || 8080));
  (window as Window & { __SONFLASH_TEST__?: unknown }).__SONFLASH_TEST__ = {
    signInWithCustomToken: async (token: string) => {
      await signInWithCustomToken(auth, token);
    },
    getCurrentUid: () => auth.currentUser?.uid ?? null,
  };
}

const FUNCTIONS_EMULATOR_HOST = '127.0.0.1';
const FUNCTIONS_EMULATOR_PORT = 5001;
let functionsEmulatorConnected = false;

/**
 * Single creation point for every Cloud Functions callable client in the
 * app, so `connectFunctionsEmulator` is wired in exactly one place instead
 * of at each `getFunctions(app, 'asia-southeast1')` call site. The dynamic
 * import matches the lazy-loading pattern already used by every callable
 * call site: 'firebase/functions' is only fetched when a protected function
 * actually runs, so this helper adds nothing to the initial bundle even
 * though `firebase.ts` itself loads on every screen including the landing
 * page.
 */
export async function getSonFlashFunctions(targetApp: FirebaseApp, region = 'asia-southeast1'): Promise<Functions> {
  const { getFunctions, connectFunctionsEmulator } = await import('firebase/functions');
  const functionsInstance = getFunctions(targetApp, region);
  if (isE2eEmulatorBuild && !functionsEmulatorConnected) {
    connectFunctionsEmulator(functionsInstance, FUNCTIONS_EMULATOR_HOST, FUNCTIONS_EMULATOR_PORT);
    functionsEmulatorConnected = true;
  }
  return functionsInstance;
}

// The e2e build has no App Check site key: there is no App Check backend to
// exchange a debug token with inside an offline emulator run, so App Check
// enforcement is disabled server-side for the duration of that emulator
// session instead (functions/.env.local, flipped only while
// scripts/run-e2e-functions-emulator.mjs runs — verified via
// firebase-functions' onCall implementation, which has no emulator-specific
// App Check bypass: a missing token throws 'unauthenticated' whenever
// `enforceAppCheck` resolves true, in the emulator exactly as in
// production). Treat protected callables as available so e2e exercises the
// real callable path end to end. `isE2eEmulatorBuild` is a compile-time
// literal `false` in every non-e2e build, so this branch is dead code there
// and production/staging behaviour is unchanged.
export const protectedFunctionsCapability = isE2eEmulatorBuild
  ? { available: true } as const
  : resolveProtectedFunctionsCapability({
    firebaseConfigured: isFirebaseConfigured,
    firebaseInitialized: appInstance !== null,
    appCheckSiteKeyConfigured: appCheckSiteKey.length > 0,
    appCheckInitialized: appCheckInstance !== null,
  });

export {
  appInstance as app,
  appCheckInstance as appCheck,
  dbInstance as db,
  authInstance as auth,
  googleProviderInstance as googleProvider,
};

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : 'unknown';
  console.error('Firestore operation failed', { operationType, path, code });
}
