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
const callable = async <Request, Response>(name: string, request: Request): Promise<Response> => {
  if (!app || !auth?.currentUser) throw new Error('Sign in is required.');
  const { getFunctions, httpsCallable } = await import('firebase/functions');
  return (await httpsCallable<Request, Response>(getFunctions(app, region), name)(request)).data;
};

export function removeOwnerLocalKeys(storage: Pick<Storage, 'getItem' | 'removeItem' | 'length' | 'key'>,
  session: Pick<Storage, 'removeItem'>, uid: string): void {
  const keys = [
    ...Object.values(gamificationStorageKeys(uid)),
    cloudPageCacheKey(uid), cloudStatsCacheKey(uid), cloudFacetsCacheKey(uid), cloudBackoffCacheKey(uid),
    `lingoflash_library_epoch_${encodeURIComponent(uid)}`,
    `lingoflash_pending_writes_${encodeURIComponent(uid)}`,
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

export async function deleteAccount(confirmation: string): Promise<void> {
  if (!auth?.currentUser) throw new Error('Sign in is required.');
  const uid = auth.currentUser.uid;
  const { GoogleAuthProvider, reauthenticateWithPopup, signOut } = await import('firebase/auth');
  await reauthenticateWithPopup(auth.currentUser, new GoogleAuthProvider());
  await auth.currentUser.getIdToken(true);
  await callable('deleteMyAccount', { confirmation });
  try { await clearLocalAccountData(uid); }
  finally { await signOut(auth); }
}
