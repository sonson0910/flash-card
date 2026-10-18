import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gamificationStorageKeys } from '../gamification/gamificationStorage';
import { deleteAccount, downloadAccountData, removeOwnerLocalKeys } from './accountDataService';

const firestoreClient = vi.hoisted(() => ({
  db: {} as Record<string, never> | null,
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
      ['sonflash_progress_forecast_owner-a:en', 'private'],
      ['sonflash_progress_forecast_owner-a_ko:en', 'keep'],
      ['sonflash_progress_forecast_owner-b:en', 'keep'],
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
    expect(values.has('sonflash_progress_forecast_owner-a:en')).toBe(false);
    expect(values.get('sonflash_progress_forecast_owner-a_ko:en')).toBe('keep');
    expect(values.get('sonflash_progress_forecast_owner-b:en')).toBe('keep');
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
  get db() { return firestoreClient.db; },
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

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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
    firestoreClient.db = {};
    firestoreClient.terminate.mockResolvedValue(undefined);
    firestoreClient.clearIndexedDbPersistence.mockResolvedValue(undefined);
  });

  it('calls the deletion callable with a 300 s timeout and the NFC-normalized confirmation phrase', async () => {
    functions.callable.mockResolvedValue({ data: { status: 'deleted' } });

    const nfdPhrase = 'XÓA TÀI KHOẢN'.normalize('NFD');
    const result = await deleteAccount(nfdPhrase);

    expect(result).toEqual({ status: 'completed', restartRequired: true, cacheCleared: true });
    expect(functions.httpsCallable).toHaveBeenCalledWith(
      { region: 'asia-southeast1' }, 'deleteMyAccount', { timeout: 300_000 },
    );
    expect(functions.callable).toHaveBeenCalledWith({
      confirmation: 'XÓA TÀI KHOẢN'.normalize('NFC'), expectedUid: 'user-1',
    });
    expect(authentication.signOut).toHaveBeenCalledOnce();
    expect(firestoreClient.terminate).toHaveBeenCalledWith(firestoreClient.db);
    expect(firestoreClient.clearIndexedDbPersistence).toHaveBeenCalledWith(firestoreClient.db);
  });

  it('does not delete or clear either account when the owner changes during reauthentication', async () => {
    const originalUser = authentication.auth.currentUser!;
    const replacementUser = { uid: 'user-2', getIdToken: vi.fn(async () => 'fresh-token') };
    localStorage.setItem(gamificationStorageKeys(originalUser.uid).snapshot, 'original-owner-cache');
    sessionStorage.setItem('lingoflash_word_draft', 'original-owner-draft');
    authentication.reauthenticateWithPopup.mockImplementation(async () => {
      authentication.auth.currentUser = replacementUser;
    });

    await expect(deleteAccount('XÓA TÀI KHOẢN')).rejects.toThrow('Account changed while reauthenticating.');

    expect(originalUser.getIdToken).not.toHaveBeenCalled();
    expect(replacementUser.getIdToken).not.toHaveBeenCalled();
    expect(functions.httpsCallable).not.toHaveBeenCalled();
    expect(functions.callable).not.toHaveBeenCalled();
    expect(localStorage.getItem(gamificationStorageKeys(originalUser.uid).snapshot)).toBe('original-owner-cache');
    expect(sessionStorage.getItem('lingoflash_word_draft')).toBe('original-owner-draft');
    expect(authentication.signOut).not.toHaveBeenCalled();
    expect(firestoreClient.terminate).not.toHaveBeenCalled();
  });

  it('does not dispatch deletion when the owner changes while refreshing credentials', async () => {
    const token = deferred<string>();
    const originalUser = authentication.auth.currentUser!;
    const replacementUser = { uid: 'user-2', getIdToken: vi.fn(async () => 'fresh-token') };
    originalUser.getIdToken.mockImplementation(() => token.promise);
    localStorage.setItem(gamificationStorageKeys(originalUser.uid).snapshot, 'original-owner-cache');
    sessionStorage.setItem('lingoflash_word_draft', 'original-owner-draft');

    const deletion = deleteAccount('XÓA TÀI KHOẢN');
    await vi.waitFor(() => expect(originalUser.getIdToken).toHaveBeenCalledOnce());
    authentication.auth.currentUser = replacementUser;
    token.resolve('fresh-token');

    await expect(deletion).rejects.toThrow('Account changed while refreshing credentials.');

    expect(functions.httpsCallable).not.toHaveBeenCalled();
    expect(functions.callable).not.toHaveBeenCalled();
    expect(localStorage.getItem(gamificationStorageKeys(originalUser.uid).snapshot)).toBe('original-owner-cache');
    expect(sessionStorage.getItem('lingoflash_word_draft')).toBe('original-owner-draft');
    expect(authentication.signOut).not.toHaveBeenCalled();
    expect(firestoreClient.terminate).not.toHaveBeenCalled();
  });

  it('preserves the replacement account shared state when deletion resolves after an owner switch', async () => {
    const callable = deferred<{ data: { status: string } }>();
    const originalUser = authentication.auth.currentUser!;
    const replacementUser = { uid: 'user-2', getIdToken: vi.fn(async () => 'fresh-token') };
    functions.callable.mockImplementation(() => callable.promise);
    localStorage.setItem(gamificationStorageKeys(originalUser.uid).snapshot, 'original-owner-cache');
    localStorage.setItem(gamificationStorageKeys(replacementUser.uid).snapshot, 'replacement-owner-cache');
    localStorage.setItem('lingoflash_shared_deck_operation_v1', 'replacement-operation');
    sessionStorage.setItem('lingoflash_word_draft', 'replacement-draft');

    const deletion = deleteAccount('XÓA TÀI KHOẢN');
    await vi.waitFor(() => expect(functions.callable).toHaveBeenCalledOnce());
    authentication.auth.currentUser = replacementUser;
    callable.resolve({ data: { status: 'deleted' } });

    await expect(deletion).resolves.toEqual({ status: 'completed', restartRequired: false, cacheCleared: true });

    expect(localStorage.getItem(gamificationStorageKeys(originalUser.uid).snapshot)).toBeNull();
    expect(localStorage.getItem(gamificationStorageKeys(replacementUser.uid).snapshot)).toBe('replacement-owner-cache');
    expect(localStorage.getItem('lingoflash_shared_deck_operation_v1')).toBe('replacement-operation');
    expect(sessionStorage.getItem('lingoflash_word_draft')).toBe('replacement-draft');
    expect(authentication.signOut).not.toHaveBeenCalled();
    expect(firestoreClient.terminate).not.toHaveBeenCalled();
  });

  it('preserves the replacement account shared state when deletion times out after an owner switch', async () => {
    const callable = deferred<never>();
    const originalUser = authentication.auth.currentUser!;
    const replacementUser = { uid: 'user-2', getIdToken: vi.fn(async () => 'fresh-token') };
    functions.callable.mockImplementation(() => callable.promise);
    localStorage.setItem(gamificationStorageKeys(originalUser.uid).snapshot, 'original-owner-cache');
    localStorage.setItem(gamificationStorageKeys(replacementUser.uid).snapshot, 'replacement-owner-cache');
    localStorage.setItem('lingoflash_shared_deck_operation_v1', 'replacement-operation');
    sessionStorage.setItem('lingoflash_word_draft', 'replacement-draft');

    const deletion = deleteAccount('XÓA TÀI KHOẢN');
    await vi.waitFor(() => expect(functions.callable).toHaveBeenCalledOnce());
    authentication.auth.currentUser = replacementUser;
    callable.reject(Object.assign(new Error('deadline exceeded'), { code: 'functions/deadline-exceeded' }));

    await expect(deletion).resolves.toEqual({ status: 'started', restartRequired: false, cacheCleared: true });

    expect(localStorage.getItem(gamificationStorageKeys(originalUser.uid).snapshot)).toBeNull();
    expect(localStorage.getItem(gamificationStorageKeys(replacementUser.uid).snapshot)).toBe('replacement-owner-cache');
    expect(localStorage.getItem('lingoflash_shared_deck_operation_v1')).toBe('replacement-operation');
    expect(sessionStorage.getItem('lingoflash_word_draft')).toBe('replacement-draft');
    expect(authentication.signOut).not.toHaveBeenCalled();
    expect(firestoreClient.terminate).not.toHaveBeenCalled();
  });

  it.each(['functions/invalid-argument', 'functions/permission-denied'])(
    'rethrows %s without clearing local data, signing out, or clearing the Firestore cache', async code => {
    functions.callable.mockRejectedValue(Object.assign(new Error('deletion was rejected'), { code }));

    await expect(deleteAccount('wrong phrase')).rejects.toThrow('deletion was rejected');

    expect(authentication.signOut).not.toHaveBeenCalled();
    expect(firestoreClient.terminate).not.toHaveBeenCalled();
    },
  );

  it('reports the cache lifecycle attempt when persistence clearing fails after termination', async () => {
    functions.callable.mockResolvedValue({ data: { status: 'deleted' } });
    firestoreClient.clearIndexedDbPersistence.mockRejectedValue(new Error('persistence unavailable'));

    const result = await deleteAccount('XÓA TÀI KHOẢN');

    expect(result).toEqual({ status: 'completed', restartRequired: true, cacheCleared: false });
    expect(firestoreClient.terminate).toHaveBeenCalledWith(firestoreClient.db);
    expect(firestoreClient.clearIndexedDbPersistence).toHaveBeenCalledWith(firestoreClient.db);
  });

  it('does not report a cache lifecycle attempt when Firestore is unavailable', async () => {
    functions.callable.mockResolvedValue({ data: { status: 'deleted' } });
    firestoreClient.db = null;

    await expect(deleteAccount('XÓA TÀI KHOẢN')).resolves.toEqual({
      status: 'completed', restartRequired: true, cacheCleared: true,
    });
    expect(firestoreClient.terminate).not.toHaveBeenCalled();
    expect(firestoreClient.clearIndexedDbPersistence).not.toHaveBeenCalled();
  });

  it('treats a timeout or internal error as a started deletion and still clears local data', async () => {
    functions.callable.mockRejectedValue(Object.assign(new Error('deadline exceeded'), { code: 'functions/deadline-exceeded' }));

    const result = await deleteAccount('XÓA TÀI KHOẢN');

    expect(result).toEqual({ status: 'started', restartRequired: true, cacheCleared: true });
    expect(authentication.signOut).toHaveBeenCalledOnce();
    expect(firestoreClient.terminate).toHaveBeenCalledWith(firestoreClient.db);
    expect(firestoreClient.clearIndexedDbPersistence).toHaveBeenCalledWith(firestoreClient.db);
  });

  it('reports incomplete device cleanup after sign-out when local storage removal fails', async () => {
    functions.callable.mockRejectedValue(Object.assign(new Error('internal'), { code: 'functions/internal' }));
    vi.stubGlobal('localStorage', {
      ...fakeStorage(),
      removeItem: () => { throw new Error('storage unavailable'); },
    });

    await expect(deleteAccount('XÓA TÀI KHOẢN')).resolves.toEqual({
      status: 'started', restartRequired: true, cacheCleared: false,
    });

    expect(authentication.signOut).toHaveBeenCalledOnce();
    expect(firestoreClient.terminate).toHaveBeenCalledWith(firestoreClient.db);
    expect(firestoreClient.clearIndexedDbPersistence).toHaveBeenCalledWith(firestoreClient.db);
  });
});

describe('downloadAccountData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authentication.auth.currentUser = { uid: 'user-1', getIdToken: vi.fn(async () => 'fresh-token') };
    functions.getFunctions.mockReturnValue({ region: 'asia-southeast1' });
    functions.httpsCallable.mockReturnValue(functions.callable);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('does not download an export after the owner switches while the callable is pending', async () => {
    const response = deferred<{ data: { cards: string[] } }>();
    const link = { click: vi.fn() };
    const createObjectURL = vi.fn();
    functions.callable.mockImplementation(() => response.promise);
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    vi.stubGlobal('document', {
      body: { append: vi.fn() },
      createElement: vi.fn(() => link),
    });

    const download = downloadAccountData();
    await vi.waitFor(() => expect(functions.callable).toHaveBeenCalledOnce());
    authentication.auth.currentUser = { uid: 'user-2', getIdToken: vi.fn(async () => 'fresh-token') };
    response.resolve({ data: { cards: ['private'] } });

    await expect(download).rejects.toThrow('Account changed while exporting data.');
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(document.createElement).not.toHaveBeenCalled();
    expect(link.click).not.toHaveBeenCalled();
  });
});
