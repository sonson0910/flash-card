import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gamificationStorageKeys } from '../gamification/gamificationStorage';
import { deleteAccount, LocalAccountCleanupError, removeOwnerLocalKeys } from './accountDataService';

const firestoreClient = vi.hoisted(() => ({
  db: {} as Record<string, never>,
  terminate: vi.fn(),
  clearIndexedDbPersistence: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  terminate: firestoreClient.terminate,
  clearIndexedDbPersistence: firestoreClient.clearIndexedDbPersistence,
}));

describe('account deletion local cleanup', () => {
  it('removes only the deleted owner cache and leaves another owner and anonymous XP alone', () => {
    const values = new Map<string, string>([
      ...Object.values(gamificationStorageKeys('owner-a')).map(key => [key, 'private'] as const),
      [gamificationStorageKeys('owner-b').snapshot, 'keep'],
      [gamificationStorageKeys(null).snapshot, 'anonymous'],
      ['lingoflash_cloud_page_owner-a', 'private'],
      ['lingoflash_cloud_page_owner-b', 'keep'],
      ['lingoflash_cloud_stats_owner-a_ko', 'private'],
      ['lingoflash_cloud_stats_owner-ab_ko', 'keep'],
      ['lingoflash_no_image_v1_owner-a_card', 'private'],
      ['lingoflash_no_image_v1_owner-b_card', 'keep'],
      ['lingoflash_shared_deck_operation_v1', 'private'],
    ]);
    const session = new Map([['lingoflash_word_draft', 'private'], ['lingoflash_word_operation', 'private']]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => { values.delete(key); },
      get length() { return values.size; },
      key: (index: number) => [...values.keys()][index] ?? null,
    };
    removeOwnerLocalKeys(storage, { removeItem: key => { session.delete(key); } }, 'owner-a');
    for (const key of Object.values(gamificationStorageKeys('owner-a'))) expect(values.has(key)).toBe(false);
    expect(values.has('lingoflash_no_image_v1_owner-a_card')).toBe(false);
    expect(values.has('lingoflash_cloud_stats_owner-a_ko')).toBe(false);
    expect(values.get('lingoflash_cloud_stats_owner-ab_ko')).toBe('keep');
    expect(values.has('lingoflash_shared_deck_operation_v1')).toBe(false);
    expect(values.get('lingoflash_cloud_page_owner-b')).toBe('keep');
    expect(values.get(gamificationStorageKeys(null).snapshot)).toBe('anonymous');
    expect(session.size).toBe(0);
  });
});

const functions = vi.hoisted(() => ({
  getFunctions: vi.fn(),
  httpsCallable: vi.fn(),
  callable: vi.fn(),
}));

const authentication = vi.hoisted(() => ({
  auth: { currentUser: null as null | { uid: string; getIdToken: ReturnType<typeof vi.fn> } },
  GoogleAuthProvider: vi.fn(),
  reauthenticateWithPopup: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  getFunctions: functions.getFunctions,
  httpsCallable: functions.httpsCallable,
}));

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: authentication.GoogleAuthProvider,
  reauthenticateWithPopup: authentication.reauthenticateWithPopup,
  signOut: authentication.signOut,
}));

vi.mock('../../lib/firebase', () => ({
  auth: authentication.auth,
  app: {},
  db: firestoreClient.db,
  getSonFlashFunctions: (app: unknown, region: string = 'asia-southeast1') => functions.getFunctions(app, region),
}));

const fakeStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
  };
};

describe('deleteAccount', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal('localStorage', fakeStorage());
    vi.stubGlobal('sessionStorage', fakeStorage());
    authentication.auth.currentUser = { uid: 'user-1', getIdToken: vi.fn(async () => 'fresh-token') };
    authentication.reauthenticateWithPopup.mockResolvedValue(undefined);
    authentication.signOut.mockResolvedValue(undefined);
    functions.getFunctions.mockReturnValue({ region: 'asia-southeast1' });
    functions.httpsCallable.mockReturnValue(functions.callable);
    firestoreClient.terminate.mockResolvedValue(undefined);
    firestoreClient.clearIndexedDbPersistence.mockResolvedValue(undefined);
  });

  it('calls the deletion callable with a 300 s timeout and the NFC-normalized confirmation phrase', async () => {
    functions.callable.mockResolvedValue({ data: { status: 'deleted' } });

    const nfdPhrase = 'XÓA TÀI KHOẢN'.normalize('NFD');
    const result = await deleteAccount(nfdPhrase);

    expect(result).toBe('completed');
    expect(functions.httpsCallable).toHaveBeenCalledWith(
      { region: 'asia-southeast1' }, 'deleteMyAccount', { timeout: 300_000 },
    );
    expect(functions.callable).toHaveBeenCalledWith({ confirmation: 'XÓA TÀI KHOẢN'.normalize('NFC') });
    expect(authentication.signOut).toHaveBeenCalledOnce();
    expect(firestoreClient.terminate).toHaveBeenCalledWith(firestoreClient.db);
    expect(firestoreClient.clearIndexedDbPersistence).toHaveBeenCalledWith(firestoreClient.db);
  });

  it('rethrows a validation error without clearing local data, signing out, or clearing the Firestore cache', async () => {
    functions.callable.mockRejectedValue(Object.assign(new Error('bad phrase'), { code: 'functions/invalid-argument' }));

    await expect(deleteAccount('wrong phrase')).rejects.toThrow('bad phrase');

    expect(authentication.signOut).not.toHaveBeenCalled();
    expect(firestoreClient.terminate).not.toHaveBeenCalled();
  });

  it('clears the Firestore persistent cache without blocking the result when clearing fails', async () => {
    functions.callable.mockResolvedValue({ data: { status: 'deleted' } });
    firestoreClient.terminate.mockRejectedValue(new Error('already terminated'));

    const result = await deleteAccount('XÓA TÀI KHOẢN');

    expect(result).toBe('completed');
    expect(firestoreClient.clearIndexedDbPersistence).not.toHaveBeenCalled();
  });

  it('treats a timeout or internal error as a started deletion and still clears local data', async () => {
    functions.callable.mockRejectedValue(Object.assign(new Error('deadline exceeded'), { code: 'functions/deadline-exceeded' }));

    const result = await deleteAccount('XÓA TÀI KHOẢN');

    expect(result).toBe('started');
    expect(authentication.signOut).toHaveBeenCalledOnce();
    expect(firestoreClient.terminate).toHaveBeenCalledWith(firestoreClient.db);
    expect(firestoreClient.clearIndexedDbPersistence).toHaveBeenCalledWith(firestoreClient.db);
  });

  it('signs out even when local cleanup fails after a started deletion, without clearing the Firestore cache', async () => {
    functions.callable.mockRejectedValue(Object.assign(new Error('internal'), { code: 'functions/internal' }));
    vi.stubGlobal('localStorage', {
      ...fakeStorage(),
      removeItem: () => { throw new Error('storage unavailable'); },
    });

    await expect(deleteAccount('XÓA TÀI KHOẢN')).rejects.toBeInstanceOf(LocalAccountCleanupError);

    expect(authentication.signOut).toHaveBeenCalledOnce();
    expect(firestoreClient.terminate).not.toHaveBeenCalled();
  });
});
