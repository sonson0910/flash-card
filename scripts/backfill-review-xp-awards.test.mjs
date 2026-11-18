import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  APPLY_CONFIRMATION,
  SEALED_DATABASE_ID,
  SEALED_PROJECT_ID,
  SEALED_STAGING_PROJECT_ID,
  parseArgs,
  reviewXpAwardId,
  runBackfill,
  validateReceipt,
} from './backfill-review-xp-awards.mjs';

const timestamp = () => new Date('2026-10-01T00:00:00.000Z');
const hash = value => createHash('sha256').update(value).digest('hex');
const receipt = ({ ownerId = 'owner', cardId = 'card-1', day = '2026-09-30', opId = 'op-1', xp = 2 } = {}) => ({
  ownerId, cardId, opId, fingerprint: hash('request'), createdAt: timestamp(), expiresAt: new Date('2026-10-31T00:00:00.000Z'),
  result: { applied: true, duplicate: false, ...(xp === undefined ? {} : { xpAwarded: xp }), ...(xp !== 0 ? { gamification: { studyDay: day } } : {}) },
});
const doc = (id, data) => ({ ref: { path: `users/owner/review_receipts/${id}` }, data: () => data });

function fakeDatabase(receipts, existing = new Map(), deletingOwners = new Set()) {
  const writes = [];
  const refs = new Map();
  const reference = path => refs.get(path) ?? (() => {
    const ref = { path, get: async () => ({ exists: existing.has(path), data: () => existing.get(path) }) };
    refs.set(path, ref);
    return ref;
  })();
  return {
    projectId: SEALED_PROJECT_ID,
    databaseId: SEALED_DATABASE_ID,
    writes,
    collectionGroup: () => ({
      orderBy: () => ({
        limit: size => ({
          startAfter: cursor => ({ get: async () => ({ docs: receipts.slice(receipts.indexOf(cursor) + 1, receipts.indexOf(cursor) + 1 + size), empty: receipts.indexOf(cursor) + 1 >= receipts.length }) }),
          get: async () => ({ docs: receipts.slice(0, size), empty: receipts.length === 0 }),
        }),
      }),
    }),
    collection: path => {
      if (path !== 'account_tombstones') throw new Error(`Unexpected collection: ${path}`);
      return { where: (field, operator, ownerId) => {
        if (field !== 'uid' || operator !== '==') throw new Error('Unexpected tombstone query');
        return { limit: () => ({ tombstoneOwnerId: ownerId }) };
      } };
    },
    doc: reference,
    runTransaction: async callback => callback({
      get: ref => {
        if (ref.tombstoneOwnerId) return Promise.resolve({ empty: !deletingOwners.has(ref.tombstoneOwnerId) });
        if (ref.path.includes('/review_receipts/')) {
          const current = receipts.find(row => row.ref.path === ref.path);
          return Promise.resolve(current ? { ...current, exists: true } : { ref, exists: false });
        }
        return ref.get();
      },
      create: (ref, data) => { existing.set(ref.path, data); writes.push({ path: ref.path, data }); },
    }),
  };
}

const options = (overrides = {}) => ({
  project: SEALED_PROJECT_ID, database: SEALED_DATABASE_ID, apply: false, confirm: '', pageSize: 1,
  coverageStart: '2026-09-30', coverageEnd: '2026-09-30', ...overrides,
});

