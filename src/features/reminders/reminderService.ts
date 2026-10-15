import { getDocFromServer, doc, type DocumentData } from 'firebase/firestore';
import { app, auth, db, getSonFlashFunctions, protectedFunctionsCapability } from '../../lib/firebase';

export type ReminderSettings = {
  days: number[];
  sendAtLocal: string;
  timezone: string;
  locale: 'en' | 'vi';
  quietHours: { startLocal: string; endLocal: string } | null;
  onlyIfNotStudiedToday: boolean;
  channels: { push: boolean; emailDigest: boolean };
};

export const defaultReminderSettings = (): ReminderSettings => ({
  days: [1, 2, 3, 4, 5, 6, 0], sendAtLocal: '08:00',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  locale: 'en', quietHours: null, onlyIfNotStudiedToday: true,
  channels: { push: false, emailDigest: false },
});

const storedTokenKey = (uid: string) => `sonflash_push_token_${encodeURIComponent(uid)}`;
const sessionTokens = new Map<string, string>();
const pendingSaves = new Map<string, Set<Promise<ReminderSettings>>>();
const closingOwners = new Set<string>();
const storedToken = (uid: string): string | null => {
  if (sessionTokens.has(uid)) return sessionTokens.get(uid) ?? null;
  try { return localStorage.getItem(storedTokenKey(uid)); }
  catch { return sessionTokens.get(uid) ?? null; }
};
const rememberToken = (uid: string, token: string): void => {
  sessionTokens.set(uid, token);
  try { localStorage.setItem(storedTokenKey(uid), token); } catch { /* Session memory remains available. */ }
};
const forgetToken = (uid: string, token: string): void => {
  if (sessionTokens.get(uid) === token) sessionTokens.delete(uid);
  try {
    if (localStorage.getItem(storedTokenKey(uid)) === token) localStorage.removeItem(storedTokenKey(uid));
  } catch { /* Server revocation has already succeeded. */ }
};
const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY?.trim() ?? '';

const call = async <Request extends object, Response>(
  name: string, request: Request, expectedOwnerId: string,
): Promise<Response> => {
  if (!app || auth?.currentUser?.uid !== expectedOwnerId || !protectedFunctionsCapability.available) {
    throw new Error('Protected reminder service is unavailable.');
  }
  const { httpsCallable } = await import('firebase/functions');
  const functions = await getSonFlashFunctions(app);
  if (auth?.currentUser?.uid !== expectedOwnerId) throw new Error('Account changed while saving reminders.');
  return (await httpsCallable<Request & { expectedOwnerId: string }, Response>(functions, name)(
    { ...request, expectedOwnerId },
  )).data;
};

export const canOfferBrowserPush = async (): Promise<boolean> => {
  if (!vapidKey || !app || !globalThis.isSecureContext || !('Notification' in globalThis)
    || !('serviceWorker' in navigator)) return false;
  const { isSupported } = await import('firebase/messaging');
  return isSupported();
};

const currentPushToken = async (permission: NotificationPermission): Promise<string> => {
  if (!await canOfferBrowserPush() || !app) throw new Error('Browser push is unavailable on this device.');
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
  const { getMessaging, getToken } = await import('firebase/messaging');
  const token = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: registration });
  if (!token) throw new Error('Browser push registration did not return a token.');
  return token;
};

const parseStored = (data: DocumentData | undefined): ReminderSettings => {
  const defaults = defaultReminderSettings();
  if (!data) return defaults;
  return {
    days: Array.isArray(data.days) ? data.days : defaults.days,
    sendAtLocal: typeof data.sendAtLocal === 'string' ? data.sendAtLocal : defaults.sendAtLocal,
    timezone: typeof data.timezone === 'string' ? data.timezone : defaults.timezone,
    locale: data.locale === 'vi' ? 'vi' : 'en',
    quietHours: data.quietHours && typeof data.quietHours.startLocal === 'string'
      && typeof data.quietHours.endLocal === 'string' ? data.quietHours : null,
    onlyIfNotStudiedToday: data.onlyIfNotStudiedToday !== false,
    channels: { push: data.channels?.push === true, emailDigest: data.channels?.emailDigest === true },
  };
};

export const loadReminderSettings = async (uid: string): Promise<ReminderSettings> => {
  if (!db || auth?.currentUser?.uid !== uid) throw new Error('Sign in to view reminder settings.');
  const snapshot = await getDocFromServer(doc(db, 'users', uid, 'reminderState', 'current'));
  if (auth?.currentUser?.uid !== uid) throw new Error('Account changed while loading reminders.');
  return parseStored(snapshot.data());
};

const performReminderSave = async (uid: string, settings: ReminderSettings): Promise<ReminderSettings> => {
  if (closingOwners.has(uid)) throw new Error('Account is signing out.');
  if (auth?.currentUser?.uid !== uid) throw new Error('Account changed while saving reminders.');
  // Ask while the Save click still has user activation; SDK capability checks
  // and service-worker registration can happen afterward.
  const permission = settings.channels.push && vapidKey && globalThis.isSecureContext
    && 'Notification' in globalThis && 'serviceWorker' in navigator
    ? Notification.requestPermission() : null;
  const pushGranted = permission && await permission === 'granted' && await canOfferBrowserPush();
  const effectiveSettings = pushGranted
    ? settings
    : { ...settings, channels: { ...settings.channels, push: false } };
  const token = pushGranted ? await currentPushToken('granted') : null;
  if (auth?.currentUser?.uid !== uid) throw new Error('Account changed while saving reminders.');
  const previousToken = storedToken(uid);
  if (token && previousToken && previousToken !== token) {
    await call('revokePushToken', { token: previousToken }, uid);
  }
  await call('updateReminderSettings', { ...effectiveSettings, ...(token ? { pushToken: token } : {}) }, uid);
  if (token) rememberToken(uid, token);
  else if (!effectiveSettings.channels.push && previousToken) forgetToken(uid, previousToken);
  return effectiveSettings;
};

export const saveReminderSettings = (settings: ReminderSettings): Promise<ReminderSettings> => {
  const uid = auth?.currentUser?.uid;
  if (!uid) return Promise.reject(new Error('Sign in to save reminder settings.'));
  if (closingOwners.has(uid)) return Promise.reject(new Error('Account is signing out.'));
  const save = performReminderSave(uid, settings);
  const pending = pendingSaves.get(uid) ?? new Set<Promise<ReminderSettings>>();
  pending.add(save);
  pendingSaves.set(uid, pending);
  void save.finally(() => {
    pending.delete(save);
    if (pending.size === 0) pendingSaves.delete(uid);
  }).catch(() => undefined);
  return save;
};

/** End the old owner's push session before sign-out or account switch. */
export const revokeCurrentOwnerPushToken = async (): Promise<void> => {
  const uid = auth?.currentUser?.uid;
  if (!uid) return;
  closingOwners.add(uid);
  await Promise.allSettled([...pendingSaves.get(uid) ?? []]);
  const previousToken = storedToken(uid);
  await call('endPushSession', {}, uid);
  if (previousToken) forgetToken(uid, previousToken);
};

export const finishReminderSignOut = (): void => { closingOwners.clear(); };
