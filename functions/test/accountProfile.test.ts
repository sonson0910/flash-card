import type { DocumentData, DocumentReference, DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import {
  AccountProfileValidationError,
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  accountAgeCurrentYear,
  evaluateBirthYear,
  parseAccountProfileRecord,
  parseAgeRestrictionMarker,
  parseCompleteAccountProfileRequest,
} from '../src/account-profile-contract.js';
import {
  AccountProfileConsentOutdatedError,
  AccountProfileOwnerMismatchError,
  AccountProfileStoredDataError,
  completeAccountProfile,
} from '../src/account-profile-persistence.js';

const recordPath = 'users/owner/profile/account';
const markerPath = 'users/owner/profile/age_restriction';
const clock = () => new Date('2026-11-19T08:30:00.000Z');

const validRequest = (overrides: Record<string, unknown> = {}) => ({
  ownerId: 'owner',
  birthYear: 1990,
  uiLocale: 'vi',
  nativeLanguage: 'vi',
  consent: { accepted: true, termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION },
  ...overrides,
});

const storedRecord = {
  birthYear: 1985,
  uiLocale: 'en',
  nativeLanguage: 'en',
  termsVersion: CURRENT_TERMS_VERSION,
  privacyVersion: CURRENT_PRIVACY_VERSION,
  consentAcceptedAt: '2026-11-01T00:00:00.000Z',
  completedAt: '2026-11-01T00:00:00.000Z',
};

const snapshot = (data?: DocumentData): DocumentSnapshot => ({
  exists: data !== undefined,
  data: () => data,
} as DocumentSnapshot);

const harness = (initial: Record<string, DocumentData> = {}) => {
  const values = new Map<string, DocumentData>(Object.entries(initial));
  const writes: Array<{ path: string; data: DocumentData }> = [];
  const transaction = {
    get: vi.fn(async (reference: DocumentReference) => snapshot(values.get(reference.path))),
    create: vi.fn((reference: DocumentReference, data: DocumentData) => {
      if (values.has(reference.path)) throw new Error('already exists');
      values.set(reference.path, data);
      writes.push({ path: reference.path, data });
      return transaction;
    }),
    set: vi.fn(() => { throw new Error('the account profile is only ever created'); }),
    update: vi.fn(() => { throw new Error('the account profile is never updated'); }),
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
  return { database, values, writes };
};

describe('account profile request contract', () => {
  it('accepts the exact request envelope', () => {
    expect(parseCompleteAccountProfileRequest(validRequest())).toEqual(validRequest());
  });

  it.each([
    ['an unknown field', { ...validRequest(), extra: true }],
    ['a missing field', (({ uiLocale: _ignored, ...rest }) => rest)(validRequest())],
    ['a non-integer year', validRequest({ birthYear: 1990.5 })],
    ['a year as text', validRequest({ birthYear: '1990' })],
    ['a three-digit year', validRequest({ birthYear: 990 })],
    ['a five-digit year', validRequest({ birthYear: 19900 })],
    ['an unsupported UI locale', validRequest({ uiLocale: 'ja' })],
    ['an unsupported native language', validRequest({ nativeLanguage: 'ko' })],
    ['consent not accepted', validRequest({ consent: { accepted: false, termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION } })],
    ['consent without versions', validRequest({ consent: { accepted: true } })],
    ['a malformed policy version', validRequest({ consent: { accepted: true, termsVersion: 'v1', privacyVersion: CURRENT_PRIVACY_VERSION } })],
    ['an owner path segment', validRequest({ ownerId: 'a/b' })],
    ['a non-object body', null],
  ])('rejects %s', (_label, value) => {
    expect(() => parseCompleteAccountProfileRequest(value)).toThrow(AccountProfileValidationError);
  });

  it('never echoes the submitted birth year in a validation message', () => {
    for (const birthYear of [2099, 1850, 12345]) {
      try {
        if (birthYear === 12345) parseCompleteAccountProfileRequest(validRequest({ birthYear }));
        else evaluateBirthYear(birthYear, clock());
        throw new Error('expected a rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(AccountProfileValidationError);
        expect((error as Error).message).not.toContain(String(birthYear));
      }
    }
  });
});

describe('account age rule', () => {
  const now = clock();

  it('allows a learner when the current year minus the birth year is at least 18', () => {
    expect(evaluateBirthYear(2008, now)).toBe('allowed');
    expect(evaluateBirthYear(1990, now)).toBe('allowed');
    expect(evaluateBirthYear(1906, now)).toBe('allowed');
  });

  it('restricts a learner younger than 18 by birth year, including the current year', () => {
    expect(evaluateBirthYear(2009, now)).toBe('restricted');
    expect(evaluateBirthYear(2026, now)).toBe('restricted');
  });

  it('rejects future and implausible years', () => {
    expect(() => evaluateBirthYear(2027, now)).toThrow(AccountProfileValidationError);
    expect(() => evaluateBirthYear(1905, now)).toThrow(AccountProfileValidationError);
  });

  it('counts the new year once it has started at UTC+14, whatever the server time zone', () => {
    expect(evaluateBirthYear(2009, new Date('2026-12-31T09:59:59.999Z'))).toBe('restricted');
    expect(evaluateBirthYear(2008, new Date('2026-12-31T09:59:59.999Z'))).toBe('allowed');
    expect(evaluateBirthYear(2009, new Date('2026-12-31T10:00:00.000Z'))).toBe('allowed');
    expect(() => evaluateBirthYear(2027, new Date('2026-12-31T09:59:59.999Z'))).toThrow(AccountProfileValidationError);
    expect(evaluateBirthYear(2027, new Date('2026-12-31T10:00:00.000Z'))).toBe('restricted');
  });

  it('applies the same year on both sides of the UTC new year', () => {
    expect(accountAgeCurrentYear(new Date('2026-12-31T09:59:59.999Z'))).toBe(2026);
    expect(accountAgeCurrentYear(new Date('2026-12-31T10:00:00.000Z'))).toBe(2027);
    expect(accountAgeCurrentYear(new Date('2027-01-01T00:00:00.000Z'))).toBe(2027);
  });
});

describe('stored account documents', () => {
  it('parses the stored record and marker with exact keys', () => {
    expect(parseAccountProfileRecord(storedRecord)).toEqual(storedRecord);
    expect(parseAgeRestrictionMarker({ restrictedAt: '2026-11-19T08:30:00.000Z' }))
      .toEqual({ restrictedAt: '2026-11-19T08:30:00.000Z' });
    expect(() => parseAgeRestrictionMarker({ restrictedAt: '2026-11-19T08:30:00.000Z', birthYear: 2010 }))
      .toThrow(AccountProfileValidationError);
    expect(() => parseAccountProfileRecord({ ...storedRecord, completedAt: 'yesterday' }))
      .toThrow(AccountProfileValidationError);
  });
});

describe('account profile completion', () => {
  it('writes the record once with server times and the accepted policy versions', async () => {
    const { database, writes } = harness();
    const request = parseCompleteAccountProfileRequest(validRequest());

    await expect(completeAccountProfile(database, 'owner', request, clock)).resolves.toEqual({
      status: 'complete',
      profile: {
        birthYear: 1990,
        uiLocale: 'vi',
        nativeLanguage: 'vi',
        termsVersion: CURRENT_TERMS_VERSION,
        privacyVersion: CURRENT_PRIVACY_VERSION,
        consentAcceptedAt: '2026-11-19T08:30:00.000Z',
        completedAt: '2026-11-19T08:30:00.000Z',
      },
    });
    expect(writes.map(write => write.path)).toEqual([recordPath]);
  });

  it('returns the stored record unchanged on a second call', async () => {
    const { database, writes, values } = harness({ [recordPath]: storedRecord });
    const request = parseCompleteAccountProfileRequest(validRequest({ birthYear: 2001, uiLocale: 'vi' }));

    await expect(completeAccountProfile(database, 'owner', request, clock))
      .resolves.toEqual({ status: 'complete', profile: storedRecord });
    expect(writes).toEqual([]);
    expect(values.get(recordPath)).toBe(storedRecord);
  });

  it('stores only the restriction time for an account under the age rule', async () => {
    const { database, writes } = harness();
    const request = parseCompleteAccountProfileRequest(validRequest({ birthYear: 2010 }));

    await expect(completeAccountProfile(database, 'owner', request, clock))
      .resolves.toEqual({ status: 'restricted', restrictedAt: '2026-11-19T08:30:00.000Z' });
    expect(writes).toEqual([{ path: markerPath, data: { restrictedAt: '2026-11-19T08:30:00.000Z' } }]);
    expect(JSON.stringify(writes)).not.toContain('2010');
  });

  it('keeps a restricted account restricted when a later call sends an adult year', async () => {
    const marker = { restrictedAt: '2026-11-18T00:00:00.000Z' };
    const { database, writes } = harness({ [markerPath]: marker });
    const request = parseCompleteAccountProfileRequest(validRequest({ birthYear: 1980 }));

    await expect(completeAccountProfile(database, 'owner', request, clock))
      .resolves.toEqual({ status: 'restricted', restrictedAt: marker.restrictedAt });
    expect(writes).toEqual([]);
  });

  it('lets the restriction marker win over a record left beside it', async () => {
    const { database, writes } = harness({
      [markerPath]: { restrictedAt: '2026-11-18T00:00:00.000Z' },
      [recordPath]: storedRecord,
    });
    const request = parseCompleteAccountProfileRequest(validRequest());

    await expect(completeAccountProfile(database, 'owner', request, clock))
      .resolves.toMatchObject({ status: 'restricted' });
    expect(writes).toEqual([]);
  });

  it('rejects a mismatched owner, outdated consent and out-of-range years before any read', async () => {
    const { database } = harness();
    await expect(completeAccountProfile(database, 'other', parseCompleteAccountProfileRequest(validRequest()), clock))
      .rejects.toBeInstanceOf(AccountProfileOwnerMismatchError);
    await expect(completeAccountProfile(database, 'owner', parseCompleteAccountProfileRequest(validRequest({
      consent: { accepted: true, termsVersion: CURRENT_TERMS_VERSION, privacyVersion: '2026-10-01' },
    })), clock)).rejects.toBeInstanceOf(AccountProfileConsentOutdatedError);
    await expect(completeAccountProfile(database, 'owner',
      parseCompleteAccountProfileRequest(validRequest({ birthYear: 2027 })), clock))
      .rejects.toBeInstanceOf(AccountProfileValidationError);
    expect(database.runTransaction).not.toHaveBeenCalled();
  });

  it('reports malformed stored state instead of overwriting it', async () => {
    const { database, writes } = harness({ [recordPath]: { ...storedRecord, birthYear: 'unknown' } });
    await expect(completeAccountProfile(database, 'owner', parseCompleteAccountProfileRequest(validRequest()), clock))
      .rejects.toBeInstanceOf(AccountProfileStoredDataError);
    expect(writes).toEqual([]);
  });
});