describe('review XP award backfill', () => {
  it('requires an explicit sealed target and apply confirmation', () => {
    expect(() => parseArgs([])).toThrow('--project and --database are required');
    expect(() => parseArgs(['--project', 'other', '--database', SEALED_DATABASE_ID])).toThrow('sealed Functions target');
    expect(() => parseArgs(['--project', SEALED_PROJECT_ID, '--database', SEALED_DATABASE_ID, '--apply'])).toThrow('requires --confirm');
    expect(() => parseArgs(['--project', SEALED_PROJECT_ID, '--database', SEALED_DATABASE_ID, '--apply', '--confirm', APPLY_CONFIRMATION])).toThrow('requires an explicit coverage range');
    expect(parseArgs(['--project', SEALED_PROJECT_ID, '--database', SEALED_DATABASE_ID, '--coverage-start', '2026-09-30', '--coverage-end', '2026-09-30', '--apply', '--confirm', APPLY_CONFIRMATION])).toMatchObject({ apply: true });
    expect(parseArgs(['--project', SEALED_STAGING_PROJECT_ID, '--database', SEALED_DATABASE_ID])).toMatchObject({ project: SEALED_STAGING_PROJECT_ID });
  });

  it('accepts only strict XP evidence and hashes the award identity compatibly', () => {
    expect(reviewXpAwardId('card-1', '2026-09-30')).toBe(hash('card-1\u00002026-09-30'));
    expect(validateReceipt(doc('one', receipt()))).toMatchObject({ state: 'eligible', studyDay: '2026-09-30' });
    expect(validateReceipt(doc('old', receipt({ xp: undefined })))).toMatchObject({ state: 'eligible' });
    expect(validateReceipt(doc('zero', receipt({ xp: 0 })))).toEqual({ state: 'ignored' });
    expect(validateReceipt(doc('cached', { ...receipt({ xp: undefined }), result: { applied: true, duplicate: false } }))).toEqual({ state: 'ignored' });
    expect(validateReceipt(doc('broken-game', { ...receipt({ xp: undefined }), result: { applied: true, duplicate: false, gamification: {} } }))).toEqual({ state: 'malformed' });
    expect(validateReceipt({ ref: { path: 'users/firebase.uid@example/review_receipts/one' }, data: () => receipt({ ownerId: 'firebase.uid@example' }) })).toMatchObject({ state: 'eligible' });
    expect(validateReceipt(doc('bad', receipt({ xp: 2, day: 'not-a-day' })))).toEqual({ state: 'malformed' });
    expect(validateReceipt(doc('bad-time', { ...receipt(), createdAt: new Date('invalid') }))).toEqual({ state: 'malformed' });
    expect(validateReceipt(doc('legacy', { result: {} }))).toEqual({ state: 'ignored' });
  });

  it('deduplicates card/day evidence during dry runs without writes', async () => {
    const database = fakeDatabase([doc('one', receipt()), doc('two', receipt({ opId: 'op-2' }))]);
    const report = await runBackfill(database, options());
    expect(report).toMatchObject({ scanned: 2, eligible: 2, uniqueEligible: 1, duplicateReceipts: 1, preflightMissing: 1, created: 0, blocked: false, coverage: { coverageUnproven: true } });
    expect(database.writes).toEqual([]);
  });

  it('creates a missing award on apply and makes the retry idempotent', async () => {
    const database = fakeDatabase([doc('one', receipt())]);
    const first = await runBackfill(database, options({ apply: true, confirm: APPLY_CONFIRMATION }));
    const second = await runBackfill(database, options({ apply: true, confirm: APPLY_CONFIRMATION }));
    expect(first).toMatchObject({ preflightMissing: 1, created: 1, conflicts: 0 });
    expect(second).toMatchObject({ preflightMissing: 0, created: 0, existing: 1, conflicts: 0 });
    expect(database.writes).toHaveLength(1);
  });

  it('blocks applies on an award collision or unproved coverage', async () => {
    const candidate = receipt();
    const path = `users/owner/review_xp_awards/${reviewXpAwardId('card-1', '2026-09-30')}`;
    const database = fakeDatabase([doc('one', candidate)], new Map([[path, { schemaVersion: 1, ownerId: 'owner', cardId: 'other-card', studyDay: '2026-09-30', xpAwarded: 2, expiresAt: timestamp() }]]));
    const collision = await runBackfill(database, options({ apply: true, confirm: APPLY_CONFIRMATION }));
    const noCoverage = await runBackfill(fakeDatabase([doc('one', candidate)]), options({ coverageStart: '', coverageEnd: '' }));
    expect(collision).toMatchObject({ blocked: true, conflicts: 1, created: 0 });
    expect(noCoverage).toMatchObject({ blocked: true, created: 0 });
  });

  it('enforces target and confirmation on direct mutator calls', async () => {
    const database = fakeDatabase([doc('one', receipt())]);
    await expect(runBackfill(database, options({ apply: true, confirm: '' }))).rejects.toThrow('requires --confirm');
    await expect(runBackfill(database, options({ apply: true, confirm: APPLY_CONFIRMATION, project: 'other' }))).rejects.toThrow('sealed Functions target');
    database.projectId = SEALED_STAGING_PROJECT_ID;
    await expect(runBackfill(database, options({ apply: true, confirm: APPLY_CONFIRMATION }))).rejects.toThrow('Firestore instance does not match');
    database.projectId = SEALED_PROJECT_ID;
    database.databaseId = '(default)';
    await expect(runBackfill(database, options({ apply: true, confirm: APPLY_CONFIRMATION }))).rejects.toThrow('Firestore instance does not match');
    expect(database.writes).toEqual([]);
  });

  it('reports an apply-time collision as blocked and rejects an invalid existing award time', async () => {
    const path = `users/owner/review_xp_awards/${reviewXpAwardId('card-1', '2026-09-30')}`;
    const invalid = { schemaVersion: 1, ownerId: 'owner', cardId: 'card-1', studyDay: '2026-09-30', xpAwarded: 2 };
    const preflight = await runBackfill(fakeDatabase([doc('one', receipt())], new Map([[path, invalid]])), options());
    expect(preflight).toMatchObject({ blocked: true, conflicts: 1 });

    const concurrent = new Map();
    const database = fakeDatabase([doc('one', receipt())], concurrent);
    const originalTransaction = database.runTransaction;
    database.runTransaction = callback => {
      concurrent.set(path, { ...invalid, cardId: 'different-card', expiresAt: timestamp() });
      return originalTransaction(callback);
    };
    const report = await runBackfill(database, options({ apply: true, confirm: APPLY_CONFIRMATION }));
    expect(report).toMatchObject({ blocked: true, conflicts: 1, created: 0 });
    expect(database.writes).toEqual([]);
  });

  it('does not recreate an award when its receipt disappears or account deletion begins after the scan', async () => {
    const receipts = [doc('one', receipt())];
    const deletedReceipt = fakeDatabase(receipts);
    const originalTransaction = deletedReceipt.runTransaction;
    deletedReceipt.runTransaction = callback => {
      receipts.splice(0);
      return originalTransaction(callback);
    };
    const afterPurge = await runBackfill(deletedReceipt, options({ apply: true, confirm: APPLY_CONFIRMATION }));
    expect(afterPurge).toMatchObject({ created: 0, conflicts: 1, blocked: true });
    expect(deletedReceipt.writes).toEqual([]);

    const deleting = fakeDatabase([doc('one', receipt())], new Map(), new Set(['owner']));
    const duringPurge = await runBackfill(deleting, options({ apply: true, confirm: APPLY_CONFIRMATION }));
    expect(duringPurge).toMatchObject({ created: 0, conflicts: 1, blocked: true });
    expect(deleting.writes).toEqual([]);
  });
});
