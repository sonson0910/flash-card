import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';

it('does not resurrect an acknowledged operation when a concurrent cloud page reads pending operations', async () => {
  vi.stubEnv('DEV', false);
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key,value), removeItem: (key: string) => values.delete(key) });
  const { queueDevicePatches, loadDevicePending, acknowledgeDevicePending } = await import('./deviceSync');
  const { loadStoredPendingOperations, closePendingOperationStoreForTests } = await import('./pendingOperationStore');
  const card = { id: 'race-card', word: 'race', normalizedWord: 'race', translation: 'đua', explanation: '', phonetic: '', emoji: '', category: 'Test', audioUrl: null, imageUrl: null, revision: 1, libraryEpoch: 1, bookmarked: false };
  const queued = await queueDevicePatches([{card,fields:{bookmarked:true}}], 1, 'audit-race-owner', 'race-op');
  expect(await loadStoredPendingOperations('audit-race-owner')).toHaveLength(1);
  const cloudPageRead = loadDevicePending('audit-race-owner');
  const successfulWriteAck = acknowledgeDevicePending(queued);
  await Promise.all([cloudPageRead, successfulWriteAck]);
  const durable = await loadStoredPendingOperations('audit-race-owner');
  closePendingOperationStoreForTests();
  expect(durable, 'ACK completed, no new edit was submitted').toHaveLength(0);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });


it('does not mark unreadable legacy storage migrated or lose its pending operation', async () => {
  vi.stubEnv('DEV', false);
  const owner = 'migration-read-failure-owner';
  const legacy = [{ type: 'delete', cardId: 'legacy-card', opId: 'legacy-delete', ownerUserId: owner, updatedAt: '2026-09-01T00:00:00.000Z' }];
  const values = new Map([[`lingoflash_pending_writes_${owner}`, JSON.stringify(legacy)]]);
  let blocked = true;
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => { if (blocked) throw new Error('storage blocked'); return values.get(key) ?? null; },
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  const { loadDevicePending } = await import('./deviceSync');
  await expect(loadDevicePending(owner)).rejects.toThrow(/storage/i);
  blocked = false;
  expect(await loadDevicePending(owner)).toMatchObject(legacy);
});


it('does not durably reimport a development backup snapshot captured before ACK', async () => {
  vi.resetModules();
  vi.stubEnv('DEV', true);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  let releaseRead!: () => void;
  let captured!: () => void;
  const capturedRead = new Promise<void>(resolve => { captured = resolve; });
  const barrier = new Promise<void>(resolve => { releaseRead = resolve; });
  let snapshot: unknown = null;
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    if (init?.cache === 'no-store') { captured(); await barrier; return new Response(JSON.stringify(snapshot)); }
    return new Response('{}');
  }));
  const { queueDeviceDeletes, loadDevicePending, acknowledgeDevicePending } = await import('./deviceSync');
  const { loadStoredPendingOperations } = await import('./pendingOperationStore');
  const owner = 'dev-ack-race-owner';
  const operations = await queueDeviceDeletes(['dev-card'], owner);
  snapshot = { ownerUserId: owner, cards: [], total: 0, pending: operations };
  const reading = loadDevicePending(owner);
  await capturedRead;
  await acknowledgeDevicePending(operations);
  releaseRead();
  await reading;
  expect(await loadStoredPendingOperations(owner)).toHaveLength(0);
});
