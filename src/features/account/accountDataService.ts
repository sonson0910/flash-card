import { auth, app, db, getSonFlashFunctions } from '../../lib/firebase';
import { gamificationStorageKeys } from '../gamification/gamificationStorage';
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
const ACCOUNT_DELETION_VALIDATION_CODES = new Set(['invalid-argument', 'failed-precondition', 'unauthenticated']);
const isAccountDeletionValidationError = (error: unknown): boolean =>
  ACCOUNT_DELETION_VALIDATION_CODES.has(callableErrorCode(error));

export function removeOwnerLocalKeys(storage: Pick<Storage, 'getItem' | 'removeItem' | 'length' | 'key'>,
  session: Pick<Storage, 'removeItem'>, uid: string): void {
  const keys = [
    ...Object.values(gamificationStorageKeys(uid)),
    cloudPageCacheKey(uid), cloudStatsCacheKey(uid), cloudFacetsCacheKey(uid), cloudBackoffCacheKey(uid),
    `lingoflash_library_epoch_${encodeURIComponent(uid)}`,
    'lingoflash_shared_deck_operation_v1',
  ];
  for (const key of keys) storage.removeItem(key);
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index);
    if (key?.startsWith(progressEvidenceCachePrefix(uid))
      || key?.startsWith(`lingoflash_no_image_v1_${encodeURIComponent(uid)}_`)
      || key?.startsWith(`${cloudStatsCacheKey(uid)}_`)) storage.removeItem(key);
  }
  session.removeItem('lingoflash_word_draft');
  session.removeItem('lingoflash_word_operation');
  session.removeItem('lingoflash_browser_extension_import');
  session.removeItem('lingoflash_browser_extension_draft_import');
}

export async function clearLocalAccountData(uid: string): Promise<void> {
  try {
    removeOwnerLocalKeys(localStorage, sessionStorage, uid);
  } catch (error) {
    throw new LocalAccountCleanupError('Account was deleted, but local cleanup failed.', { cause: error });
  }
}

export async function downloadAccountData(): Promise<void> {
  const data = await callable<Record<string, never>, unknown>('exportMyData', {});
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
export async function clearFirestorePersistentCache(): Promise<void> {
  if (!db) return;
  try {
    const { terminate, clearIndexedDbPersistence } = await import('firebase/firestore');
    await terminate(db);
    await clearIndexedDbPersistence(db);
  } catch (error) {
    console.warn('Could not clear the local Firestore cache after account deletion.', error);
  }
}

export type DeleteAccountResult = 'completed' | 'started';

export async function deleteAccount(confirmation: string): Promise<DeleteAccountResult> {
  if (!auth?.currentUser) throw new Error('Sign in is required.');
  const uid = auth.currentUser.uid;
  const { GoogleAuthProvider, reauthenticateWithPopup, signOut } = await import('firebase/auth');
  await reauthenticateWithPopup(auth.currentUser, new GoogleAuthProvider());
  await auth.currentUser.getIdToken(true);
  const normalizedConfirmation = confirmation.normalize('NFC').trim();
  let result: DeleteAccountResult = 'completed';
  try {
    // The server allows up to 300 s; the SDK default of 70 s is shorter than the job can legitimately take.
    await callable('deleteMyAccount', { confirmation: normalizedConfirmation }, { timeout: 300_000 });
  } catch (error) {
    if (isAccountDeletionValidationError(error)) throw error;
    // Any other error (timeout, internal, disconnect) can still mean the server already started deleting the
    // account, since the timeout only bounds the client's wait. Treat it as started rather than failed.
    result = 'started';
  }
  try { await clearLocalAccountData(uid); }
  finally { await signOut(auth); }
  await clearFirestorePersistentCache();
  return result;
}
