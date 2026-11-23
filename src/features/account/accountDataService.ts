import { auth, app, db, getSonFlashFunctions } from '../../lib/firebase';
import { gamificationStorageKeys } from '../gamification/gamificationStorage';
import { accountProfileCopyKey } from '../profileCompletion/accountProfileDeviceCopy';
import { skillEvidenceStorageKey } from '../skillEvidence/skillEvidenceStorage';
import { draftKey as onboardingDraftKey } from '../onboarding/onboardingDraft';
import { inProgressKey as onboardingStartedKey, resumeKey as onboardingStepKey } from '../onboarding/onboardingModel';
import { storedTokenKey as pushTokenKey } from '../reminders/pushTokenStorageKey';
import { BROWSER_EXTENSION_IMPORT_OWNER_STORAGE_KEY } from '../browserExtension/browserExtensionImport';
import {
  legacyDeckCacheKey, legacyDeckOwnerCacheKey, ownerScopedDeckCacheKey, parseOwnerScopedDeckCache,
} from '../library/ownerScopedDeckCache';
import {
  cloudBackoffCacheKey, cloudFacetsCacheKey, cloudPageCacheKey, cloudStatsCacheKey, progressEvidenceCachePrefix,
} from '../library/libraryStorage';

export class LocalAccountCleanupError extends Error {}
export const isAccountSignedIn = (): boolean => Boolean(auth?.currentUser);
const callable = async <Request, Response>(
  name: string, request: Request, options?: { timeout?: number },
): Promise<Response> => {
  if (!app || !auth?.currentUser) throw new Error('Sign in is required.');
  const { httpsCallable } = await import('firebase/functions');
  return (await httpsCallable<Request, Response>(await getSonFlashFunctions(app), name, options)(request)).data;
};

const callableErrorCode = (error: unknown): string => {
  if (!error || typeof error !== 'object' || !('code' in error)) return '';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code.trim().toLowerCase().replace(/^functions\//, '') : '';
};

// The server rejects these before it touches account data, so the request never started deleting anything.
const ACCOUNT_DELETION_VALIDATION_CODES = new Set(['invalid-argument', 'failed-precondition', 'permission-denied', 'unauthenticated']);
const isAccountDeletionValidationError = (error: unknown): boolean =>
  ACCOUNT_DELETION_VALIDATION_CODES.has(callableErrorCode(error));

const SHARED_DECK_OPERATION_KEY = 'lingoflash_shared_deck_operation_v1';
const SHARED_DECK_LINKS_KEY = 'lingoflash_shared_deck_links_v1';

const recordOwnedBy = (record: unknown, uid: string): boolean => (
  Boolean(record) && typeof record === 'object' && (record as { ownerId?: unknown }).ownerId === uid
);

// These two stores keep records of every learner who used this device inside one key. Drop only the deleted
// owner's records and leave the rest; a value that cannot be read as records is removed whole.
function removeOwnerRecords(
  storage: Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>, key: string, uid: string,
): void {
  const raw = storage.getItem(key);
  if (raw === null) return;
  let next: unknown = null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const kept = parsed.filter(record => !recordOwnedBy(record, uid));
      next = kept.length > 0 ? kept : null;
    } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { operations?: unknown }).operations)) {
      const kept = (parsed as { operations: unknown[] }).operations.filter(record => !recordOwnedBy(record, uid));
      next = kept.length > 0 ? { ...parsed, operations: kept } : null;
    } else if (parsed && typeof parsed === 'object' && !recordOwnedBy(parsed, uid)) {
      next = parsed;
    }
  } catch { /* an unreadable value is removed below */ }
  if (next === null) storage.removeItem(key);
  else storage.setItem(key, JSON.stringify(next));
}

