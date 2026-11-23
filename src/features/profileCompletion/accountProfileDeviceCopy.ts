import { parseAccountProfileRecord, type AccountProfileRecord } from '../../../functions/src/account-profile-contract';

/**
 * A copy of the owner's completed account profile kept on this device. Firestore's own cache lives only
 * in memory on Safari, so after a reload without a connection it holds neither profile document. Without
 * this copy the gate would get no answer there and lock the learner out of the workspace the offline
 * shell still holds. The server stays the authority: its confirmed answer always replaces the copy.
 */
type CopyStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const deviceStorage = (): CopyStorage | null => {
  try { return globalThis.localStorage; } catch { return null; }
};

export const accountProfileCopyKey = (ownerId: string): string =>
  `sonflash_account_profile_v1_${encodeURIComponent(ownerId)}`;

export const readAccountProfileCopy = (
  ownerId: string,
  storage: Pick<CopyStorage, 'getItem'> | null = deviceStorage(),
): AccountProfileRecord | null => {
  try {
    const raw = storage?.getItem(accountProfileCopyKey(ownerId));
    return raw ? parseAccountProfileRecord(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

export const writeAccountProfileCopy = (
  ownerId: string,
  profile: AccountProfileRecord,
  storage: Pick<CopyStorage, 'getItem' | 'setItem'> | null = deviceStorage(),
): void => {
  try {
    const key = accountProfileCopyKey(ownerId);
    const next = JSON.stringify(profile);
    if (storage?.getItem(key) !== next) storage?.setItem(key, next);
  } catch { /* the copy is optional; the server record stays authoritative */ }
};

export const clearAccountProfileCopy = (
  ownerId: string,
  storage: Pick<CopyStorage, 'removeItem'> | null = deviceStorage(),
): void => {
  try { storage?.removeItem(accountProfileCopyKey(ownerId)); } catch { /* nothing left to clear */ }
};
