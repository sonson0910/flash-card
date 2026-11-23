import type { DocumentData, DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import {
  AccountProfileValidationError,
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  parseUpdateAccountUiLocaleRequest,
} from '../src/account-profile-contract.js';
import {
  AccountProfileMissingError,
  AccountProfileOwnerMismatchError,
  AccountProfileStoredDataError,
  updateAccountUiLocale,
} from '../src/account-profile-persistence.js';

const recordPath = 'users/owner/profile/account';
const storedRecord = {
  birthYear: 1985,
  uiLocale: 'vi',
  nativeLanguage: 'vi',
  termsVersion: CURRENT_TERMS_VERSION,
  privacyVersion: CURRENT_PRIVACY_VERSION,
  consentAcceptedAt: '2026-11-01T00:00:00.000Z',
  completedAt: '2026-11-01T00:00:00.000Z',
};

const harness = (initial: Record<string, DocumentData> = {}) => {
  const values = new Map<string, DocumentData>(Object.entries(initial));
  const updates: Array<{ path: string; data: DocumentData }> = [];
  const transaction = {
    get: vi.fn(async (reference: DocumentReference) => ({
      exists: values.has(reference.path),
      data: () => values.get(reference.path),
    })),
    update: vi.fn((reference: DocumentReference, data: DocumentData) => {
      values.set(reference.path, { ...values.get(reference.path), ...data });
      updates.push({ path: reference.path, data });
      return transaction;
    }),
    set: vi.fn(() => { throw new Error('the language update never replaces the profile'); }),
    create: vi.fn(() => { throw new Error('the language update never creates the profile'); }),
  } as unknown as Transaction;
  const database = {
    collection: (name: string) => ({
      doc: (ownerId: string) => ({
        collection: (subcollection: string) => ({
          doc: (id: string) => ({ path: `${name}/${ownerId}/${subcollection}/${id}` }),
        }),
      }),
    }),
    runTransaction: vi.fn(async (callback: (value: Transaction) => Promise<unknown>) => callback(transaction)),
  } as unknown as Firestore;
  return { database, values, updates };
};

describe('account language request contract', () => {
  it('accepts exactly an owner and a shipped locale', () => {
    expect(parseUpdateAccountUiLocaleRequest({ ownerId: 'owner', uiLocale: 'en' })).toEqual({ ownerId: 'owner', uiLocale: 'en' });
    for (const malformed of [
      { ownerId: 'owner', uiLocale: 'fr' },
      { ownerId: 'owner' },
      { uiLocale: 'en' },
      { ownerId: 'owner', uiLocale: 'en', birthYear: 1990 },
      { ownerId: '', uiLocale: 'en' },
      null,
    ]) {
      expect(() => parseUpdateAccountUiLocaleRequest(malformed)).toThrow(AccountProfileValidationError);
    }
  });
});

describe('account language update', () => {
  it('merges only the language field into the completed profile', async () => {
    const { database, values, updates } = harness({ [recordPath]: storedRecord });
    await expect(updateAccountUiLocale(database, 'owner', { ownerId: 'owner', uiLocale: 'en' }))
      .resolves.toEqual({ uiLocale: 'en' });
    expect(updates).toEqual([{ path: recordPath, data: { uiLocale: 'en' } }]);
    expect(values.get(recordPath)).toEqual({ ...storedRecord, uiLocale: 'en' });
  });

  it('writes nothing when the stored language is already the requested one', async () => {
    const { database, updates } = harness({ [recordPath]: storedRecord });
    await expect(updateAccountUiLocale(database, 'owner', { ownerId: 'owner', uiLocale: 'vi' }))
      .resolves.toEqual({ uiLocale: 'vi' });
    expect(updates).toEqual([]);
  });

  it('refuses an owner mismatch before any read, a missing profile and a malformed stored profile', async () => {
    const mismatch = harness({ [recordPath]: storedRecord });
    await expect(updateAccountUiLocale(mismatch.database, 'owner', { ownerId: 'other', uiLocale: 'en' }))
      .rejects.toBeInstanceOf(AccountProfileOwnerMismatchError);
    expect(mismatch.database.runTransaction).not.toHaveBeenCalled();

    const missing = harness();
    await expect(updateAccountUiLocale(missing.database, 'owner', { ownerId: 'owner', uiLocale: 'en' }))
      .rejects.toBeInstanceOf(AccountProfileMissingError);
    expect(missing.updates).toEqual([]);

    const malformed = harness({ [recordPath]: { ...storedRecord, birthYear: 'unknown' } });
    await expect(updateAccountUiLocale(malformed.database, 'owner', { ownerId: 'owner', uiLocale: 'en' }))
      .rejects.toBeInstanceOf(AccountProfileStoredDataError);
    expect(malformed.updates).toEqual([]);
  });
});
