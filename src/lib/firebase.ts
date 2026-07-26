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
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export const isFirebaseConfigured = !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.apiKey.trim() !== "");

let appInstance: FirebaseApp | null = null;
let appCheckInstance: AppCheck | null = null;
let dbInstance: Firestore | null = null;
let authInstance: Auth | null = null;
let googleProviderInstance: GoogleAuthProvider | null = null;

if (isFirebaseConfigured) {
  try {
    appInstance = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
    const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY?.trim();
    if (appCheckSiteKey) {
      try {
        if (import.meta.env.DEV && import.meta.env.VITE_FIREBASE_APP_CHECK_DEBUG === 'true') {
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
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
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
