import { readFileSync } from 'node:fs';
import type {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Query,
  Transaction,
} from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import {
  buildSharedDeckDocuments,
  createSharedDeckAtomically,
  MAX_SHARED_DECK_BYTES,
  MAX_SHARED_DECKS,
  revokeSharedDeckAtomically,
  SharedDeckMigrationRequiredError,
  SharedDeckOwnershipError,
  SharedDeckQuotaError,
  SharedDeckUsageStateError,
} from '../src/sharedDeckPersistence.js';
import { calculateSharedDeckPayloadBytes } from '../src/inputValidation.js';
import { toSharedDeckHttpsError } from '../src/index.js';

const time = (millis: number) => ({ toMillis: () => millis });
const reference = (path: string): DocumentReference => ({
  path,
  id: path.split('/').at(-1),
} as DocumentReference);
const snapshot = (exists: boolean, data?: DocumentData): DocumentSnapshot => ({
  exists,
  data: () => data,
} as DocumentSnapshot);
const query = (hasDocuments: boolean): Query => ({
  __sharedDeckOwnerQuery: true,
  empty: !hasDocuments,
} as unknown as Query);

const transactionHarness = (
  snapshots: ReadonlyMap<string, DocumentSnapshot>,
  ownerQueryResult = snapshot(false),
) => {
  const writes: Array<{ method: string; path: string; data?: DocumentData }> = [];
  const deletes: string[] = [];
  const transaction = {
    get: vi.fn(async (document: DocumentReference | Query) => {
      if ('__sharedDeckOwnerQuery' in (document as object)) return ownerQueryResult;
      return snapshots.get((document as DocumentReference).path) ?? snapshot(false);
    }),
    create: vi.fn((document: DocumentReference, data: DocumentData) => {
      writes.push({ method: 'create', path: document.path, data });
      return transaction;
    }),
    set: vi.fn((document: DocumentReference, data: DocumentData) => {
      writes.push({ method: 'set', path: document.path, data });
      return transaction;
    }),
    delete: vi.fn((document: DocumentReference) => {
      deletes.push(document.path);
      return transaction;
    }),
  } as unknown as Transaction;
  const database = {
    collection: (name: string) => ({
      doc: (ownerId: string) => ({
        path: `${name}/${ownerId}`,
        id: ownerId,
        collection: (subcollection: string) => ({
          doc: (documentId: string) => reference(`${name}/${ownerId}/${subcollection}/${documentId}`),
        }),
      }),
      where: () => ({ limit: () => query(ownerQueryResult.exists) }),
    }),
    runTransaction: vi.fn(async (update: (value: Transaction) => Promise<unknown>) => update(transaction)),
  } as unknown as Firestore;
  return { database, deletes, transaction, writes };
};

const deckInput = (category = 'Basics') => ({
  category,
  cards: [{
    word: 'hello',
    translation: 'xin chào',
    explanation: '',
    explanationTranslation: '',
    phonetic: '',
    category: '',
    partOfSpeech: '',
    cefrLevel: '',
    exampleSentence: '',
    exampleTranslation: '',
    collocations: [],
    synonyms: [],
    antonyms: [],
    register: '',
    commonMistake: '',
    imageSearchQuery: '',
    emoji: '',
    audioUrl: null,
    imageUrl: null,
  }],
});

const sharedDeck = reference('shared_decks/share-1');
const ownership = reference('shared_deck_owners/share-1');
const usageDocument = reference('users/owner/profile/shared_deck_usage');
const migrationStateDocument = reference('admin_shared_deck_migration_jobs/shared_deck_v2');
const options = { now: time(100), usageDocument, ownerMetadataQuery: query(false) };

