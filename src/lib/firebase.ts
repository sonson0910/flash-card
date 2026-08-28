import { initializeApp, getApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from 'firebase/app-check';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { resolveProtectedFunctionsCapability } from './protectedFunctionsCapability';

export const isFirebaseConfigured = !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.apiKey.trim() !== "");
const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY?.trim() ?? '';

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
    if (appCheckSiteKey) {
      try {
        const isLocalhost = typeof location !== 'undefined'
          && ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
        if ((import.meta.env.DEV || isLocalhost) && import.meta.env.VITE_FIREBASE_APP_CHECK_DEBUG === 'true') {
          (globalThis as typeof globalThis & { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
        }
        appCheckInstance = initializeAppCheck(appInstance, {
          provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
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
      dbInstance = initializeFirestore(appInstance, {
        // Safari can leave Firestore's persistent multi-tab queue wedged after
        // rapid local dev reloads. SonFlash owns its durable offline queue and
        // card mirror, so memory cache avoids that second lease coordinator.
        localCache: isSafariBrowser()
          ? memoryLocalCache()
          : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      }, dbId);
    } catch {
      dbInstance = dbId ? getFirestore(appInstance, dbId) : getFirestore(appInstance);
    }
    authInstance = getAuth(appInstance);
    googleProviderInstance = new GoogleAuthProvider();
  } catch (err) {
    console.error("Failed to initialize Firebase with current configuration:", err);
  }
}

export const protectedFunctionsCapability = resolveProtectedFunctionsCapability({
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
