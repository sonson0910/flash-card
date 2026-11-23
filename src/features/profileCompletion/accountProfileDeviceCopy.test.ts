import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../../../functions/src/account-profile-contract';
import {
  accountProfileCopyKey, clearAccountProfileCopy, readAccountProfileCopy, writeAccountProfileCopy,
} from './accountProfileDeviceCopy';

const firestore = vi.hoisted(() => ({
  listeners: new Map<string, (snapshot: unknown) => void>(),
}));

vi.mock('firebase/firestore', () => ({
  doc: (_database: unknown, ...segments: string[]) => segments.join('/'),
  onSnapshot: (path: string, _options: unknown, next: (snapshot: unknown) => void) => {
    firestore.listeners.set(path, next);
    return () => { firestore.listeners.delete(path); };
  },
}));
vi.mock('../../lib/firebase', () => ({ getSonFlashFunctions: vi.fn() }));

const profile = {
  birthYear: 1990,
  uiLocale: 'vi' as const,
  nativeLanguage: 'vi' as const,
  termsVersion: CURRENT_TERMS_VERSION,
  privacyVersion: CURRENT_PRIVACY_VERSION,
  consentAcceptedAt: '2026-11-19T08:30:00.000Z',
  completedAt: '2026-11-19T08:30:00.000Z',
};

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: (key: string) => { values.delete(key); },
  };
};

describe('account profile device copy', () => {
  it('keeps one copy per owner and returns it parsed', () => {
    const storage = memoryStorage();
    writeAccountProfileCopy('owner-a', profile, storage);
    expect(readAccountProfileCopy('owner-a', storage)).toEqual(profile);
    expect(readAccountProfileCopy('owner-b', storage)).toBeNull();
    clearAccountProfileCopy('owner-a', storage);
    expect(readAccountProfileCopy('owner-a', storage)).toBeNull();
  });

  it('does not rewrite an unchanged copy', () => {
    const storage = memoryStorage();
    writeAccountProfileCopy('owner-a', profile, storage);
    writeAccountProfileCopy('owner-a', profile, storage);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it('ignores a copy that is not a valid profile record', () => {
    const storage = memoryStorage();
    storage.values.set(accountProfileCopyKey('owner-a'), JSON.stringify({ ...profile, birthYear: 'x' }));
    expect(readAccountProfileCopy('owner-a', storage)).toBeNull();
    storage.values.set(accountProfileCopyKey('owner-a'), '{not json');
    expect(readAccountProfileCopy('owner-a', storage)).toBeNull();
  });

  it('survives storage that is missing or refuses access', () => {
    const refusing = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    expect(readAccountProfileCopy('owner-a', null)).toBeNull();
    expect(readAccountProfileCopy('owner-a', refusing)).toBeNull();
    expect(() => writeAccountProfileCopy('owner-a', profile, refusing)).not.toThrow();
    expect(() => clearAccountProfileCopy('owner-a', refusing)).not.toThrow();
  });
});

describe('account profile listener with the device copy', () => {
  const snapshot = (data: unknown, fromCache: boolean) => ({
    exists: () => data !== undefined,
    data: () => data,
    metadata: { fromCache },
  });
  const emit = (document: 'account' | 'age_restriction', data: unknown, fromCache: boolean) =>
    firestore.listeners.get(`users/owner-a/profile/${document}`)?.(snapshot(data, fromCache));

  beforeEach(() => {
    firestore.listeners.clear();
    vi.stubGlobal('localStorage', memoryStorage());
  });
  afterEach(() => vi.unstubAllGlobals());

  const subscribe = async () => {
    const { createFirebaseAccountProfilePort } = await import('./accountProfilePort');
    const states: unknown[] = [];
    const stop = createFirebaseAccountProfilePort({} as never, {} as never)
      .subscribe('owner-a', state => states.push(state), error => states.push(error));
    return { states, stop };
  };

  it('remembers a completed profile and answers with it when a later start finds an empty cache', async () => {
    const first = await subscribe();
    emit('age_restriction', undefined, false);
    emit('account', profile, false);
    expect(first.states).toEqual([{ status: 'complete', profile }]);
    first.stop();

    const offline = await subscribe();
    emit('age_restriction', undefined, true);
    expect(offline.states).toEqual([]);
    emit('account', undefined, true);
    expect(offline.states).toEqual([{ status: 'complete', profile }]);
    offline.stop();
  });

  it('drops the copy once the server confirms that the profile is missing or the account is restricted', async () => {
    writeAccountProfileCopy('owner-a', profile);
    const missing = await subscribe();
    emit('age_restriction', undefined, false);
    emit('account', undefined, false);
    expect(missing.states).toEqual([{ status: 'required' }]);
    expect(readAccountProfileCopy('owner-a')).toBeNull();
    missing.stop();

    writeAccountProfileCopy('owner-a', profile);
    const restricted = await subscribe();
    emit('age_restriction', { restrictedAt: '2026-11-19T08:30:00.000Z' }, false);
    expect(restricted.states).toEqual([{ status: 'restricted', restrictedAt: '2026-11-19T08:30:00.000Z' }]);
    expect(readAccountProfileCopy('owner-a')).toBeNull();
    restricted.stop();
  });

  it('gives no answer from an empty cache when this device holds no copy', async () => {
    const { states, stop } = await subscribe();
    emit('age_restriction', undefined, true);
    emit('account', undefined, true);
    expect(states).toEqual([]);
    stop();
  });
});