describe('shared-deck persistence', () => {
  it('uses the exact normalized UTF-8 payload size and private schema 2 metadata', () => {
    const input = deckInput();
    const documents = buildSharedDeckDocuments(input, 'owner-uid', time(0), time(1_000));

    expect(documents.sharedDeck).not.toHaveProperty('authorUid');
    expect(documents.sharedDeck).not.toHaveProperty('ownerUid');
    expect(documents.ownership).toMatchObject({
      ownerUid: 'owner-uid',
      payloadBytes: calculateSharedDeckPayloadBytes(input),
      schemaVersion: 2,
    });
    expect((documents.ownership.createdAt as ReturnType<typeof time>).toMillis()).toBe(0);
    expect((documents.ownership.expiresAt as ReturnType<typeof time>).toMillis()).toBe(1_000);
  });

  it('initializes a missing usage document for a new owner atomically', async () => {
    const harness = transactionHarness(new Map());
    const documents = buildSharedDeckDocuments(deckInput(), 'owner', time(0), time(1_000));

    await createSharedDeckAtomically(harness.database, sharedDeck, ownership, documents, options);

    expect(harness.writes).toEqual(expect.arrayContaining([
      { method: 'create', path: sharedDeck.path, data: documents.sharedDeck },
      { method: 'create', path: ownership.path, data: documents.ownership },
      expect.objectContaining({
        method: 'create',
        path: usageDocument.path,
        data: expect.objectContaining({ schemaVersion: 1, activeCount: 1 }),
      }),
    ]));
  });

  it('requires protected migration when usage is missing for an existing owner', async () => {
    const harness = transactionHarness(new Map(), snapshot(true));
    const documents = buildSharedDeckDocuments(deckInput(), 'owner', time(0), time(1_000));

    await expect(createSharedDeckAtomically(
      harness.database,
      sharedDeck,
      ownership,
      documents,
      { ...options, ownerMetadataQuery: query(true) },
    )).rejects.toBeInstanceOf(SharedDeckMigrationRequiredError);
    expect(harness.writes).toEqual([]);
  });

  it('fails closed for create and revoke while the shared-deck migration is frozen', async () => {
    const documents = buildSharedDeckDocuments(deckInput(), 'owner', time(0), time(1_000));
    const frozen = snapshot(true, {
      schemaVersion: 2,
      ownerUid: 'owner',
      phase: 'frozen',
      revision: 'a'.repeat(40),
      inventoryDigest: 'b'.repeat(64),
      ledgerReady: false,
    });
    const createHarness = transactionHarness(new Map([[migrationStateDocument.path, frozen]]));
    await expect(createSharedDeckAtomically(
      createHarness.database,
      sharedDeck,
      ownership,
      documents,
      { ...options, migrationStateDocument },
    )).rejects.toBeInstanceOf(SharedDeckMigrationRequiredError);
    expect(createHarness.writes).toEqual([]);

    const revokeHarness = transactionHarness(new Map([
      [migrationStateDocument.path, frozen],
      [sharedDeck.path, snapshot(true, documents.sharedDeck)],
      [ownership.path, snapshot(true, documents.ownership)],
    ]));
    await expect(revokeSharedDeckAtomically(
      revokeHarness.database,
      sharedDeck,
      ownership,
      'owner',
      { ...options, migrationStateDocument },
    )).rejects.toBeInstanceOf(SharedDeckMigrationRequiredError);
    expect(revokeHarness.deletes).toEqual([]);
  });

  it('uses one global fence so another owner is blocked during owner migration', async () => {
    const otherDocuments = buildSharedDeckDocuments(deckInput('Other'), 'other-owner', time(0), time(1_000));
    const globalFence = snapshot(true, {
      schemaVersion: 2,
      ownerUid: 'owner',
      phase: 'frozen',
      revision: 'a'.repeat(40),
      inventoryDigest: 'b'.repeat(64),
      ledgerReady: false,
    });
    const harness = transactionHarness(new Map([[migrationStateDocument.path, globalFence]]));
    await expect(createSharedDeckAtomically(
      harness.database,
      reference('shared_decks/other-share'),
      reference('shared_deck_owners/other-share'),
      otherDocuments,
      { ...options, ownerUid: 'other-owner', migrationStateDocument },
    )).rejects.toBeInstanceOf(SharedDeckMigrationRequiredError);
    expect(harness.writes).toEqual([]);
  });

  it('blocks another owner revoke under the same global fence', async () => {
    const documents = buildSharedDeckDocuments(deckInput(), 'other-owner', time(0), time(1_000));
    const globalFence = snapshot(true, {
      schemaVersion: 2,
      ownerUid: 'owner',
      phase: 'frozen',
      revision: 'a'.repeat(40),
      inventoryDigest: 'b'.repeat(64),
      ledgerReady: false,
    });
    const harness = transactionHarness(new Map([
      [migrationStateDocument.path, globalFence],
      [sharedDeck.path, snapshot(true, documents.sharedDeck)],
      [ownership.path, snapshot(true, documents.ownership)],
    ]));
    await expect(revokeSharedDeckAtomically(
      harness.database,
      sharedDeck,
      ownership,
      'other-owner',
      { ...options, ownerUid: 'other-owner' },
    )).rejects.toBeInstanceOf(SharedDeckMigrationRequiredError);
    expect(harness.deletes).toEqual([]);
  });

  it('reopens every owner after the global cutover is verified', async () => {
    const documents = buildSharedDeckDocuments(deckInput(), 'other-owner', time(0), time(1_000));
    const verified = snapshot(true, {
      schemaVersion: 2,
      ownerUid: 'owner',
      phase: 'verified',
      revision: 'a'.repeat(40),
      inventoryDigest: 'b'.repeat(64),
      ledgerReady: true,
    });
    const harness = transactionHarness(new Map([[migrationStateDocument.path, verified]]));
    await createSharedDeckAtomically(
      harness.database,
      reference('shared_decks/reopened-share'),
      reference('shared_deck_owners/reopened-share'),
      documents,
      { ...options, ownerUid: 'other-owner', usageDocument: reference('users/other-owner/profile/shared_deck_usage') },
    );
    expect(harness.writes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'shared_decks/reopened-share', method: 'create' }),
    ]));
  });

  it('keeps the callable gate closed while verification progress is active', async () => {
    const documents = buildSharedDeckDocuments(deckInput(), 'owner', time(0), time(1_000));
    const verifying = snapshot(true, {
      schemaVersion: 2,
      ownerUid: 'owner',
      phase: 'verified',
      revision: 'a'.repeat(40),
      inventoryDigest: 'b'.repeat(64),
      ledgerReady: true,
      verificationProgress: { active: true },
    });
    const harness = transactionHarness(new Map([[migrationStateDocument.path, verifying]]));
    await expect(createSharedDeckAtomically(
      harness.database,
      sharedDeck,
      ownership,
      documents,
      { ...options, migrationStateDocument },
    )).rejects.toBeInstanceOf(SharedDeckMigrationRequiredError);
    expect(harness.writes).toEqual([]);
  });

  it('enforces exact count and byte boundaries, allowing equality', async () => {
    const input = deckInput();
    const documents = buildSharedDeckDocuments(input, 'owner', time(0), time(1_000));
    const payloadBytes = documents.ownership.payloadBytes as number;
    const usage = {
      schemaVersion: 1,
      shares: Object.fromEntries(Array.from({ length: MAX_SHARED_DECKS - 1 }, (_, index) => [
        `existing-${index}`,
        { payloadBytes, expiresAt: time(1_000) },
      ])),
      activeCount: MAX_SHARED_DECKS - 1,
      activeBytes: payloadBytes * (MAX_SHARED_DECKS - 1),
    };
    const harness = transactionHarness(new Map([[usageDocument.path, snapshot(true, usage)]]));
    await expect(createSharedDeckAtomically(
      harness.database,
      sharedDeck,
      ownership,
      documents,
      { ...options, maxActiveCount: MAX_SHARED_DECKS, maxActiveBytes: payloadBytes * MAX_SHARED_DECKS },
    )).resolves.toBeUndefined();

    const overCount = transactionHarness(new Map([[usageDocument.path, snapshot(true, {
      ...usage,
      shares: { ...usage.shares, [`existing-${MAX_SHARED_DECKS - 1}`]: { payloadBytes, expiresAt: time(1_000) } },
      activeCount: MAX_SHARED_DECKS,
      activeBytes: payloadBytes * MAX_SHARED_DECKS,
    })]]));
    await expect(createSharedDeckAtomically(
      overCount.database,
      sharedDeck,
      ownership,
      documents,
      { ...options, maxActiveCount: MAX_SHARED_DECKS, maxActiveBytes: MAX_SHARED_DECK_BYTES },
    )).rejects.toBeInstanceOf(SharedDeckQuotaError);
    expect(overCount.writes).toEqual([]);
  });

  it('prunes an expired lease before enforcing quota', async () => {
    const documents = buildSharedDeckDocuments(deckInput(), 'owner', time(0), time(1_000));
    const expired = { payloadBytes: documents.ownership.payloadBytes as number, expiresAt: time(99) };
    const harness = transactionHarness(new Map([[usageDocument.path, snapshot(true, {
      schemaVersion: 1,
      shares: { expired },
      activeCount: 1,
      activeBytes: expired.payloadBytes,
    })]]));

    await expect(createSharedDeckAtomically(
      harness.database,
      sharedDeck,
      ownership,
      documents,
      { ...options, maxActiveCount: 1, maxActiveBytes: expired.payloadBytes },
    )).resolves.toBeUndefined();
    expect(harness.writes.find(write => write.path === usageDocument.path)?.data).toEqual({
      schemaVersion: 1,
      shares: { 'share-1': { payloadBytes: expired.payloadBytes, expiresAt: expect.anything() } },
      activeCount: 1,
      activeBytes: expired.payloadBytes,
    });
    expect((harness.writes.find(write => write.path === usageDocument.path)?.data
      ?.shares['share-1'].expiresAt as ReturnType<typeof time>).toMillis()).toBe(1_000);
  });

  it('rejects aggregate bytes independently when count still has headroom', async () => {
    const documents = buildSharedDeckDocuments(deckInput(), 'owner', time(0), time(1_000));
    const payloadBytes = documents.ownership.payloadBytes as number;
    const existingBytes = MAX_SHARED_DECK_BYTES - payloadBytes + 1;
    const harness = transactionHarness(new Map([[usageDocument.path, snapshot(true, {
      schemaVersion: 1,
      shares: { existing: { payloadBytes: existingBytes, expiresAt: time(1_000) } },
      activeCount: 1,
      activeBytes: existingBytes,
    })]]));

    await expect(createSharedDeckAtomically(
      harness.database,
      sharedDeck,
      ownership,
      documents,
      { ...options, maxActiveCount: MAX_SHARED_DECKS, maxActiveBytes: MAX_SHARED_DECK_BYTES },
    )).rejects.toBeInstanceOf(SharedDeckQuotaError);
    expect(harness.writes).toEqual([]);
  });

  it('fails closed when a supplied payload size disagrees with owner metadata', async () => {
    const documents = buildSharedDeckDocuments(deckInput(), 'owner', time(0), time(1_000));
    const harness = transactionHarness(new Map());

    await expect(createSharedDeckAtomically(
      harness.database,
      sharedDeck,
      ownership,
      documents,
      { ...options, payloadBytes: (documents.ownership.payloadBytes as number) - 1 },
    )).rejects.toBeInstanceOf(SharedDeckUsageStateError);
    expect(harness.writes).toEqual([]);
  });

  it('fails closed for malformed or counter-inconsistent usage without writes', async () => {
    const documents = buildSharedDeckDocuments(deckInput(), 'owner', time(0), time(1_000));
    for (const usage of [
      { schemaVersion: 2, shares: {}, activeCount: 0, activeBytes: 0 },
      { schemaVersion: 1, shares: { old: { payloadBytes: 3, expiresAt: time(1_000) } }, activeCount: 0, activeBytes: 0 },
      { schemaVersion: 1, shares: { ["x".repeat(129)]: { payloadBytes: 3, expiresAt: time(1_000) } }, activeCount: 1, activeBytes: 3 },
    ]) {
      const harness = transactionHarness(new Map([[usageDocument.path, snapshot(true, usage)]]));
      await expect(createSharedDeckAtomically(
        harness.database,
        sharedDeck,
        ownership,
        documents,
        options,
      )).rejects.toBeInstanceOf(SharedDeckUsageStateError);
      expect(harness.writes).toEqual([]);
    }
  });

  it('revokes schema 2 documents exactly once and decrements matching usage', async () => {
    const owner = {
      ownerUid: 'owner', createdAt: time(0), expiresAt: time(1_000),
      payloadBytes: 25, schemaVersion: 2,
    };
    const usage = {
      schemaVersion: 1,
      shares: { 'share-1': { payloadBytes: 25, expiresAt: time(1_000) }, other: { payloadBytes: 5, expiresAt: time(1_000) } },
      activeCount: 2,
      activeBytes: 30,
    };
    const harness = transactionHarness(new Map([
      [ownership.path, snapshot(true, owner)],
      [sharedDeck.path, snapshot(true, { schemaVersion: 2 })],
      [usageDocument.path, snapshot(true, usage)],
    ]));

    await expect(revokeSharedDeckAtomically(harness.database, sharedDeck, ownership, 'owner', options))
      .resolves.toBe(true);
    expect(harness.deletes).toEqual([sharedDeck.path, ownership.path]);
    expect(harness.writes).toEqual([{
      method: 'set', path: usageDocument.path,
      data: { schemaVersion: 1, shares: { other: usage.shares.other }, activeCount: 1, activeBytes: 5 },
    }]);

    const retry = transactionHarness(new Map());
    await expect(revokeSharedDeckAtomically(retry.database, sharedDeck, ownership, 'owner', options))
      .resolves.toBe(false);
    expect(retry.writes).toEqual([]);
  });

  it('allows cleanup after expiry when the lease was already pruned', async () => {
    const owner = {
      ownerUid: 'owner', createdAt: time(0), expiresAt: time(99),
      payloadBytes: 25, schemaVersion: 2,
    };
    const harness = transactionHarness(new Map([
      [ownership.path, snapshot(true, owner)],
      [sharedDeck.path, snapshot(true, { schemaVersion: 2 })],
      [usageDocument.path, snapshot(true, { schemaVersion: 1, shares: {}, activeCount: 0, activeBytes: 0 })],
    ]));

    await expect(revokeSharedDeckAtomically(harness.database, sharedDeck, ownership, 'owner', options))
      .resolves.toBe(true);
    expect(harness.deletes).toEqual([sharedDeck.path, ownership.path]);
    expect(harness.writes).toEqual([]);
  });

  it('fails closed for schema 1 private and legacy public revoke paths', async () => {
    const legacyOwner = {
      ownerUid: 'owner', createdAt: time(0), expiresAt: time(1_000), schemaVersion: 1,
    };
    const privateHarness = transactionHarness(new Map([
      [ownership.path, snapshot(true, legacyOwner)],
      [sharedDeck.path, snapshot(true, { schemaVersion: 2 })],
    ]));
    await expect(revokeSharedDeckAtomically(privateHarness.database, sharedDeck, ownership, 'owner', options))
      .rejects.toBeInstanceOf(SharedDeckMigrationRequiredError);
    expect(privateHarness.writes).toEqual([]);

    const legacyHarness = transactionHarness(new Map([
      [sharedDeck.path, snapshot(true, { authorUid: 'owner', schemaVersion: 1 })],
    ]));
    await expect(revokeSharedDeckAtomically(legacyHarness.database, sharedDeck, ownership, 'owner', options))
      .rejects.toBeInstanceOf(SharedDeckMigrationRequiredError);
    expect(legacyHarness.deletes).toEqual([]);
  });

  it('uses private ownership as authoritative and denies another user', async () => {
    const harness = transactionHarness(new Map([
      [ownership.path, snapshot(true, {
        ownerUid: 'owner', createdAt: time(0), expiresAt: time(1_000), schemaVersion: 1,
      })],
      [sharedDeck.path, snapshot(true, { authorUid: 'attacker', schemaVersion: 1 })],
    ]));

    await expect(revokeSharedDeckAtomically(harness.database, sharedDeck, ownership, 'attacker', options))
      .rejects.toBeInstanceOf(SharedDeckOwnershipError);
    expect(harness.deletes).toEqual([]);
  });

  it('wires callable create and revoke through atomic persistence', () => {
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

    expect(source).toContain('createSharedDeckAtomically(database, document, ownership, documents, { now })');
    expect(source).toContain('revokeSharedDeckAtomically(database, document, ownership, userId)');
    expect(source).not.toMatch(/authorUid\s*:\s*userId/);
  });

  it('maps shared-deck quota and state errors to callable errors directly', () => {
    expect(toSharedDeckHttpsError(new SharedDeckQuotaError())?.code).toBe('resource-exhausted');
    expect(toSharedDeckHttpsError(new SharedDeckMigrationRequiredError())?.code)
      .toBe('failed-precondition');
    expect(toSharedDeckHttpsError(new SharedDeckUsageStateError())?.code)
      .toBe('failed-precondition');
    expect(toSharedDeckHttpsError(new Error('unrelated'))).toBeNull();
  });
});
