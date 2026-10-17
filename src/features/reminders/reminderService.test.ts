import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'owner-a' } },
  callable: vi.fn(),
  httpsCallable: vi.fn(),
  getSonFlashFunctions: vi.fn(),
  getToken: vi.fn(),
  isSupported: vi.fn(),
  doc: vi.fn(),
  getDocFromServer: vi.fn(),
}));
vi.mock('../../lib/firebase', () => ({
  app: {}, auth: runtime.auth, db: {},
  getSonFlashFunctions: runtime.getSonFlashFunctions,
  protectedFunctionsCapability: { available: true },
}));
vi.mock('firebase/functions', () => ({ httpsCallable: runtime.httpsCallable }));
vi.mock('firebase/messaging', () => ({
  isSupported: runtime.isSupported,
  getMessaging: vi.fn(() => ({})),
  getToken: runtime.getToken,
}));
vi.mock('firebase/firestore', () => ({
  doc: runtime.doc,
  getDocFromServer: runtime.getDocFromServer,
}));

import { defaultReminderSettings, finishReminderSignOut, loadReminderSettings, revokeCurrentOwnerPushToken, saveReminderSettings } from './reminderService';

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  runtime.auth.currentUser.uid = 'owner-a';
  runtime.callable.mockReset().mockResolvedValue({ data: { saved: true } });
  runtime.httpsCallable.mockReset().mockReturnValue(runtime.callable);
  runtime.getSonFlashFunctions.mockReset().mockResolvedValue({});
  runtime.getToken.mockReset().mockResolvedValue('n'.repeat(64));
  runtime.isSupported.mockReset().mockResolvedValue(true);
  runtime.doc.mockReset().mockReturnValue({ path: 'users/owner-a/reminderState/current' });
  runtime.getDocFromServer.mockReset();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  });
});

afterEach(() => {
  finishReminderSignOut();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('reminder settings loading', () => {
  it('rejects a response that resolves after the authenticated owner changes', async () => {
    let finishRead!: (snapshot: { data: () => object }) => void;
    const staleData = vi.fn(() => ({ sendAtLocal: '19:00' }));
    runtime.getDocFromServer.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));

    const loading = loadReminderSettings('owner-a');
    runtime.auth.currentUser.uid = 'owner-b';
    finishRead({ data: staleData });

    await expect(loading).rejects.toThrow('Account changed while loading reminders.');
    expect(staleData).not.toHaveBeenCalled();
  });

  it('falls back field by field when the stored reminder document is malformed', async () => {
    const defaults = defaultReminderSettings();
    runtime.getDocFromServer.mockResolvedValueOnce({
      data: () => ({
        days: 'weekdays',
        sendAtLocal: 800,
        timezone: null,
        locale: 'fr',
        quietHours: { startLocal: '22:00' },
        onlyIfNotStudiedToday: 'yes',
        channels: { push: 'yes', emailDigest: 1 },
      }),
    });

    await expect(loadReminderSettings('owner-a')).resolves.toEqual(defaults);
  });

  it('preserves valid stored fields beside malformed fields', async () => {
    const defaults = defaultReminderSettings();
    runtime.getDocFromServer.mockResolvedValueOnce({
      data: () => ({
        days: [1, 3, 5],
        sendAtLocal: 800,
        timezone: 'Asia/Ho_Chi_Minh',
        locale: 'vi',
        quietHours: { startLocal: '22:00' },
        onlyIfNotStudiedToday: false,
        channels: { push: true, emailDigest: 'yes' },
      }),
    });

    await expect(loadReminderSettings('owner-a')).resolves.toEqual({
      ...defaults,
      days: [1, 3, 5],
      timezone: 'Asia/Ho_Chi_Minh',
      locale: 'vi',
      onlyIfNotStudiedToday: false,
      channels: { push: true, emailDigest: false },
    });
  });
});