export function removeOwnerLocalKeys(storage: Pick<Storage, 'getItem' | 'removeItem' | 'setItem' | 'length' | 'key'>,
  session: Pick<Storage, 'removeItem'>, uid: string, clearSharedState: boolean = true): void {
  const keys = [
    ...Object.values(gamificationStorageKeys(uid)),
    cloudPageCacheKey(uid), cloudStatsCacheKey(uid), cloudFacetsCacheKey(uid), cloudBackoffCacheKey(uid),
    `lingoflash_library_epoch_${encodeURIComponent(uid)}`,
    accountProfileCopyKey(uid),
    skillEvidenceStorageKey(uid), pushTokenKey(uid),
    onboardingDraftKey(uid), onboardingStepKey(uid), onboardingStartedKey(uid),
  ];
  // The facet operation log carries no owner at all, and the share stores below hold records of every learner on
  // the device, so only a still-signed-in deleted owner may clear the log or touch those stores.
  if (clearSharedState) {
    keys.push('lingoflash_library_facet_operation_times_v1');
    removeOwnerRecords(storage, SHARED_DECK_OPERATION_KEY, uid);
    removeOwnerRecords(storage, SHARED_DECK_LINKS_KEY, uid);
  }
  for (const key of keys) storage.removeItem(key);
  // The deck cache is a single slot keyed by the owner stored inside it, so another learner's slot stays.
  if (parseOwnerScopedDeckCache(storage.getItem(ownerScopedDeckCacheKey))?.ownerId === uid) {
    storage.removeItem(ownerScopedDeckCacheKey);
  }
  if (storage.getItem(legacyDeckOwnerCacheKey) === uid) {
    storage.removeItem(legacyDeckOwnerCacheKey);
    storage.removeItem(legacyDeckCacheKey);
  }
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index);
    if (key?.startsWith(progressEvidenceCachePrefix(uid))
      || key?.startsWith(`lingoflash_no_image_v1_${encodeURIComponent(uid)}_`)
      || key?.startsWith(`${cloudStatsCacheKey(uid)}_`)) storage.removeItem(key);
  }
  if (clearSharedState) {
    session.removeItem('lingoflash_word_draft');
    session.removeItem('lingoflash_word_operation');
    session.removeItem(BROWSER_EXTENSION_IMPORT_OWNER_STORAGE_KEY);
    session.removeItem('lingoflash_browser_extension_import');
    session.removeItem('lingoflash_browser_extension_draft_import');
  }
}

export async function clearLocalAccountData(uid: string, clearSharedState: boolean = true): Promise<void> {
  try {
    removeOwnerLocalKeys(localStorage, sessionStorage, uid, clearSharedState);
  } catch (error) {
    throw new LocalAccountCleanupError('Account was deleted, but local cleanup failed.', { cause: error });
  }
}

export async function downloadAccountData(): Promise<void> {
  if (!auth?.currentUser) throw new Error('Sign in is required.');
  const user = auth.currentUser;
  const uid = user.uid;
  const data = await callable<Record<string, never>, unknown>('exportMyData', {});
  if (auth.currentUser !== user || auth.currentUser?.uid !== uid) {
    throw new Error('Account changed while exporting data. Please try again.');
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `sonflash-account-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Only account deletion clears the persistent Firestore cache; a plain sign-out keeps it so a returning
// learner does not re-download their whole library. `terminate` must run before `clearIndexedDbPersistence`
// per the Firestore SDK contract, and any failure here must never block the deletion result, since the
// account is already gone (or already on its way out) on the server by the time this runs.
export async function clearFirestorePersistentCache(): Promise<boolean> {
  if (!db) return true;
  try {
    const { terminate, clearIndexedDbPersistence } = await import('firebase/firestore');
    await terminate(db);
    await clearIndexedDbPersistence(db);
    return true;
  } catch (error) {
    console.warn('Could not clear the local Firestore cache after account deletion.', error);
    return false;
  }
}

export interface DeleteAccountResult {
  status: 'completed' | 'started';
  restartRequired: boolean;
  cacheCleared: boolean;
}

export async function deleteAccount(confirmation: string): Promise<DeleteAccountResult> {
  if (!auth?.currentUser) throw new Error('Sign in is required.');
  const user = auth.currentUser;
  const uid = user.uid;
  const { GoogleAuthProvider, reauthenticateWithPopup, signOut } = await import('firebase/auth');
  await reauthenticateWithPopup(user, new GoogleAuthProvider());
  if (auth.currentUser !== user || auth.currentUser?.uid !== uid) {
    throw new Error('Account changed while reauthenticating. Please try again.');
  }
  await user.getIdToken(true);
  if (auth.currentUser !== user || auth.currentUser?.uid !== uid) {
    throw new Error('Account changed while refreshing credentials. Please try again.');
  }
  const normalizedConfirmation = confirmation.normalize('NFC').trim();
  let status: DeleteAccountResult['status'] = 'completed';
  try {
    // The server allows up to 300 s; the SDK default of 70 s is shorter than the job can legitimately take.
    await callable('deleteMyAccount', { confirmation: normalizedConfirmation, expectedUid: uid }, { timeout: 300_000 });
  } catch (error) {
    if (isAccountDeletionValidationError(error)) throw error;
    // Any other error (timeout, internal, disconnect) can still mean the server already started deleting the
    // account, since the timeout only bounds the client's wait. Treat it as started rather than failed.
    status = 'started';
  }
  let localCleanupCompleted = false;
  let signedOut = false;
  const sameUser = () => auth?.currentUser === user && auth.currentUser.uid === uid;
  try {
    await clearLocalAccountData(uid, sameUser());
    localCleanupCompleted = true;
  } catch (error) {
    if (!(error instanceof LocalAccountCleanupError)) throw error;
  }
  finally {
    if (sameUser()) {
      await signOut(auth);
      signedOut = true;
    }
  }
  const firestoreCacheCleared = signedOut ? await clearFirestorePersistentCache() : true;
  const cacheCleared = localCleanupCompleted && firestoreCacheCleared;
  return { status, restartRequired: signedOut, cacheCleared };
}
