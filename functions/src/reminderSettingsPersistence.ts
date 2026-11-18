import { Timestamp, type DocumentData, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { createHash, randomUUID } from 'node:crypto';
import { InputValidationError } from './inputValidation.js';
import { nextReminderOccurrence, type ReminderSchedule } from './reminderSchedule.js';

export type ReminderSettingsRequest = Omit<ReminderSchedule, 'quietHours'> & {
  readonly locale: 'en' | 'vi';
  readonly quietHours: ReminderSchedule['quietHours'] | null;
  readonly onlyIfNotStudiedToday: boolean;
  readonly channels: { readonly push: boolean; readonly emailDigest: boolean };
  readonly pushToken?: string;
  readonly expectedOwnerId?: string;
};

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const validOwnerId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('/');

const validAuthTimeSeconds = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const pushTokenId = (token: string): string => createHash('sha256').update(token).digest('hex');

const disablePush = (transaction: Transaction, stateRef: DocumentReference, now: Date): void => {
  transaction.update(stateRef, {
    'channels.push': false,
    nextEligibleSendAt: null,
    nextEligibleLocalDay: null,
    consecutiveIgnored: 0,
    lastPushReceiptId: null,
    lastEvaluatedSentAt: null,
    backoffSkipNext: false,
    updatedAt: Timestamp.fromDate(now),
  });
};

export function parsePushTokenRequest(value: unknown): string {
  if (!record(value) || Object.keys(value).some(key => !['token', 'expectedOwnerId', 'endSession'].includes(key))
    || !Object.hasOwn(value, 'token')
    || typeof value.token !== 'string' || value.token.length < 32
    || value.token.length > 4096 || /\s/.test(value.token)
    || (value.expectedOwnerId !== undefined && !validOwnerId(value.expectedOwnerId))
    || (value.endSession !== undefined && typeof value.endSession !== 'boolean')) {
    throw new InputValidationError('Push token is invalid.');
  }
  return value.token;
}

export function parseEndPushSessionRequest(value: unknown): string {
  if (!record(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'expectedOwnerId')
    || !validOwnerId(value.expectedOwnerId)) {
    throw new InputValidationError('Reminder owner is invalid.');
  }
  return value.expectedOwnerId;
}

export function parseReminderSettingsRequest(value: unknown): ReminderSettingsRequest {
  if (!record(value) || Object.keys(value).some(key => ![
    'channels', 'days', 'locale', 'onlyIfNotStudiedToday', 'quietHours', 'sendAtLocal', 'timezone', 'pushToken', 'expectedOwnerId',
  ].includes(key)) || ![
    'channels', 'days', 'locale', 'onlyIfNotStudiedToday', 'quietHours', 'sendAtLocal', 'timezone',
  ].every(key => Object.hasOwn(value, key))) {
    throw new InputValidationError('Reminder settings are invalid.');
  }
  const channels = value.channels;
  if (!record(channels) || Object.keys(channels).sort().join() !== 'emailDigest,push'
    || typeof channels.push !== 'boolean' || typeof channels.emailDigest !== 'boolean'
    || typeof value.onlyIfNotStudiedToday !== 'boolean') {
    throw new InputValidationError('Reminder channels are invalid.');
  }
  const quietHours = value.quietHours;
  if (quietHours !== null && (!record(quietHours)
    || Object.keys(quietHours).sort().join() !== 'endLocal,startLocal'
    || typeof quietHours.startLocal !== 'string' || typeof quietHours.endLocal !== 'string')) {
    throw new InputValidationError('Reminder quiet hours are invalid.');
  }
  if (!Array.isArray(value.days) || typeof value.sendAtLocal !== 'string'
    || typeof value.timezone !== 'string' || typeof value.locale !== 'string'
    || !['en', 'vi'].includes(value.locale)) {
    throw new InputValidationError('Reminder schedule is invalid.');
  }
  if (value.pushToken !== undefined && channels.push !== true) {
    throw new InputValidationError('Push token is invalid.');
  }
  if (value.expectedOwnerId !== undefined && !validOwnerId(value.expectedOwnerId)) {
    throw new InputValidationError('Reminder owner is invalid.');
  }
  const pushToken = value.pushToken === undefined ? undefined : parsePushTokenRequest({ token: value.pushToken });
  const schedule = {
    days: value.days as number[], sendAtLocal: value.sendAtLocal,
    timezone: value.timezone,
    ...(quietHours === null ? {} : { quietHours: quietHours as ReminderSchedule['quietHours'] }),
  };
  nextReminderOccurrence(schedule, new Date());
  return {
    ...schedule,
    quietHours: quietHours as ReminderSettingsRequest['quietHours'],
    locale: value.locale as ReminderSettingsRequest['locale'],
    onlyIfNotStudiedToday: value.onlyIfNotStudiedToday,
    channels: { push: channels.push, emailDigest: channels.emailDigest },
    ...(pushToken === undefined ? {} : { pushToken }),
    ...(value.expectedOwnerId === undefined ? {} : { expectedOwnerId: value.expectedOwnerId }),
  };
}

export function reminderStateForSettings(
  settings: ReminderSettingsRequest,
  now: Date,
  previous?: DocumentData,
): DocumentData {
  const schedule = {
    days: settings.days, sendAtLocal: settings.sendAtLocal, timezone: settings.timezone,
    ...(settings.quietHours ? { quietHours: settings.quietHours } : {}),
  };
  const nextPush = nextReminderOccurrence(schedule, now);
  const nextDigest = nextReminderOccurrence({ ...schedule, days: [0] }, now);
  const keepBackoff = previous?.channels?.push === true && settings.channels.push;
  return {
    timezone: settings.timezone,
    locale: settings.locale,
    days: settings.days,
    sendAtLocal: settings.sendAtLocal,
    quietHours: settings.quietHours,
    onlyIfNotStudiedToday: settings.onlyIfNotStudiedToday,
    channels: settings.channels,
    nextEligibleSendAt: settings.channels.push ? Timestamp.fromDate(nextPush.at) : null,
    nextEligibleLocalDay: settings.channels.push ? nextPush.scheduledDay : null,
    nextWeeklyDigestAt: settings.channels.emailDigest ? Timestamp.fromDate(nextDigest.at) : null,
    nextWeeklyDigestLocalDay: settings.channels.emailDigest ? nextDigest.scheduledDay : null,
    consecutiveIgnored: keepBackoff && Number.isSafeInteger(previous?.consecutiveIgnored)
      && previous.consecutiveIgnored >= 0 ? previous.consecutiveIgnored : 0,
    lastPushReceiptId: keepBackoff && typeof previous?.lastPushReceiptId === 'string'
      ? previous.lastPushReceiptId : null,
    lastEvaluatedSentAt: keepBackoff && previous?.lastEvaluatedSentAt instanceof Timestamp
      ? previous.lastEvaluatedSentAt : null,
    backoffSkipNext: keepBackoff && previous?.backoffSkipNext === true,
    updatedAt: Timestamp.fromDate(now),
  };
}

export async function updateReminderSettingsForOwner(
  database: Firestore,
  ownerId: string,
  settings: ReminderSettingsRequest,
  now = new Date(),
  verifiedAuthTimeSeconds?: number,
): Promise<DocumentData> {
  if (!ownerId || ownerId.includes('/')) throw new InputValidationError('Reminder owner is invalid.');
  if (verifiedAuthTimeSeconds !== undefined && !validAuthTimeSeconds(verifiedAuthTimeSeconds)) {
    throw new InputValidationError('Reminder auth time is invalid.');
  }
  if (settings.channels.push && !settings.pushToken) {
    throw new InputValidationError('A push token is required.');
  }
  const owner = database.collection('users').doc(ownerId);
  const stateRef = owner.collection('reminderState').doc('current');
  const tokens = owner.collection('pushTokens');
  const tokensQuery = tokens.limit(21);
  const tokenId = settings.pushToken ? pushTokenId(settings.pushToken) : null;
  const registry = database.collection('pushTokenOwners');
  const registryRef = tokenId ? registry.doc(tokenId) : null;
  const cutoffRef = tokenId ? owner.collection('pushTokenSessionCutoffs').doc(tokenId) : null;
  const sessionCutoffRef = settings.channels.push
    ? owner.collection('pushTokenSessionCutoffs').doc('session') : null;
  return database.runTransaction(async transaction => {
    const [previousSnapshot, tokenSnapshot, registrySnapshot, cutoffSnapshot, sessionCutoffSnapshot] = await Promise.all([
      transaction.get(stateRef), transaction.get(tokensQuery),
      ...(registryRef ? [transaction.get(registryRef)] : []),
      ...(cutoffRef ? [transaction.get(cutoffRef)] : []),
      ...(sessionCutoffRef ? [transaction.get(sessionCutoffRef)] : []),
    ]);
    const previous = previousSnapshot.data();
    if (settings.channels.push && tokenSnapshot.size > 20) throw new InputValidationError('Push token limit reached.');
    const storedToken = tokenSnapshot.docs.find(doc => doc.id === tokenId);
    if (tokenId && tokenSnapshot.size >= 20 && !storedToken) {
      throw new InputValidationError('Push token limit reached.');
    }
    const cutoffAuthTime = cutoffSnapshot?.data()?.authTimeSeconds;
    if (cutoffAuthTime !== undefined && !validAuthTimeSeconds(cutoffAuthTime)) {
      throw new InputValidationError('Push token cutoff is invalid.');
    }
    if (cutoffAuthTime !== undefined && (verifiedAuthTimeSeconds === undefined || verifiedAuthTimeSeconds <= cutoffAuthTime)) {
      throw new InputValidationError('Push token session has ended.');
    }
    const sessionCutoffAuthTime = sessionCutoffSnapshot?.data()?.authTimeSeconds;
    if (sessionCutoffAuthTime !== undefined && !validAuthTimeSeconds(sessionCutoffAuthTime)) {
      throw new InputValidationError('Push token cutoff is invalid.');
    }
    if (sessionCutoffAuthTime !== undefined && (verifiedAuthTimeSeconds === undefined || verifiedAuthTimeSeconds <= sessionCutoffAuthTime)) {
      throw new InputValidationError('Push token session has ended.');
    }
    const previousOwnerId = registrySnapshot?.data()?.ownerId;
    const previousOwner = validOwnerId(previousOwnerId) && previousOwnerId !== ownerId
      ? database.collection('users').doc(previousOwnerId) : null;
    const previousTokenRef = previousOwner && tokenId
      ? previousOwner.collection('pushTokens').doc(tokenId) : null;
    const previousTokensQuery = previousOwner?.collection('pushTokens').limit(2);
    const previousStateRef = previousOwner?.collection('reminderState').doc('current');
    const previousCutoffRef = previousOwner && tokenId
      ? previousOwner.collection('pushTokenSessionCutoffs').doc(tokenId) : null;
    const [previousTokenSnapshot, previousTokens, previousState, previousCutoffSnapshot] = previousOwner && previousTokenRef
      ? await Promise.all([
        transaction.get(previousTokenRef), transaction.get(previousTokensQuery!), transaction.get(previousStateRef!), transaction.get(previousCutoffRef!),
      ]) : [null, null, null, null];
    const registrySnapshots = !settings.channels.push
      ? await Promise.all(tokenSnapshot.docs.map(token => transaction.get(registry.doc(token.id)))) : [];
    const previousRegisteredAuthTime = registrySnapshot?.data()?.registeredAuthTime;
    const previousCutoffAuthTime = previousCutoffSnapshot?.data()?.authTimeSeconds;
    if (previousCutoffAuthTime !== undefined && !validAuthTimeSeconds(previousCutoffAuthTime)) {
      throw new InputValidationError('Push token cutoff is invalid.');
    }
    const registryBindingId = registrySnapshot?.data()?.ownerId === ownerId && typeof registrySnapshot?.data()?.bindingId === 'string'
      ? registrySnapshot.data()!.bindingId : randomUUID();
    const state = reminderStateForSettings(settings, now, previous);
    transaction.set(stateRef, state);
    if (settings.channels.push && tokenId && settings.pushToken) {
      transaction.set(tokens.doc(tokenId), {
        token: settings.pushToken, platform: 'web',
        createdAt: storedToken?.data()?.createdAt instanceof Timestamp
          ? storedToken.data().createdAt : Timestamp.fromDate(now),
        lastSeenAt: Timestamp.fromDate(now),
      });
      transaction.set(registryRef!, {
        ownerId,
        bindingId: registryBindingId,
        ...(verifiedAuthTimeSeconds === undefined ? {} : { registeredAuthTime: verifiedAuthTimeSeconds }),
        updatedAt: Timestamp.fromDate(now),
      });
      if (previousTokenSnapshot?.exists && previousTokenRef) transaction.delete(previousTokenRef);
      if (previousTokens?.size === 1 && previousState?.data()?.channels?.push === true && previousStateRef) {
        disablePush(transaction, previousStateRef, now);
      }
      if (previousCutoffRef && validAuthTimeSeconds(previousRegisteredAuthTime)) {
        transaction.set(previousCutoffRef, {
          authTimeSeconds: Math.max(previousRegisteredAuthTime, Math.floor(Date.now() / 1_000), previousCutoffAuthTime ?? 0),
          updatedAt: Timestamp.fromDate(now),
        });
      }
    }
    if (!settings.channels.push) tokenSnapshot.docs.forEach((token, index) => {
      transaction.delete(token.ref);
      if (registrySnapshots[index]?.data()?.ownerId === ownerId) transaction.delete(registry.doc(token.id));
    });
    return state;
  });
}

export async function revokePushTokenForOwner(
  database: Firestore,
  ownerId: string,
  token: string,
  now = new Date(),
  endSession = false,
  verifiedAuthTimeSeconds?: number,
): Promise<boolean> {
  if (!ownerId || ownerId.includes('/')) throw new InputValidationError('Reminder owner is invalid.');
  parsePushTokenRequest({ token });
  if (verifiedAuthTimeSeconds !== undefined && !validAuthTimeSeconds(verifiedAuthTimeSeconds)) {
    throw new InputValidationError('Reminder auth time is invalid.');
  }
  if (endSession && verifiedAuthTimeSeconds === undefined) throw new InputValidationError('Reminder auth time is required.');
  const owner = database.collection('users').doc(ownerId);
  const tokenId = pushTokenId(token);
  const tokenRef = owner.collection('pushTokens').doc(tokenId);
  const stateRef = owner.collection('reminderState').doc('current');
  const ownerRef = database.collection('pushTokenOwners').doc(tokenId);
  const cutoffRef = owner.collection('pushTokenSessionCutoffs').doc(tokenId);
  return database.runTransaction(async transaction => {
    const [tokenSnapshot, tokens, stateSnapshot, ownerSnapshot, cutoffSnapshot] = await Promise.all([
      transaction.get(tokenRef),
      transaction.get(owner.collection('pushTokens').limit(2)),
      transaction.get(stateRef),
      transaction.get(ownerRef),
      transaction.get(cutoffRef),
    ]);
    const cutoffAuthTime = cutoffSnapshot.data()?.authTimeSeconds;
    if (cutoffAuthTime !== undefined && !validAuthTimeSeconds(cutoffAuthTime)) {
      throw new InputValidationError('Push token cutoff is invalid.');
    }
    if (endSession) transaction.set(cutoffRef, {
      authTimeSeconds: Math.max(verifiedAuthTimeSeconds!, cutoffAuthTime ?? 0),
      updatedAt: Timestamp.fromDate(now),
    });
    if (!tokenSnapshot.exists) return false;
    transaction.delete(tokenRef);
    if (ownerSnapshot.data()?.ownerId === ownerId) transaction.delete(ownerRef);
    if (tokens.size === 1 && stateSnapshot.data()?.channels?.push === true) {
      disablePush(transaction, stateRef, now);
    }
    return true;
  });
}

export async function endPushSessionForOwner(
  database: Firestore,
  ownerId: string,
  verifiedAuthTimeSeconds: number,
  now = new Date(),
): Promise<void> {
  if (!validOwnerId(ownerId)) throw new InputValidationError('Reminder owner is invalid.');
  if (!validAuthTimeSeconds(verifiedAuthTimeSeconds)) throw new InputValidationError('Reminder auth time is required.');
  const owner = database.collection('users').doc(ownerId);
  const stateRef = owner.collection('reminderState').doc('current');
  const tokens = owner.collection('pushTokens').limit(21);
  const registry = database.collection('pushTokenOwners');
  const sessionCutoffRef = owner.collection('pushTokenSessionCutoffs').doc('session');
  return database.runTransaction(async transaction => {
    const [stateSnapshot, tokenSnapshot, sessionCutoffSnapshot] = await Promise.all([
      transaction.get(stateRef), transaction.get(tokens), transaction.get(sessionCutoffRef),
    ]);
    if (tokenSnapshot.size > 20) throw new InputValidationError('Push token limit reached.');
    const tokenRefs = tokenSnapshot.docs.map(token => token.ref);
    const registryRefs = tokenSnapshot.docs.map(token => registry.doc(token.id));
    const cutoffRefs = tokenSnapshot.docs.map(token => owner.collection('pushTokenSessionCutoffs').doc(token.id));
    const [registrySnapshots, cutoffSnapshots] = await Promise.all([
      Promise.all(registryRefs.map(ref => transaction.get(ref))),
      Promise.all(cutoffRefs.map(ref => transaction.get(ref))),
    ]);
    cutoffSnapshots.forEach(snapshot => {
      const authTimeSeconds = snapshot.data()?.authTimeSeconds;
      if (authTimeSeconds !== undefined && !validAuthTimeSeconds(authTimeSeconds)) {
        throw new InputValidationError('Push token cutoff is invalid.');
      }
    });
    const sessionCutoffAuthTime = sessionCutoffSnapshot.data()?.authTimeSeconds;
    if (sessionCutoffAuthTime !== undefined && !validAuthTimeSeconds(sessionCutoffAuthTime)) {
      throw new InputValidationError('Push token cutoff is invalid.');
    }
    transaction.set(sessionCutoffRef, {
      authTimeSeconds: Math.max(verifiedAuthTimeSeconds, sessionCutoffAuthTime ?? 0),
      updatedAt: Timestamp.fromDate(now),
    });
    cutoffRefs.forEach((ref, index) => transaction.set(ref, {
      authTimeSeconds: Math.max(verifiedAuthTimeSeconds, cutoffSnapshots[index].data()?.authTimeSeconds ?? 0),
      updatedAt: Timestamp.fromDate(now),
    }));
    tokenRefs.forEach(ref => transaction.delete(ref));
    registryRefs.forEach((ref, index) => {
      if (registrySnapshots[index].data()?.ownerId === ownerId) transaction.delete(ref);
    });
    if (stateSnapshot.exists && stateSnapshot.data()?.channels?.push === true) {
      disablePush(transaction, stateRef, now);
    }
  });
}
