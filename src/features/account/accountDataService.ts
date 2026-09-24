import { auth, app } from '../../lib/firebase';
import { clearMirroredCards } from '../../lib/cardMirror';
import { clearDevicePending, saveDeviceCards } from '../../lib/deviceSync';
import { gamificationStorageKeys } from '../gamification/gamificationStorage';
import {
  cloudBackoffCacheKey, cloudFacetsCacheKey, cloudPageCacheKey, cloudStatsCacheKey,
} from '../library/libraryStorage';
import { legacyCardCacheKey, legacyCardOwnerCacheKey, ownerScopedCardCacheKey,
  parseOwnerScopedCardCache } from '../library/ownerScopedCardCache';

const region = 'asia-southeast1';
export class LocalAccountCleanupError extends Error {}
export const isAccountSignedIn = (): boolean => Boolean(auth?.currentUser);
const callable = async <Request, Response>(
  name: string, request: Request, options?: { timeout?: number },
): Promise<Response> => {
  if (!app || !auth?.currentUser) throw new Error('Sign in is required.');
  const { getFunctions, httpsCallable } = await import('firebase/functions');
  return (await httpsCallable<Request, Response>(getFunctions(app, region), name, options)(request)).data;
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
    `lingoflash_pending_writes_${encodeURIComponent(uid)}`,
    'lingoflash_shared_deck_operation_v1',
  ];
  for (const key of keys) storage.removeItem(key);
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index);
    if (key?.startsWith(`lingoflash_no_image_v1_${encodeURIComponent(uid)}_`)) storage.removeItem(key);
  }
  if (parseOwnerScopedCardCache(storage.getItem(ownerScopedCardCacheKey))?.ownerId === uid) {
    storage.removeItem(ownerScopedCardCacheKey);
  }
  if (storage.getItem(legacyCardOwnerCacheKey) === uid) {
    storage.removeItem(legacyCardCacheKey);
    storage.removeItem(legacyCardOwnerCacheKey);
  }
  session.removeItem('lingoflash_word_draft');
  session.removeItem('lingoflash_word_operation');
  session.removeItem('lingoflash_browser_extension_import');
  session.removeItem('lingoflash_browser_extension_draft_import');
}

export async function clearLocalAccountData(uid: string): Promise<void> {
  const results = await Promise.allSettled([
    clearMirroredCards(uid), clearDevicePending(uid),
  ]);
  try { removeOwnerLocalKeys(localStorage, sessionStorage, uid); }
  catch (error) { results.push({ status: 'rejected', reason: error }); }
  try { await saveDeviceCards([], 0, [], 'replace', uid); }
  catch (error) { results.push({ status: 'rejected', reason: error }); }
  if (results.some(result => result.status === 'rejected')) {
    throw new LocalAccountCleanupError('Account was deleted, but local cleanup failed.');
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
  return result;
}
