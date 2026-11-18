import type { DocumentData, DocumentReference, DocumentSnapshot, Firestore, Query, QuerySnapshot, Transaction } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { endPushSessionForOwner, parseEndPushSessionRequest, parsePushTokenRequest, parseReminderSettingsRequest, reminderStateForSettings, revokePushTokenForOwner, updateReminderSettingsForOwner } from '../src/reminderSettingsPersistence.js';

const settings = () => ({
  days: [1, 3, 5], sendAtLocal: '08:00', timezone: 'Asia/Ho_Chi_Minh', locale: 'en',
  quietHours: { startLocal: '22:00', endLocal: '07:00' },
  onlyIfNotStudiedToday: true,
  channels: { push: true, emailDigest: true },
});

describe('reminder settings persistence', () => {
  it('rejects malformed settings before any persistence work', () => {
    expect(() => parseReminderSettingsRequest({ ...settings(), days: [] })).toThrow();
    expect(() => parseReminderSettingsRequest({ ...settings(), timezone: 'Invalid/Zone' })).toThrow();
    expect(() => parseReminderSettingsRequest({ ...settings(), channels: { push: 'yes', emailDigest: true } })).toThrow();
    expect(() => parseReminderSettingsRequest({ ...settings(), extra: true })).toThrow();
    expect(() => parseReminderSettingsRequest({ ...settings(), pushToken: 'short' })).toThrow();
    expect(() => parsePushTokenRequest({ token: 'a'.repeat(64), extra: true })).toThrow();
    expect(() => parsePushTokenRequest({ token: 'a'.repeat(64), endSession: 'yes' })).toThrow();
    expect(() => parseReminderSettingsRequest({ ...settings(), expectedOwnerId: 'other/owner' })).toThrow();
    expect(() => parsePushTokenRequest({ token: 'a'.repeat(64), expectedOwnerId: '' })).toThrow();
    expect(() => parseEndPushSessionRequest({ expectedOwnerId: 'other/owner' })).toThrow();
    expect(() => parseEndPushSessionRequest({})).toThrow();
    expect(parseReminderSettingsRequest({ ...settings(), expectedOwnerId: 'owner-a' }).expectedOwnerId).toBe('owner-a');
    expect(parsePushTokenRequest({ token: 'a'.repeat(64), expectedOwnerId: 'owner-a' })).toBe('a'.repeat(64));
    expect(parsePushTokenRequest({ token: 'a'.repeat(64), endSession: true })).toBe('a'.repeat(64));
    expect(parseEndPushSessionRequest({ expectedOwnerId: 'owner-a' })).toBe('owner-a');
  });

  it('schedules push on selected days and the digest on Sunday in local time', () => {
    const state = reminderStateForSettings(parseReminderSettingsRequest(settings()), new Date('2026-09-27T23:00:00Z'));
    expect(state.nextEligibleSendAt.toDate()).toEqual(new Date('2026-09-28T01:00:00Z'));
    expect(state.nextEligibleLocalDay).toBe('2026-09-28');
    expect(state.nextWeeklyDigestAt.toDate()).toEqual(new Date('2026-10-04T01:00:00Z'));
    expect(state.nextWeeklyDigestLocalDay).toBe('2026-10-04');
  });

  it('revokes both schedules and resets push backoff when channels turn off', () => {
    const input = parseReminderSettingsRequest({ ...settings(), channels: { push: false, emailDigest: false } });
    const state = reminderStateForSettings(input, new Date('2026-09-27T23:00:00Z'), {
      channels: { push: true }, consecutiveIgnored: 5,
    });
    expect(state).toMatchObject({
      nextEligibleSendAt: null, nextEligibleLocalDay: null,
      nextWeeklyDigestAt: null, nextWeeklyDigestLocalDay: null,
      consecutiveIgnored: 0,
    });
  });

  it('writes owner-scoped state and retains backoff while push stays enabled', async () => {
    const path = 'users/owner/reminderState/current';
    const pushToken = 'e'.repeat(64);
    const pushTokenId = createHash('sha256').update(pushToken).digest('hex');
    const reads: string[] = [];
    const writes: Array<{ path: string; data: DocumentData }> = [];
    const tokenPath = 'users/owner/pushTokens';
    const tokenQuery = {} as Query;
    const transaction = {
      get: vi.fn(async (ref: DocumentReference | Query) => {
        reads.push(ref === tokenQuery ? tokenPath : (ref as DocumentReference).path);
        if (ref === tokenQuery) return { size: 1, empty: false, docs: [{ ref: { path: 'users/owner/pushTokens/device' } }] } as QuerySnapshot;
        return { data: () => ({ channels: { push: true }, consecutiveIgnored: 3 }) } as unknown as DocumentSnapshot;
      }),
      set: vi.fn((ref: DocumentReference, data: DocumentData) => { writes.push({ path: ref.path, data }); }),
    } as unknown as Transaction;
    const doc = (documentPath: string) => ({
      path: documentPath,
      collection: (name: string) => ({
        doc: (id: string) => ({ path: `${documentPath}/${name}/${id}` }),
        limit: () => tokenQuery,
      }),
    });
    const database = {
      collection: (name: string) => ({ doc: (id: string) => doc(`${name}/${id}`) }),
      runTransaction: vi.fn(async (fn: (tx: Transaction) => Promise<unknown>) => fn(transaction)),
    } as unknown as Firestore;

    await updateReminderSettingsForOwner(database, 'owner', {
      ...parseReminderSettingsRequest(settings()), pushToken,
    }, new Date('2026-09-27T23:00:00Z'));

    expect(reads).toEqual([
      path, tokenPath,
      `pushTokenOwners/${pushTokenId}`,
      `users/owner/pushTokenSessionCutoffs/${pushTokenId}`,
      'users/owner/pushTokenSessionCutoffs/session',
    ]);
    expect(writes).toHaveLength(3);
    expect(writes[0]).toMatchObject({ path, data: { consecutiveIgnored: 3 } });
  });

  it('requires a fresh token to enable push and deletes registered tokens when revoked', async () => {
    const token = 'a'.repeat(64);
    const tokenId = createHash('sha256').update(token).digest('hex');
    const tokenRef = { path: `users/owner/pushTokens/${tokenId}` } as DocumentReference;
    const tokenQuery = {} as Query;
    let registered = true;
    let tokenCount = 1;
    const writes: string[] = [];
    const transaction = {
      get: vi.fn(async (ref: DocumentReference | Query) => ref === tokenQuery
        ? { size: tokenCount, empty: tokenCount === 0,
          docs: Array.from({ length: tokenCount }, (_, index) => ({
            id: registered && index === 0 ? tokenId : `existing-${index}`,
            ref: tokenRef, data: () => ({ token }),
          })) } as unknown as QuerySnapshot
        : { data: () => undefined } as unknown as DocumentSnapshot),
      set: vi.fn((ref: DocumentReference) => { writes.push(`set:${ref.path}`); }),
      delete: vi.fn((ref: DocumentReference) => { writes.push(`delete:${ref.path}`); }),
    } as unknown as Transaction;
    const ownerRegistryRef = { path: `pushTokenOwners/${tokenId}` } as DocumentReference;
    const database = {
      collection: (name: string) => name === 'pushTokenOwners'
        ? { doc: () => ownerRegistryRef }
        : { doc: () => ({ collection: (child: string) => ({
          doc: (id: string) => child === 'pushTokens' ? tokenRef : { path: `users/owner/${child}/${id}` },
          limit: () => tokenQuery,
        }) }) },
      runTransaction: vi.fn(async (fn: (tx: Transaction) => Promise<unknown>) => fn(transaction)),
    } as unknown as Firestore;
    const enabled = parseReminderSettingsRequest(settings());

    await expect(updateReminderSettingsForOwner(database, 'owner', enabled)).rejects.toThrow('A push token is required.');
    expect(writes).toEqual([]);
    expect(database.runTransaction).not.toHaveBeenCalled();
    await updateReminderSettingsForOwner(database, 'owner', { ...enabled, pushToken: token });
    expect(writes).toContain(`set:${tokenRef.path}`);
    expect(writes).toContain(`set:${ownerRegistryRef.path}`);

    writes.length = 0;
    registered = false;
    tokenCount = 20;
    await expect(updateReminderSettingsForOwner(database, 'owner', { ...enabled, pushToken: token })).rejects.toThrow('Push token limit reached.');
    expect(writes).toEqual([]);

    registered = true;
    tokenCount = 1;
    writes.length = 0;
    await updateReminderSettingsForOwner(database, 'owner', {
      ...enabled, channels: { push: false, emailDigest: true },
    });
    expect(writes).toContain(`delete:${tokenRef.path}`);
  });

  it('removes the old account token and disables push only when it was the last one', async () => {
    const token = 'b'.repeat(64);
    const tokenRef = { path: `users/owner/pushTokens/${createHash('sha256').update(token).digest('hex')}` } as DocumentReference;
    const stateRef = { path: 'users/owner/reminderState/current' } as DocumentReference;
    const tokenQuery = {} as Query;
    let count = 1;
    const deleted: string[] = [];
    const updates: DocumentData[] = [];
    const transaction = {
      get: vi.fn(async (ref: DocumentReference | Query) => ref === tokenQuery
        ? { size: count } as unknown as QuerySnapshot
        : (ref as DocumentReference).path === stateRef.path
          ? { data: () => ({ channels: { push: true } }) } as unknown as DocumentSnapshot
          : { exists: true, data: () => ({ ownerId: 'owner' }) } as unknown as DocumentSnapshot),
      delete: vi.fn((ref: DocumentReference) => { deleted.push(ref.path); }),
      update: vi.fn((_ref: DocumentReference, data: DocumentData) => { updates.push(data); }),
    } as unknown as Transaction;
    const ownerRegistryRef = { path: `pushTokenOwners/${createHash('sha256').update(token).digest('hex')}` } as DocumentReference;
    const database = {
      collection: (name: string) => name === 'pushTokenOwners'
        ? { doc: () => ownerRegistryRef }
        : { doc: () => ({ collection: (child: string) => ({
          doc: () => child === 'pushTokens' ? tokenRef : stateRef,
          limit: () => tokenQuery,
        }) }) },
      runTransaction: vi.fn(async (fn: (tx: Transaction) => Promise<unknown>) => fn(transaction)),
    } as unknown as Firestore;

    await expect(revokePushTokenForOwner(database, 'owner', token)).resolves.toBe(true);
    expect(deleted).toEqual([tokenRef.path, ownerRegistryRef.path]);
    expect(updates).toEqual([expect.objectContaining({ 'channels.push': false, nextEligibleSendAt: null })]);

    count = 2;
    updates.length = 0;
    await revokePushTokenForOwner(database, 'owner', token);
    expect(updates).toEqual([]);
  });

  it('transfers a token after every required read, removing the previous owner token and disabling their last push channel', async () => {
    const token = 'c'.repeat(64);
    const tokenId = createHash('sha256').update(token).digest('hex');
    const data = new Map<string, DocumentData>([
      ['users/owner-a/reminderState/current', { channels: { push: true } }],
      [`users/owner-a/pushTokens/${tokenId}`, { token }],
      ['users/owner-b/reminderState/current', { channels: { push: false } }],
      [`pushTokenOwners/${tokenId}`, { ownerId: 'owner-a', bindingId: 'owner-a-binding', registeredAuthTime: 100 }],
    ]);
    const reads: string[] = [];
    const writes: string[] = [];
    const operations: string[] = [];
    const ref = (path: string): DocumentReference => ({
      path,
      collection: (name: string) => ({
        doc: (id: string) => ref(`${path}/${name}/${id}`),
        limit: () => ({ kind: 'query', ownerPath: `${path}/${name}` }),
      }),
    }) as unknown as DocumentReference;
    const database = {
      collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
      runTransaction: vi.fn(async (fn: (tx: Transaction) => Promise<unknown>) => fn({
        get: async (value: DocumentReference | { ownerPath: string }) => {
          const path = 'ownerPath' in value ? value.ownerPath : value.path;
          reads.push(path);
          operations.push(`read:${path}`);
          if ('ownerPath' in value && typeof value.ownerPath === 'string') {
            const docs = [...data.entries()]
              .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
              .map(([key, value]) => ({ id: key.slice(path.length + 1), ref: ref(key), data: () => value }));
            return { size: docs.length, empty: docs.length === 0, docs } as unknown as QuerySnapshot;
          }
          return { exists: data.has(path), data: () => data.get(path) } as unknown as DocumentSnapshot;
        },
        set: (value: DocumentReference, patch: DocumentData) => {
          data.set(value.path, patch); writes.push(`set:${value.path}`); operations.push(`write:${value.path}`);
        },
        update: (value: DocumentReference, patch: DocumentData) => {
          data.set(value.path, { ...data.get(value.path), ...patch });
          writes.push(`update:${value.path}`); operations.push(`write:${value.path}`);
        },
        delete: (value: DocumentReference) => {
          data.delete(value.path); writes.push(`delete:${value.path}`); operations.push(`write:${value.path}`);
        },
      } as unknown as Transaction)),
    } as unknown as Firestore;

    const transferClock = vi.spyOn(Date, 'now').mockReturnValue(300_000);
    try {
      await updateReminderSettingsForOwner(database, 'owner-b', {
        ...parseReminderSettingsRequest(settings()), pushToken: token,
      }, new Date(), 200);
    } finally { transferClock.mockRestore(); }

    expect(writes).toEqual(expect.arrayContaining([
      `set:users/owner-b/pushTokens/${tokenId}`,
      `set:pushTokenOwners/${tokenId}`,
      `delete:users/owner-a/pushTokens/${tokenId}`,
      'update:users/owner-a/reminderState/current',
      `set:users/owner-a/pushTokenSessionCutoffs/${tokenId}`,
    ]));
    expect(reads).toEqual(expect.arrayContaining([
      'users/owner-a/pushTokens', 'users/owner-a/reminderState/current', `pushTokenOwners/${tokenId}`,
    ]));
    expect(reads).toHaveLength(9);
    expect(Math.max(...operations.map((operation, index) => operation.startsWith('read:') ? index : -1)))
      .toBeLessThan(Math.min(...operations.map((operation, index) => operation.startsWith('write:') ? index : Infinity)));
    expect(data.get(`users/owner-a/pushTokenSessionCutoffs/${tokenId}`)).toMatchObject({ authTimeSeconds: 300 });
    await expect(updateReminderSettingsForOwner(database, 'owner-a', {
      ...parseReminderSettingsRequest(settings()), pushToken: token,
    }, new Date(), 200)).rejects.toThrow('Push token session has ended.');
  });

  it('writes an end-session cutoff without a local token and rejects the ended session from registering again', async () => {
    const token = 'd'.repeat(64);
    const tokenId = createHash('sha256').update(token).digest('hex');
    const data = new Map<string, DocumentData>();
    const ref = (path: string): DocumentReference => ({
      path,
      collection: (name: string) => ({
        doc: (id: string) => ref(`${path}/${name}/${id}`),
        limit: () => ({ ownerPath: `${path}/${name}` }),
      }),
    }) as unknown as DocumentReference;
    const database = {
      collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
      runTransaction: vi.fn(async (fn: (tx: Transaction) => Promise<unknown>) => fn({
        get: async (value: DocumentReference | { kind: 'query'; ownerPath: string }) => {
          const ownerPath = (value as { ownerPath?: unknown }).ownerPath;
          if (typeof ownerPath === 'string') {
            const docs = [...data.entries()].filter(([path]) => path.startsWith(`${ownerPath}/`)
              && !path.slice(ownerPath.length + 1).includes('/'))
              .map(([path, value]) => ({ id: path.slice(ownerPath.length + 1), ref: ref(path), data: () => value }));
            return { size: docs.length, empty: docs.length === 0, docs } as unknown as QuerySnapshot;
          }
          if (!('path' in value)) throw new Error('Document reference expected.');
          return { exists: data.has(value.path), data: () => data.get(value.path) } as unknown as DocumentSnapshot;
        },
        set: (value: DocumentReference, patch: DocumentData) => data.set(value.path, patch),
        update: (value: DocumentReference, patch: DocumentData) => data.set(value.path, { ...data.get(value.path), ...patch }),
        delete: (value: DocumentReference) => data.delete(value.path),
      } as unknown as Transaction)),
    } as unknown as Firestore;

    await expect(revokePushTokenForOwner(database, 'owner', token, new Date(), true, 200)).resolves.toBe(false);
    expect(data.get(`users/owner/pushTokenSessionCutoffs/${tokenId}`)).toMatchObject({ authTimeSeconds: 200 });
    await expect(updateReminderSettingsForOwner(database, 'owner', {
      ...parseReminderSettingsRequest(settings()), pushToken: token,
    }, new Date(), 200)).rejects.toThrow('Push token session has ended.');
    await expect(updateReminderSettingsForOwner(database, 'owner', {
      ...parseReminderSettingsRequest(settings()), pushToken: token,
    }, new Date(), 201)).resolves.toMatchObject({ channels: { push: true } });
    const bindingId = data.get(`pushTokenOwners/${tokenId}`)?.bindingId;
    await updateReminderSettingsForOwner(database, 'owner', {
      ...parseReminderSettingsRequest(settings()), pushToken: token,
    }, new Date(), 202);
    expect(data.get(`pushTokenOwners/${tokenId}`)).toMatchObject({ bindingId, registeredAuthTime: 202 });
  });

  it('ends every server token when the browser lost its local token and rejects re-registration from that session', async () => {
    const tokenA = 'e'.repeat(64);
    const tokenB = 'f'.repeat(64);
    const tokenAId = createHash('sha256').update(tokenA).digest('hex');
    const tokenBId = createHash('sha256').update(tokenB).digest('hex');
    const data = new Map<string, DocumentData>([
      ['users/owner/reminderState/current', { channels: { push: true } }],
      [`users/owner/pushTokens/${tokenAId}`, { token: tokenA }],
      [`users/owner/pushTokens/${tokenBId}`, { token: tokenB }],
      [`pushTokenOwners/${tokenAId}`, { ownerId: 'owner' }],
      [`pushTokenOwners/${tokenBId}`, { ownerId: 'new-owner' }],
    ]);
    const operations: string[] = [];
    let tokenQueryLimit: number | undefined;
    const ref = (path: string): DocumentReference => ({
      path,
      collection: (name: string) => ({
        doc: (id: string) => ref(`${path}/${name}/${id}`),
        limit: (limit: number) => { tokenQueryLimit = limit; return { ownerPath: `${path}/${name}`, limit }; },
      }),
    }) as unknown as DocumentReference;
    const database = {
      collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
      runTransaction: vi.fn(async (fn: (tx: Transaction) => Promise<unknown>) => fn({
        get: async (value: DocumentReference | { ownerPath: string; limit: number }) => {
          const path = 'ownerPath' in value ? value.ownerPath : value.path;
          operations.push(`read:${path}`);
          if ('ownerPath' in value) {
            const docs = [...data.entries()].filter(([key]) => key.startsWith(`${path}/`)
              && !key.slice(path.length + 1).includes('/')).map(([key, entry]) => ({
              id: key.slice(path.length + 1), ref: ref(key), data: () => entry,
            })).slice(0, value.limit);
            return { size: docs.length, docs } as unknown as QuerySnapshot;
          }
          return { exists: data.has(path), data: () => data.get(path) } as unknown as DocumentSnapshot;
        },
        set: (value: DocumentReference, patch: DocumentData) => {
          operations.push(`write:${value.path}`); data.set(value.path, patch);
        },
        update: (value: DocumentReference, patch: DocumentData) => {
          operations.push(`write:${value.path}`); data.set(value.path, { ...data.get(value.path), ...patch });
        },
        delete: (value: DocumentReference) => { operations.push(`write:${value.path}`); data.delete(value.path); },
      } as unknown as Transaction)),
    } as unknown as Firestore;

    await expect(endPushSessionForOwner(database, 'owner', 100, new Date())).resolves.toBeUndefined();
    expect(tokenQueryLimit).toBe(21);
    expect(data.get(`users/owner/pushTokenSessionCutoffs/${tokenAId}`)).toMatchObject({ authTimeSeconds: 100 });
    expect(data.get(`users/owner/pushTokenSessionCutoffs/${tokenBId}`)).toMatchObject({ authTimeSeconds: 100 });
    expect(data.get('users/owner/pushTokenSessionCutoffs/session')).toMatchObject({ authTimeSeconds: 100 });
    expect(data.has(`users/owner/pushTokens/${tokenAId}`)).toBe(false);
    expect(data.has(`users/owner/pushTokens/${tokenBId}`)).toBe(false);
    expect(data.has(`pushTokenOwners/${tokenAId}`)).toBe(false);
    expect(data.get(`pushTokenOwners/${tokenBId}`)).toMatchObject({ ownerId: 'new-owner' });
    expect(data.get('users/owner/reminderState/current')).toMatchObject({ 'channels.push': false, nextEligibleSendAt: null });
    expect(Math.max(...operations.map((operation, index) => operation.startsWith('read:') ? index : -1)))
      .toBeLessThan(Math.min(...operations.map((operation, index) => operation.startsWith('write:') ? index : Infinity)));
    await expect(updateReminderSettingsForOwner(database, 'owner', {
      ...parseReminderSettingsRequest(settings()), pushToken: tokenA,
    }, new Date(), 100)).rejects.toThrow('Push token session has ended.');
    await expect(endPushSessionForOwner(database, 'owner', 99, new Date())).resolves.toBeUndefined();
    expect(data.get('users/owner/pushTokenSessionCutoffs/session')).toMatchObject({ authTimeSeconds: 100 });

    const unseenToken = 'g'.repeat(64);
    await expect(updateReminderSettingsForOwner(database, 'owner', {
      ...parseReminderSettingsRequest(settings()), pushToken: unseenToken,
    }, new Date(), 100)).rejects.toThrow('Push token session has ended.');
    await expect(updateReminderSettingsForOwner(database, 'owner', {
      ...parseReminderSettingsRequest(settings()), pushToken: unseenToken,
    }, new Date(), 101)).resolves.toMatchObject({ channels: { push: true } });

    for (let index = 0; index < 21; index += 1) {
      data.set(`users/owner/pushTokens/overflow-${index}`, { token: `overflow-${index}` });
    }
    const writesBeforeOverflow = operations.filter(operation => operation.startsWith('write:')).length;
    await expect(endPushSessionForOwner(database, 'owner', 100, new Date()))
      .rejects.toThrow('Push token limit reached.');
    expect(operations.filter(operation => operation.startsWith('write:'))).toHaveLength(writesBeforeOverflow);
  });
});