describe('reminder device token ownership', () => {
  it('revokes the signed-in owner token before sign-out', async () => {
    storage.set('sonflash_push_token_owner-a', 'a'.repeat(64));
    await revokeCurrentOwnerPushToken();
    expect(runtime.httpsCallable).toHaveBeenCalledWith({}, 'endPushSession');
    expect(runtime.callable).toHaveBeenCalledWith({ expectedOwnerId: 'owner-a' });
    expect(storage.size).toBe(0);
  });

  it('ends the server push session when neither storage nor browser can recover a token', async () => {
    await revokeCurrentOwnerPushToken();
    expect(runtime.httpsCallable).toHaveBeenCalledWith({}, 'endPushSession');
    expect(runtime.callable).toHaveBeenCalledExactlyOnceWith({ expectedOwnerId: 'owner-a' });
    expect(runtime.getToken).not.toHaveBeenCalled();
  });

  it('retains the token when revocation fails, so sign-out can be retried', async () => {
    storage.set('sonflash_push_token_owner-a', 'a'.repeat(64));
    runtime.callable.mockRejectedValueOnce(new Error('offline'));
    await expect(revokeCurrentOwnerPushToken()).rejects.toThrow('offline');
    expect(storage.get('sonflash_push_token_owner-a')).toBe('a'.repeat(64));
  });

  it('removes a local token only after the server disables push', async () => {
    storage.set('sonflash_push_token_owner-a', 'a'.repeat(64));
    const settings = defaultReminderSettings();
    await saveReminderSettings(settings);
    expect(runtime.httpsCallable).toHaveBeenCalledWith({}, 'updateReminderSettings');
    expect(storage.size).toBe(0);
  });

  it('persists disabled push after permission is denied and clears the old local token only after saving', async () => {
    vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'test-vapid-key');
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('Notification', { requestPermission: vi.fn(async () => 'denied') });
    vi.stubGlobal('navigator', { serviceWorker: { register: vi.fn() } });
    vi.resetModules();
    const { defaultReminderSettings: defaults, saveReminderSettings: save } = await import('./reminderService');
    storage.set('sonflash_push_token_owner-a', 'a'.repeat(64));
    const requested = { ...defaults(), channels: { push: true, emailDigest: false } };

    await expect(save(requested)).resolves.toEqual({ ...requested, channels: { push: false, emailDigest: false } });
    expect(runtime.callable).toHaveBeenCalledWith({
      ...requested, channels: { push: false, emailDigest: false }, expectedOwnerId: 'owner-a',
    });
    expect(storage.size).toBe(0);
  });

  it('keeps the old local token when persisting denied push fails', async () => {
    vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'test-vapid-key');
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('Notification', { requestPermission: vi.fn(async () => 'denied') });
    vi.stubGlobal('navigator', { serviceWorker: { register: vi.fn() } });
    vi.resetModules();
    const { defaultReminderSettings: defaults, saveReminderSettings: save } = await import('./reminderService');
    storage.set('sonflash_push_token_owner-a', 'a'.repeat(64));
    runtime.callable.mockRejectedValueOnce(new Error('offline'));

    await expect(save({ ...defaults(), channels: { push: true, emailDigest: false } })).rejects.toThrow('offline');
    expect(storage.get('sonflash_push_token_owner-a')).toBe('a'.repeat(64));
  });

  it('persists disabled push when browser messaging is unsupported', async () => {
    vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'test-vapid-key');
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('Notification', { requestPermission: vi.fn(async () => 'granted') });
    vi.stubGlobal('navigator', { serviceWorker: { register: vi.fn() } });
    runtime.isSupported.mockResolvedValueOnce(false);
    vi.resetModules();
    const { defaultReminderSettings: defaults, saveReminderSettings: save } = await import('./reminderService');
    const requested = { ...defaults(), channels: { push: true, emailDigest: false } };

    await expect(save(requested)).resolves.toEqual({ ...requested, channels: { push: false, emailDigest: false } });
    expect(runtime.callable).toHaveBeenCalledWith({
      ...requested, channels: { push: false, emailDigest: false }, expectedOwnerId: 'owner-a',
    });
    expect(runtime.getToken).not.toHaveBeenCalled();
  });

  it('reports a permission error when messaging support is unavailable', async () => {
    vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'test-vapid-key');
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('Notification', { requestPermission: vi.fn(async () => { throw new Error('permission failed'); }) });
    vi.stubGlobal('navigator', { serviceWorker: { register: vi.fn() } });
    runtime.isSupported.mockResolvedValueOnce(false);
    vi.resetModules();
    const { defaultReminderSettings: defaults, saveReminderSettings: save } = await import('./reminderService');

    await expect(save({ ...defaults(), channels: { push: true, emailDigest: false } })).rejects.toThrow('permission failed');
    expect(runtime.callable).not.toHaveBeenCalled();
  });

  it('does not invoke a callable under a different account after async setup', async () => {
    let finishSetup!: (value: object) => void;
    runtime.getSonFlashFunctions.mockImplementationOnce(() => new Promise(resolve => { finishSetup = resolve; }));
    const saving = saveReminderSettings(defaultReminderSettings());
    await vi.waitFor(() => expect(runtime.getSonFlashFunctions).toHaveBeenCalledOnce());
    runtime.auth.currentUser.uid = 'owner-b';
    finishSetup({});
    await expect(saving).rejects.toThrow('Account changed');
    expect(runtime.httpsCallable).not.toHaveBeenCalled();
  });

  it('keeps the previous token when rotation fails before the new token is saved', async () => {
    vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'test-vapid-key');
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('Notification', { requestPermission: vi.fn(async () => 'granted') });
    vi.stubGlobal('navigator', { serviceWorker: { register: vi.fn(async () => ({})) } });
    vi.resetModules();
    const { saveReminderSettings: saveWithPush } = await import('./reminderService');
    storage.set('sonflash_push_token_owner-a', 'a'.repeat(64));
    runtime.callable.mockRejectedValueOnce(new Error('offline'));
    const settings = { ...defaultReminderSettings(), channels: { push: true, emailDigest: false } };
    await expect(saveWithPush(settings)).rejects.toThrow('offline');
    expect(runtime.callable).toHaveBeenCalledWith({ token: 'a'.repeat(64), expectedOwnerId: 'owner-a' });
    expect(storage.get('sonflash_push_token_owner-a')).toBe('a'.repeat(64));
  });

  it('can revoke a saved push token when browser storage throws', async () => {
    vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'test-vapid-key');
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('Notification', { requestPermission: vi.fn(async () => 'granted') });
    vi.stubGlobal('navigator', { serviceWorker: { register: vi.fn(async () => ({})) } });
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('storage blocked'); },
      setItem: () => { throw new Error('storage blocked'); },
      removeItem: () => { throw new Error('storage blocked'); },
    });
    vi.resetModules();
    const service = await import('./reminderService');
    await expect(service.saveReminderSettings({
      ...service.defaultReminderSettings(), channels: { push: true, emailDigest: false },
    })).resolves.toMatchObject({ channels: { push: true, emailDigest: false } });
    await expect(service.revokeCurrentOwnerPushToken()).resolves.toBeUndefined();
    expect(runtime.callable).toHaveBeenCalledWith({ expectedOwnerId: 'owner-a' });
  });

  it('waits for an in-flight save before ending the push session', async () => {
    vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'test-vapid-key');
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('Notification', { requestPermission: vi.fn(async () => 'granted') });
    vi.stubGlobal('navigator', { serviceWorker: { register: vi.fn(async () => ({})) } });
    vi.resetModules();
    const service = await import('./reminderService');
    storage.set('sonflash_push_token_owner-a', 'a'.repeat(64));
    let finishSave!: (value: { data: { saved: boolean } }) => void;
    runtime.callable.mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve; }));
    const settings = { ...service.defaultReminderSettings(), channels: { push: true, emailDigest: false } };
    const saving = service.saveReminderSettings(settings);
    await vi.waitFor(() => expect(runtime.callable).toHaveBeenCalledTimes(1));
    const revoking = service.revokeCurrentOwnerPushToken();
    await Promise.resolve();
    expect(runtime.callable).toHaveBeenCalledTimes(1);
    await expect(service.saveReminderSettings(settings)).rejects.toThrow('signing out');
    finishSave({ data: { saved: true } });
    await saving;
    await revoking;
    expect(runtime.callable).toHaveBeenLastCalledWith({
      expectedOwnerId: 'owner-a',
    });
  });

  it('ends the owner session after an ambiguous rotation response', async () => {
    vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'test-vapid-key');
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('Notification', {
      permission: 'granted', requestPermission: vi.fn(async () => 'granted'),
    });
    vi.stubGlobal('navigator', { serviceWorker: { register: vi.fn(async () => ({})) } });
    vi.resetModules();
    const service = await import('./reminderService');
    storage.set('sonflash_push_token_owner-a', 'a'.repeat(64));
    runtime.callable.mockResolvedValueOnce({ data: { revoked: true } })
      .mockRejectedValueOnce(new Error('response lost'));
    await expect(service.saveReminderSettings({
      ...service.defaultReminderSettings(), channels: { push: true, emailDigest: false },
    })).rejects.toThrow('response lost');
    await service.revokeCurrentOwnerPushToken();
    expect(runtime.httpsCallable).toHaveBeenCalledWith({}, 'endPushSession');
    expect(runtime.callable).toHaveBeenLastCalledWith({ expectedOwnerId: 'owner-a' });
    expect(storage.size).toBe(0);
  });
});
