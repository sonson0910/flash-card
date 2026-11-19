import { describe, expect, it } from 'vitest';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../../../functions/src/account-profile-contract';
import { AccountProfileError, accountProfileErrorFrom, accountProfileStateFrom } from './accountProfilePort';

const record = {
  birthYear: 1990,
  uiLocale: 'vi',
  nativeLanguage: 'vi',
  termsVersion: CURRENT_TERMS_VERSION,
  privacyVersion: CURRENT_PRIVACY_VERSION,
  consentAcceptedAt: '2026-11-19T08:30:00.000Z',
  completedAt: '2026-11-19T08:30:00.000Z',
};
const absentFromServer = { exists: false, confirmed: true, data: undefined };
const absentFromCache = { exists: false, confirmed: false, data: undefined };

describe('account profile gate state', () => {
  it('waits until both documents were read', () => {
    expect(accountProfileStateFrom(null, null)).toBeNull();
    expect(accountProfileStateFrom(absentFromServer, null)).toBeNull();
  });

  it('asks for the profile only when the server confirmed that neither document exists', () => {
    expect(accountProfileStateFrom(absentFromCache, absentFromCache)).toBeNull();
    expect(accountProfileStateFrom(absentFromServer, absentFromCache)).toBeNull();
    expect(accountProfileStateFrom(absentFromServer, absentFromServer)).toEqual({ status: 'required' });
  });

  it('treats a stored record as complete, even when it came from the offline cache', () => {
    expect(accountProfileStateFrom(absentFromCache, { exists: true, confirmed: false, data: record }))
      .toEqual({ status: 'complete', profile: record });
  });

  it('lets the restriction marker win over a record', () => {
    const marker = { exists: true, confirmed: true, data: { restrictedAt: '2026-11-19T08:30:00.000Z' } };
    expect(accountProfileStateFrom(marker, { exists: true, confirmed: true, data: record }))
      .toEqual({ status: 'restricted', restrictedAt: '2026-11-19T08:30:00.000Z' });
    expect(accountProfileStateFrom(marker, null)).toMatchObject({ status: 'restricted' });
  });

  it('rejects malformed stored documents instead of opening the app', () => {
    expect(() => accountProfileStateFrom(absentFromServer, { exists: true, confirmed: true, data: { ...record, birthYear: 'x' } }))
      .toThrow();
    expect(() => accountProfileStateFrom({ exists: true, confirmed: true, data: { restrictedAt: 'later', birthYear: 2010 } }, null))
      .toThrow();
  });
});

describe('account profile callable errors', () => {
  it.each([
    [{ code: 'functions/failed-precondition', details: { reason: 'consent-outdated' } }, 'consent-outdated'],
    [{ code: 'functions/invalid-argument' }, 'invalid'],
    [{ code: 'functions/resource-exhausted' }, 'rate-limited'],
    [{ code: 'functions/failed-precondition', details: { reason: 'profile-invalid' } }, 'save-failed'],
    [{ code: 'functions/unavailable' }, 'save-failed'],
    [new Error('offline'), 'save-failed'],
  ])('maps %o to %s', (error, code) => {
    const mapped = accountProfileErrorFrom(error);
    expect(mapped).toBeInstanceOf(AccountProfileError);
    expect(mapped.code).toBe(code);
  });
});
