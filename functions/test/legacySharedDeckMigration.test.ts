import { describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { calculateSharedDeckPayloadBytes } from '../src/inputValidation.js';
import { createFirestoreLegacySharedDeckInventoryStore } from '../src/legacySharedDeckInventoryFirestore.js';
import {
  buildInventoryReport,
  classifyLegacyShare,
  createLegacySharedDeckInventory,
  createFrozenLegacySharedDeckInventory,
  applyLegacySharedDeckMigration,
  verifyLegacySharedDeckCutover,
  supersedeLegacySharedDeckMigration,
  SUPERSEDE_SHARED_DECK_CONFIRMATION,
  readSealedLegacySharedDeckInventory,
  LegacySharedDeckApplyError,
  digestCanonicalValue,
  hashOwnerKey,
  MAX_SEALED_MANIFEST_CHUNK_BYTES,
  MAX_SEALED_MANIFEST_CHUNK_ENTRIES,
  MAX_QUARANTINE_DOCUMENT_BYTES,
  canonicalUtf8Bytes,
  estimateFirestoreDocumentBytes,
  verifyLegacySharedDeckBackupManifest,
  canonicalLegacySharedDeckBackupManifest,
  type LegacySharedDeckRecord,
  type LegacySharedDeckInventoryStore,
} from '../src/legacySharedDeckMigration.js';
import {
  buildLegacySharedDeckMigrationOperatorReport,
  validateLegacySharedDeckOperatorEnvironment,
} from '../src/legacySharedDeckMigrationOperator.js';

const ownerUid = 'protected-owner';
const { privateKey: backupSigningKey, publicKey: backupVerificationKey } = generateKeyPairSync('ed25519');

const signedBackupManifest = (inventory: { inventoryDigest: string; target: string; revision: string; scanStartedAt: string }) => {
  const unsigned = {
    schemaVersion: 2 as const,
    backupObjectId: 'gs://verified-backup/owner-a/manifest.json',
    backupGeneration: '1700000000000000',
    backupDigest: 'd'.repeat(64),
    inventoryDigest: inventory.inventoryDigest,
    target: inventory.target,
    revision: inventory.revision,
    ownerUid,
    verifiedAt: inventory.scanStartedAt,
  };
  return {
    ...unsigned,
    signature: sign(null, canonicalLegacySharedDeckBackupManifest(unsigned), backupSigningKey).toString('base64'),
  };
};
const preparedIndexes = (inventory: { target: string; revision: string }) => {
  const report = {
    schemaVersion: 1 as const,
    indexDigest: 'e'.repeat(64),
    target: inventory.target,
    revision: inventory.revision,
    active: true as const,
    completedAt: new Date(Date.now() - 1_000).toISOString(),
    operationIds: ['operations/1'],
  };
  return {
    workflowRunId: '123',
    reportSha256: digestCanonicalValue(report),
    report,
  };
};
const timestamp = { seconds: 1_700_000_000, nanoseconds: 0 };
const card = {
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
};
const releasedCard = {
  word: 'hello',
  translation: 'xin chào',
  explanation: '',
  phonetic: '',
  category: '',
  partOfSpeech: '',
  emoji: '',
  audioUrl: null,
  imageUrl: null,
};

const legacy = (shareId = 'legacy-1', overrides: Record<string, unknown> = {}): LegacySharedDeckRecord => ({
  shareId,
  publicData: {
    category: 'Basics',
    cards: [card],
    createdAt: '2023-11-14T22:13:20.000Z',
    ...overrides,
  },
});

const current = (shareId = 'current-1', overrides: Record<string, unknown> = {}): LegacySharedDeckRecord => ({
  shareId,
  publicData: {
    category: 'Basics',
    cards: [card],
    createdAt: timestamp,
    expiresAt: { seconds: 1_900_000_000, nanoseconds: 0 },
    schemaVersion: 2,
    ...overrides,
  },
});

const privateV1 = (owner = ownerUid, overrides: Record<string, unknown> = {}) => ({
  ownerUid: owner,
  createdAt: timestamp,
  expiresAt: { seconds: 1_900_000_000, nanoseconds: 0 },
  schemaVersion: 1,
  ...overrides,
});

type TestPage = {
  publicDocuments: { id: string; data: Record<string, unknown> }[];
  privateDocuments: { id: string; data: Record<string, unknown> }[];
  publicCursor?: string | null;
  privateCursor?: string | null;
  publicTerminal?: boolean;
  privateTerminal?: boolean;
};

const pageStore = (pages: TestPage[]): LegacySharedDeckInventoryStore => ({
  readPage: async ({ source, after }) => {
    const documents = pages.flatMap(page => source === 'public' ? page.publicDocuments : page.privateDocuments);
    const start = after === null ? 0 : documents.findIndex(document => document.id === after) + 1;
    const boundedStart = start < 0 ? documents.length : start;
    const selected = documents.slice(boundedStart, boundedStart + 10);
    return {
      documents: selected,
      cursor: selected.at(-1)?.id ?? after,
      terminal: boundedStart + selected.length >= documents.length,
    };
  },
});

const publicDocument = (record: LegacySharedDeckRecord) => ({
  id: record.shareId as string,
  data: record.publicData as Record<string, unknown>,
});

const firestoreMapDatabase = (
  initial: Map<string, Record<string, unknown>>,
  failAfterTransaction = 0,
) => {
  const data = initial;
  let transactionCount = 0;
  const snapshotFor = (path: string) => ({
    exists: data.has(path),
    data: () => data.get(path),
  });
  const ref = (path: string): Record<string, unknown> => ({
    path,
    id: path.split('/').at(-1)!,
    get: async () => snapshotFor(path),
    collection: (name: string) => ({
      doc: (id: string) => ref(`${path}/${name}/${id}`),
    }),
  });
  const query = (collection: string, after: string | null = null, limit = 400) => ({
    __query: true,
    collection,
    after,
    pageLimit: limit,
    orderBy: () => query(collection, after, limit),
    limit: (nextLimit: number) => query(collection, after, nextLimit),
    startAfter: (next: string) => query(collection, next, limit),
    get: async () => {
      const prefix = `${collection}/`;
      const ids = [...data.keys()]
        .filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(path => path.slice(prefix.length))
        .sort();
      const start = after ? ids.indexOf(after) + 1 : 0;
      const selected = ids.slice(start, start + limit);
      return {
        size: selected.length,
        docs: selected.map(id => ({ id, data: () => data.get(`${prefix}${id}`) })),
      };
    },
  });
  const database = {
    collection: (name: string) => ({
      doc: (id: string) => ref(`${name}/${id}`),
      orderBy: () => query(name),
    }),
    runTransaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => {
      transactionCount += 1;
      const result = await callback({
        get: async (document: Record<string, unknown>) => {
          if (document.__query === true) {
            const prefix = `${document.collection}/`;
            const ids = [...data.keys()]
              .filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
              .map(path => path.slice(prefix.length))
              .sort();
            const start = document.after ? ids.indexOf(document.after as string) + 1 : 0;
            const selected = ids.slice(start, start + (document.pageLimit as number));
            return {
              size: selected.length,
              docs: selected.map(id => ({ id, data: () => data.get(`${prefix}${id}`) })),
            };
          }
          return snapshotFor(document.path as string);
        },
        create: (document: Record<string, unknown>, value: Record<string, unknown>) => {
          data.set(document.path as string, value);
        },
        set: (document: Record<string, unknown>, value: Record<string, unknown>) => {
          data.set(document.path as string, value);
        },
      });
      if (failAfterTransaction !== 0 && transactionCount === failAfterTransaction) {
        throw new Error('simulated transaction crash');
      }
      return result;
    },
  } as never;
  return { database, data, get transactionCount() { return transactionCount; } };
};

describe('legacy shared-deck exact inventory', () => {
  it('classifies owner-free records without changing their share identity', () => {
    expect(classifyLegacyShare(legacy(), ownerUid)).toMatchObject({
      action: 'migrate',
      disposition: 'migrate-owner-free-legacy',
      ownerUid,
      preserveShareId: true,
      reasonCode: 'owner-free-legacy',
    });
    expect(classifyLegacyShare(legacy(), ownerUid).payloadBytes).toBe(
      calculateSharedDeckPayloadBytes({ category: 'Basics', cards: [card] }),
    );
    expect(classifyLegacyShare({ ...legacy('legacy-with-private'), privateData: privateV1() }, ownerUid, {
      scanStartedAt: '2023-11-15T00:00:00.000Z',
    })).toMatchObject({
      disposition: 'migrate-owner-free-legacy',
      reasonCode: 'owner-free-legacy',
      existingExpiresAt: { seconds: '1900000000', nanoseconds: 0 },
    });
  });

  it('keeps exact current records and upgrades matching private v1 metadata', () => {
    expect(classifyLegacyShare({ ...current(), privateData: {
      ...privateV1(),
      createdAt: timestamp,
    } }, ownerUid)).toMatchObject({
      disposition: 'upgrade-private-v1',
      reasonCode: 'private-v1-upgrade',
    });
    expect(classifyLegacyShare({ ...current(), privateData: {
      ...privateV1(),
      payloadBytes: 10,
      schemaVersion: 2,
    } }, ownerUid)).toMatchObject({
      disposition: 'block',
      reasonCode: 'payload-mismatch',
    });
    expect(classifyLegacyShare({
      shareId: 'transitional',
      publicData: {
        authorUid: ownerUid,
        category: 'Basics',
        cards: [card],
        createdAt: timestamp,
        expiresAt: { seconds: 1_900_000_000, nanoseconds: 0 },
        schemaVersion: 1,
      },
      privateData: { ...privateV1(), schemaVersion: 2, payloadBytes: 1 },
    }, ownerUid)).toMatchObject({
      disposition: 'block',
      reasonCode: 'private-conflict',
    });
  });

  it('blocks owner and timestamp conflicts and quarantines private orphans', () => {
    expect(classifyLegacyShare({ ...current(), privateData: privateV1('other-owner') }, ownerUid)).toMatchObject({
      disposition: 'block',
      reasonCode: 'owner-mismatch',
    });
    expect(classifyLegacyShare({ ...current(), privateData: privateV1(ownerUid, {
      expiresAt: { seconds: 1_900_000_001, nanoseconds: 0 },
    }) }, ownerUid)).toMatchObject({
      disposition: 'block',
      reasonCode: 'timestamp-mismatch',
    });
    expect(classifyLegacyShare({ shareId: 'orphan', privateData: privateV1() }, ownerUid)).toMatchObject({
      disposition: 'block',
      reasonCode: 'orphan-private-active',
    });
    expect(classifyLegacyShare({ shareId: 'expired-orphan', privateData: privateV1(ownerUid, {
      expiresAt: { seconds: 1, nanoseconds: 0 },
    }) }, ownerUid, { scanStartedAt: '2026-08-24T00:00:00.000Z' })).toMatchObject({
      disposition: 'quarantine-candidate',
      reasonCode: 'orphan-private',
    });
  });

  it('normalizes pre-epoch timestamps with floor semantics and blocks out-of-range timestamps', () => {
    const preEpoch = { seconds: '-1', nanoseconds: 999_000_000 };
    expect(classifyLegacyShare(legacy('pre-epoch', {
      createdAt: '1969-12-31T23:59:59.999Z',
    }), ownerUid)).toMatchObject({
      disposition: 'migrate-owner-free-legacy',
      publicCreatedAt: preEpoch,
    });
    expect(classifyLegacyShare({
      ...current('pre-epoch-private', { createdAt: preEpoch }),
      privateData: privateV1(ownerUid, { createdAt: preEpoch }),
    }, ownerUid)).toMatchObject({
      disposition: 'upgrade-private-v1',
      publicCreatedAt: preEpoch,
      privateCreatedAt: preEpoch,
    });
    expect(classifyLegacyShare(current('public-out-of-range', {
      createdAt: { seconds: '253402300800', nanoseconds: 0 },
    }), ownerUid)).toMatchObject({
      disposition: 'block',
      reasonCode: 'timestamp-out-of-range',
    });
    expect(classifyLegacyShare({
      ...current('private-out-of-range'),
      privateData: privateV1(ownerUid, {
        createdAt: { seconds: '-62135596801', nanoseconds: 0 },
      }),
    }, ownerUid)).toMatchObject({
      disposition: 'block',
      reasonCode: 'timestamp-out-of-range',
    });
  });

  it('blocks public, private, and proposed expiry timestamps outside Firestore range', async () => {
    expect(classifyLegacyShare(current('public-expiry-out-of-range', {
      expiresAt: { seconds: '253402300800', nanoseconds: 0 },
    }), ownerUid)).toMatchObject({
      disposition: 'block',
      reasonCode: 'timestamp-out-of-range',
    });
    expect(classifyLegacyShare({
      ...current('private-expiry-out-of-range'),
      privateData: privateV1(ownerUid, {
        expiresAt: { seconds: '-62135596801', nanoseconds: 0 },
      }),
    }, ownerUid)).toMatchObject({
      disposition: 'block',
      reasonCode: 'timestamp-out-of-range',
    });
    expect(classifyLegacyShare(legacy('proposed-expiry-out-of-range'), ownerUid, {
      scanStartedAt: '9999-12-31T23:59:59.999Z',
    })).toMatchObject({
      disposition: 'block',
      reasonCode: 'timestamp-out-of-range',
    });
    const badCurrent = current('inventory-expiry-out-of-range', {
      expiresAt: { seconds: '253402300800', nanoseconds: 0 },
    });
    const inventory = await createFrozenLegacySharedDeckInventory({
      store: pageStore([{
        publicDocuments: [publicDocument(legacy('a-valid-before-bad')), publicDocument(badCurrent)],
        privateDocuments: [{ id: badCurrent.shareId as string, data: privateV1() }],
        publicTerminal: true,
        privateTerminal: true,
      }]),
      ownerUid,
      runId: 'expiry-preflight-run',
      revision: '6'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
    });
    expect(inventory.applyEligible).toBe(false);
    const noWriteDatabase = {
      runTransaction: () => { throw new Error('must not begin apply for out-of-range expiry'); },
    } as never;
    await expect(applyLegacySharedDeckMigration(noWriteDatabase, inventory, {
      ownerUid, revision: inventory.revision, target: inventory.target,
      confirmation: 'APPLY_SHARED_DECK_V2', backupManifest: {}, backupPublicKey: backupVerificationKey,
      indexPreparation: preparedIndexes(inventory),
    })).rejects.toBeInstanceOf(LegacySharedDeckApplyError);
  });

  it('rejects malformed and non-lossless source values', () => {
    expect(classifyLegacyShare(legacy('extra', { unexpected: true }), ownerUid)).toMatchObject({
      disposition: 'quarantine-candidate',
      reasonCode: 'malformed-public',
    });
    expect(classifyLegacyShare(legacy('nan', { cards: [{ ...card, score: Number.NaN }] }), ownerUid)).toMatchObject({
      disposition: 'block',
      reasonCode: 'unsupported-value',
    });
    expect(classifyLegacyShare(legacy('empty', { cards: [] }), ownerUid)).toMatchObject({
      disposition: 'quarantine-candidate',
      reasonCode: 'empty-public',
    });
    expect(classifyLegacyShare(legacy('card-extra', {
      cards: [{ ...card, unknownField: 'reject' }],
    }), ownerUid)).toMatchObject({
      disposition: 'quarantine-candidate',
      reasonCode: 'malformed-public',
    });
    expect(classifyLegacyShare(legacy('released-card-lossy', {
      cards: [{ ...releasedCard, word: ' hello ' }],
    }), ownerUid)).toMatchObject({
      disposition: 'quarantine-candidate',
      reasonCode: 'malformed-public',
    });
    expect(classifyLegacyShare(legacy('too-large-to-wrap', {
      unexpected: 'x'.repeat(MAX_QUARANTINE_DOCUMENT_BYTES),
    }), ownerUid)).toMatchObject({
      disposition: 'block',
      reasonCode: 'quarantine-too-large',
    });
  });

  it('accepts the released nine-field card projection without rewriting its payload', () => {
    const classification = classifyLegacyShare(legacy('released-card', { cards: [releasedCard] }), ownerUid);
    const serialized = JSON.stringify({ category: 'Basics', cards: [releasedCard] });
    expect(classification).toMatchObject({
      disposition: 'migrate-owner-free-legacy',
      reasonCode: 'owner-free-legacy',
      payloadBytes: new TextEncoder().encode(serialized).byteLength,
    });
    expect(classification.payloadDigest).toBe(
      createHash('sha256').update(serialized, 'utf8').digest('hex'),
    );
  });

  it('uses stable recursive UTF-8 digests and preserves arrays', () => {
    expect(digestCanonicalValue({ z: 'é', a: [2, 1] })).toBe(
      digestCanonicalValue({ a: [2, 1], z: 'é' }),
    );
    expect(digestCanonicalValue({ a: [2, 1] })).not.toBe(digestCanonicalValue({ a: [1, 2] }));
    expect(digestCanonicalValue(Timestamp.fromMillis(0))).not.toBe(
      digestCanonicalValue({ seconds: '0', nanoseconds: 0 }),
    );
    expect(digestCanonicalValue(Timestamp.fromMillis(0))).not.toBe(
      digestCanonicalValue({ _seconds: 0, _nanoseconds: 0 }),
    );
  });

  it('estimates Firestore storage conservatively for nested maps and arrays', () => {
    const emptyMaps = { values: Array.from({ length: 2_000 }, () => ({})) };
    const numericNested = { values: Array.from({ length: 2_000 }, (_, index) => ({ index, value: index * 2 })) };
    expect(estimateFirestoreDocumentBytes(emptyMaps)).toBeGreaterThan(64_000);
    expect(estimateFirestoreDocumentBytes({ values: Array.from({ length: 32_760 }, () => ({})) }))
      .toBeGreaterThan(1_048_576);
    expect(estimateFirestoreDocumentBytes(numericNested)).toBeGreaterThan(estimateFirestoreDocumentBytes(emptyMaps));
    expect(() => estimateFirestoreDocumentBytes({ value: Number.NaN })).toThrow(/unsupported/i);
  });

  it('counts actual Firestore Timestamps compactly but plain timestamp-shaped maps as maps', () => {
    const actualTimestamp = estimateFirestoreDocumentBytes({ value: Timestamp.fromMillis(0) });
    const plainTimestampMap = estimateFirestoreDocumentBytes({ value: { seconds: '0', nanoseconds: 0 } });
    expect(plainTimestampMap).toBeGreaterThan(actualTimestamp);
    expect(estimateFirestoreDocumentBytes({
      values: Array.from({ length: 20_000 }, () => ({ seconds: '0', nanoseconds: 0 })),
    })).toBeGreaterThan(1_048_576);
  });

  it('merges bounded streams, seals chunks, and keeps duplicate payload IDs', async () => {
    const inventory = await createLegacySharedDeckInventory({ store: pageStore([{
      publicDocuments: [publicDocument(legacy('a')), publicDocument(legacy('b'))],
      privateDocuments: [],
      publicCursor: 'b',
      privateCursor: null,
      publicTerminal: true,
      privateTerminal: true,
    }]),
      ownerUid,
      runId: 'run-1',
      revision: 'a'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
      collectEntries: true,
      collectChunks: true,
    });
    expect(inventory.entries).toHaveLength(2);
    expect(inventory.entries.map(entry => entry.shareId)).toEqual(['a', 'b']);
    expect(inventory.entries.every(entry => entry.payloadEquivalent)).toBe(true);
    expect(inventory.chunks[0]?.entries).toHaveLength(2);
    expect(inventory.consistency).toBe('unfrozen');
    expect(inventory.applyEligible).toBe(false);
    expect(inventory.publicTerminal && inventory.privateTerminal).toBe(true);
    expect(inventory.checkpoint).toMatchObject({
      runId: 'run-1',
      revision: 'a'.repeat(40),
      target: 'test',
      publicTerminal: true,
      privateTerminal: true,
    });
  });

  it('pages both streams with one digest chain and resumes after a checkpoint', async () => {
    const first = await createLegacySharedDeckInventory({ store: pageStore([
      {
        publicDocuments: [publicDocument(legacy('a'))],
        privateDocuments: [publicDocument(legacy('b'))],
        publicCursor: 'a',
        privateCursor: 'b',
        publicTerminal: false,
        privateTerminal: false,
      },
    ]),
      ownerUid,
      runId: 'resume-run',
      revision: 'c'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
      collectEntries: true,
      collectChunks: true,
    });
    const resumeCheckpoint = {
      ...first.checkpoint,
      publicTerminal: false,
      privateTerminal: false,
      publicCursor: 'a',
      privateCursor: 'b',
      afterPublicCursor: 'a',
      afterPrivateCursor: 'b',
      previousDigest: first.chainHead,
    };
    const second = await createLegacySharedDeckInventory({ store: pageStore([{
      publicDocuments: [publicDocument(legacy('c'))],
      privateDocuments: [publicDocument(legacy('d'))],
      publicCursor: 'c',
      privateCursor: 'd',
      publicTerminal: true,
      privateTerminal: true,
    }]),
      ownerUid,
      runId: 'resume-run',
      revision: 'c'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
      resume: resumeCheckpoint,
      collectEntries: true,
      collectChunks: true,
    });
    expect(second.entries.map(entry => entry.shareId)).toEqual(['c', 'd']);
    expect(second.chunks[0]?.previousDigest).toBe(first.chainHead);
    expect(second.chunks[0]?.index).toBe(first.chunks[0]!.index + 1);
    expect(second.checkpoint.beforePublicCursor).toBe('a');
    expect(second.checkpoint.afterPublicCursor).toBe('c');
  });

  it('holds a greater private head until the public stream reaches it', async () => {
    const publicDocuments = Array.from({ length: 10 }, (_, index) => publicDocument(legacy(String.fromCharCode(97 + index))));
    const zPublic = publicDocument(legacy('z'));
    const privateZ = { id: 'z', data: privateV1() };
    const requests: string[] = [];
    const store: LegacySharedDeckInventoryStore = {
      readPage: async ({ source = 'public', after = null }) => {
        requests.push(`${source}:${after ?? 'start'}`);
        if (source === 'private') return {
          documents: after === null ? [privateZ] : [],
          cursor: after === null ? 'z' : after,
          terminal: true,
        };
        if (after === null) return {
          documents: publicDocuments,
          cursor: 'j',
          terminal: false,
        };
        return {
          documents: [zPublic],
          cursor: 'z',
          terminal: true,
        };
      },
    };
    const inventory = await createLegacySharedDeckInventory({ store,
      ownerUid,
      runId: 'skew-run',
      revision: 'f'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
      collectEntries: true,
      collectChunks: true,
    });
    expect(inventory.entries.filter(entry => entry.shareId === 'z')).toHaveLength(1);
    expect(inventory.entries.find(entry => entry.shareId === 'z')).toMatchObject({
      disposition: 'migrate-owner-free-legacy',
      privateDigest: expect.any(String),
    });
    expect(requests.filter(request => request.startsWith('private:'))).toEqual(['private:start']);
  });

  it('emits the smaller known head while both streams remain nonterminal', async () => {
    const requests: string[] = [];
    const store: LegacySharedDeckInventoryStore = {
      readPage: async ({ source, after }) => {
        requests.push(`${source}:${after ?? 'start'}`);
        if (source === 'public' && after === null) return {
          documents: [publicDocument(legacy('a'))], cursor: 'a', terminal: false,
        };
        if (source === 'public') return {
          documents: [publicDocument(legacy('b'))], cursor: 'b', terminal: true,
        };
        if (after === null) return {
          documents: [{ id: 'z', data: privateV1() }], cursor: 'z', terminal: false,
        };
        return { documents: [], cursor: after, terminal: true };
      },
    };
    const inventory = await createLegacySharedDeckInventory({
      store,
      ownerUid,
      runId: 'skew-bounded-run',
      revision: '7'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
      collectEntries: true,
      collectChunks: true,
    });
    expect(inventory.entries.map(entry => entry.shareId)).toEqual(['a', 'b', 'z']);
    expect(requests.filter(request => request === 'private:start')).toHaveLength(1);
  });

  it('records empty terminal-page transitions after exact nonterminal pages', async () => {
    const publicDocuments = Array.from({ length: 10 }, (_, index) => publicDocument(legacy(`public-${index}`)));
    const privateDocuments = Array.from({ length: 10 }, (_, index) => ({
      id: `private-${index}`,
      data: privateV1(),
    }));
    const store: LegacySharedDeckInventoryStore = {
      readPage: async ({ source, after }) => {
        const documents = source === 'public' ? publicDocuments : privateDocuments;
        if (after === null) return {
          documents,
          cursor: documents.at(-1)!.id,
          terminal: false,
        };
        return { documents: [], cursor: after, terminal: true };
      },
    };
    const inventory = await createLegacySharedDeckInventory({
      store,
      ownerUid,
      runId: 'terminal-transition-run',
      revision: '9'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
      collectEntries: true,
      collectChunks: true,
    });
    expect(inventory.publicTerminal).toBe(true);
    expect(inventory.privateTerminal).toBe(true);
    expect(inventory.checkpoint.publicTerminal).toBe(true);
    expect(inventory.checkpoint.privateTerminal).toBe(true);
    expect(inventory.chunks.some(chunk => chunk.entries.length === 0)).toBe(true);
  });

  it('keeps the production path bounded and flags quota overflow without dropping records', async () => {
    const records = Array.from({ length: 101 }, (_, index) => publicDocument(legacy(`share-${index}`)));
    const pages: TestPage[] = [];
    for (let index = 0; index < records.length; index += 10) {
      const page = records.slice(index, index + 10);
      pages.push({
        publicDocuments: page,
        privateDocuments: [],
        publicCursor: page.at(-1)?.id ?? null,
        privateCursor: null,
        publicTerminal: index + 10 >= records.length,
        privateTerminal: true,
      });
    }
    const inventory = await createLegacySharedDeckInventory({ store: pageStore(pages),
      ownerUid,
      runId: 'bounded-run',
      revision: 'd'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
    });
    expect(inventory.entries).toEqual([]);
    expect(inventory.chunks).toEqual([]);
    expect(inventory.evidence.shareKeys).toHaveLength(100);
    expect(inventory.evidence.shareKeysOmittedCount).toBe(1);
    expect(inventory.quota.overCap).toBe(true);
    expect(inventory.quota.activeCount).toBe(101);
    expect(inventory.counts['migrate-owner-free-legacy']).toBe(101);
  });

  it('bounds issue evidence and preserves equivalent payload observations by ID', async () => {
    const issueRecords = Array.from({ length: 101 }, (_, index) => publicDocument(legacy(`issue-${index}`, {
      unexpected: true,
    })));
    const issuePages: TestPage[] = [];
    for (let index = 0; index < issueRecords.length; index += 10) {
      const page = issueRecords.slice(index, index + 10);
      issuePages.push({ publicDocuments: page, privateDocuments: [] });
    }
    const issueInventory = await createLegacySharedDeckInventory({
      store: pageStore(issuePages),
      ownerUid,
      runId: 'issue-evidence-run',
      revision: 'c'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
    });
    expect(issueInventory.evidence.issues).toHaveLength(100);
    expect(issueInventory.evidence.issuesOmittedCount).toBe(1);
    expect(issueInventory.evidence.shareKeysOmittedCount).toBe(1);

    const equivalentInventory = await createLegacySharedDeckInventory({
      store: pageStore([{
        publicDocuments: [publicDocument(legacy('same-a')), publicDocument(legacy('same-b'))],
        privateDocuments: [],
        publicTerminal: true,
        privateTerminal: true,
      }]),
      ownerUid,
      runId: 'equivalent-evidence-run',
      revision: 'd'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
    });
    expect(equivalentInventory.entries).toEqual([]);
    expect(equivalentInventory.evidence.equivalentPayloads).toEqual([
      expect.objectContaining({ count: 2, equivalenceKey: expect.any(String), shareKeys: expect.any(Array) }),
    ]);
    expect(equivalentInventory.evidence.equivalentPayloads[0]?.shareKeys).toHaveLength(2);
    const rawPayloadDigest = classifyLegacyShare(legacy('same-a'), ownerUid).payloadDigest!;
    expect(buildInventoryReport(equivalentInventory)).not.toContain(rawPayloadDigest);
  });

  it('tracks a duplicate introduced after 100 unique payloads without exposing the raw digest', async () => {
    const records = Array.from({ length: 100 }, (_, index) => publicDocument(legacy(`unique-${index}`, {
      cards: [{ ...card, word: `unique-word-${index}` }],
    })));
    records.push(publicDocument(legacy('duplicate-101-a', {
      cards: [{ ...card, word: 'unique-word-100' }],
    })));
    records.push(publicDocument(legacy('duplicate-101-b', {
      cards: [{ ...card, word: 'unique-word-100' }],
    })));
    const pages: TestPage[] = [];
    for (let index = 0; index < records.length; index += 10) {
      pages.push({ publicDocuments: records.slice(index, index + 10), privateDocuments: [] });
    }
    const inventory = await createLegacySharedDeckInventory({
      store: pageStore(pages),
      ownerUid,
      runId: 'late-equivalence-run',
      revision: 'e'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
    });
    const rawPayloadDigest = classifyLegacyShare(legacy('duplicate-101-a', {
      cards: [{ ...card, word: 'unique-word-100' }],
    }), ownerUid).payloadDigest!;
    expect(inventory.evidence.equivalentPayloads).toHaveLength(1);
    expect(inventory.evidence.equivalentPayloads[0]).toMatchObject({ count: 2 });
    expect(buildInventoryReport(inventory)).not.toContain(rawPayloadDigest);
  });

  it('caps duplicate-payload groups while reporting omitted groups', async () => {
    const records: ReturnType<typeof publicDocument>[] = [];
    for (let index = 0; index < 101; index += 1) {
      const cards = [{ ...card, word: `duplicate-group-${index}` }];
      records.push(publicDocument(legacy(`group-${index}-a`, { cards })));
      records.push(publicDocument(legacy(`group-${index}-b`, { cards })));
    }
    const pages: TestPage[] = [];
    for (let index = 0; index < records.length; index += 10) {
      pages.push({ publicDocuments: records.slice(index, index + 10), privateDocuments: [] });
    }
    const inventory = await createLegacySharedDeckInventory({
      store: pageStore(pages),
      ownerUid,
      runId: 'duplicate-group-cap-run',
      revision: 'f'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
    });
    expect(inventory.evidence.equivalentPayloads).toHaveLength(100);
    expect(inventory.evidence.equivalentPayloadsOmittedCount).toBe(1);
    expect(inventory.evidence.equivalentPayloads.every(payload => payload.count === 2)).toBe(true);
  });

  it('binds even an empty chain to its run context and rejects resume context drift', async () => {
    const first = await createLegacySharedDeckInventory({
      store: pageStore([{
        publicDocuments: [],
        privateDocuments: [],
        publicTerminal: true,
        privateTerminal: true,
      }]),
      ownerUid,
      runId: 'empty-context-run',
      revision: '8'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
      previousDigest: 'a'.repeat(64),
    });
    const second = await createLegacySharedDeckInventory({
      store: pageStore([{
        publicDocuments: [],
        privateDocuments: [],
        publicTerminal: true,
        privateTerminal: true,
      }]),
      ownerUid,
      runId: 'empty-context-run',
      revision: '8'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-25T00:00:00.000Z',
      previousDigest: 'a'.repeat(64),
    });
    expect(first.chainHead).not.toBe('');
    expect(first.chainHead).not.toBe(second.chainHead);
    expect(first.checkpoint.ownerKey).toBe(hashOwnerKey(ownerUid));
    const otherOwner = await createLegacySharedDeckInventory({
      store: pageStore([{
        publicDocuments: [],
        privateDocuments: [],
        publicTerminal: true,
        privateTerminal: true,
      }]),
      ownerUid: 'other-owner',
      runId: 'empty-context-run',
      revision: '8'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
      previousDigest: 'a'.repeat(64),
    });
    expect(first.chainHead).not.toBe(otherOwner.chainHead);
    await expect(createLegacySharedDeckInventory({
      store: pageStore([]),
      ownerUid,
      runId: 'empty-context-run',
      revision: '8'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-25T00:00:00.000Z',
      resume: first.checkpoint,
    })).rejects.toThrow('Inventory resume context does not match');
    await expect(createLegacySharedDeckInventory({
      store: pageStore([]),
      ownerUid: 'other-owner',
      runId: 'empty-context-run',
      revision: '8'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
      resume: first.checkpoint,
    })).rejects.toThrow('Inventory resume context does not match');
  });

  it('emits a redacted report with no raw IDs, owner, or card content', async () => {
    const inventory = await createLegacySharedDeckInventory({ store: pageStore([{
      publicDocuments: [publicDocument(legacy('secret-share'))],
      privateDocuments: [],
      publicCursor: 'secret-share',
      privateCursor: null,
      publicTerminal: true,
      privateTerminal: true,
    }]),
      ownerUid,
      runId: 'run-2',
      revision: 'b'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
    });
    const report = buildInventoryReport(inventory);
    expect(report).toContain('chainHead');
    expect(JSON.parse(report)).toMatchObject({ sealedManifest: null });
    expect(report).not.toContain('secret-share');
    expect(report).not.toContain(ownerUid);
    expect(report).not.toContain('hello');
    expect(report).not.toContain('cursor');
  });

  it('accepts only a protected target, owner assertion, full revision, and persisted scan start', () => {
    expect(() => validateLegacySharedDeckOperatorEnvironment({
      FIREBASE_PROJECT_ID: 'encoded-hangout-433912-h2',
      FIRESTORE_DATABASE_ID: 'ai-studio-945b4052-4462-4668-8936-277f09f07a37',
      OWNER_UID: ownerUid,
      MIGRATION_REVISION: 'e'.repeat(40),
      GITHUB_DEFAULT_BRANCH: 'main',
      SCAN_STARTED_AT: '2026-08-24T00:00:00.000Z',
    })).not.toThrow();
    expect(() => validateLegacySharedDeckOperatorEnvironment({
      FIREBASE_PROJECT_ID: 'encoded-hangout-433912-h2',
      FIRESTORE_DATABASE_ID: 'ai-studio-945b4052-4462-4668-8936-277f09f07a37',
      OWNER_UID: ownerUid,
      MIGRATION_REVISION: 'e'.repeat(8),
      GITHUB_DEFAULT_BRANCH: 'main',
      SCAN_STARTED_AT: '2026-08-24T00:00:00.000Z',
    })).toThrow();
  });

  it('uses only ordered bounded reads at the Firestore boundary', async () => {
    const calls: string[] = [];
    const query = {
      orderBy: () => { calls.push('orderBy'); return query; },
      limit: (value: number) => { calls.push(`limit:${value}`); return query; },
      startAfter: (value: string) => { calls.push(`after:${value}`); return query; },
      get: async () => ({ docs: [], size: 0 }),
    };
    const database = {
      collection: (name: string) => { calls.push(`collection:${name}`); return query; },
    };
    const store = createFirestoreLegacySharedDeckInventoryStore(database as never);
    await store.readPage({ source: 'private', after: 'p', limit: 10 });
    expect(calls).toEqual([
      'collection:shared_deck_owners', 'orderBy', 'limit:10', 'after:p',
    ]);
  });

  it('persists and seals the owner fence before the scan is apply-eligible', async () => {
    const state = new Map<string, Record<string, unknown>>();
    const ref = (path: string) => ({
      path,
      id: path.split('/').at(-1),
      collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }),
    });
    const database = {
      collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
      runTransaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
        get: async (document: { path: string }) => ({
          exists: state.has(document.path),
          data: () => state.get(document.path),
        }),
        create: (document: { path: string }, value: Record<string, unknown>) => state.set(document.path, value),
        set: (document: { path: string }, value: Record<string, unknown>) => state.set(document.path, value),
      }),
    } as never;
    const store = createFirestoreLegacySharedDeckInventoryStore(database);
    await store.beginFreeze!({
      ownerUid, revision: 'f'.repeat(40), target: 'test', scanStartedAt: '2026-08-24T00:00:00.000Z',
    });
    const emptyChunkNamespace = digestCanonicalValue({
      domain: 'legacy-shared-deck-sealed-manifest-chunks-v2', ownerUid, target: 'test',
      revision: 'f'.repeat(40), inventoryDigest: 'a'.repeat(64),
    });
    expect(state.get('admin_shared_deck_migration_jobs/shared_deck_v2')).toMatchObject({
      phase: 'frozen',
      ownerUid,
      target: 'test',
    });
    await store.sealFreeze!({
      ownerUid,
      revision: 'f'.repeat(40),
      target: 'test',
      inventoryDigest: 'a'.repeat(64),
      manifest: {
        schemaVersion: 2,
        ownerUid,
        target: 'test',
        revision: 'f'.repeat(40),
        scanStartedAt: '2026-08-24T00:00:00.000Z',
        inventoryDigest: 'a'.repeat(64),
        chunkNamespace: emptyChunkNamespace,
        entryCount: 0,
        chunkCount: 0,
        seedDigest: digestCanonicalValue({
          domain: 'legacy-shared-deck-sealed-manifest-v2', ownerUid, target: 'test',
          revision: 'f'.repeat(40), scanStartedAt: '2026-08-24T00:00:00.000Z', inventoryDigest: 'a'.repeat(64),
        }),
        lastChunkDigest: digestCanonicalValue({
          domain: 'legacy-shared-deck-sealed-manifest-v2', ownerUid, target: 'test',
          revision: 'f'.repeat(40), scanStartedAt: '2026-08-24T00:00:00.000Z', inventoryDigest: 'a'.repeat(64),
        }),
        counts: {
          'keep-current': 0, 'migrate-owner-free-legacy': 0, 'migrate-transitional': 0,
          'upgrade-private-v1': 0, 'quarantine-candidate': 0, block: 0,
        },
        quota: {
          activeCount: 0, activeBytes: 0, maximumCount: 100, maximumBytes: 25_000_000,
          overCount: false, overBytes: false, overCap: false,
        },
        applyEligible: true,
        rootDigest: digestCanonicalValue({
          schemaVersion: 2, ownerUid, target: 'test', revision: 'f'.repeat(40),
          scanStartedAt: '2026-08-24T00:00:00.000Z', inventoryDigest: 'a'.repeat(64),
          chunkNamespace: emptyChunkNamespace,
          entryCount: 0, chunkCount: 0,
          seedDigest: digestCanonicalValue({
            domain: 'legacy-shared-deck-sealed-manifest-v2', ownerUid, target: 'test',
            revision: 'f'.repeat(40), scanStartedAt: '2026-08-24T00:00:00.000Z', inventoryDigest: 'a'.repeat(64),
          }),
          lastChunkDigest: digestCanonicalValue({
            domain: 'legacy-shared-deck-sealed-manifest-v2', ownerUid, target: 'test',
            revision: 'f'.repeat(40), scanStartedAt: '2026-08-24T00:00:00.000Z', inventoryDigest: 'a'.repeat(64),
          }),
          counts: {
            'keep-current': 0, 'migrate-owner-free-legacy': 0, 'migrate-transitional': 0,
            'upgrade-private-v1': 0, 'quarantine-candidate': 0, block: 0,
          },
          quota: {
            activeCount: 0, activeBytes: 0, maximumCount: 100, maximumBytes: 25_000_000,
            overCount: false, overBytes: false, overCap: false,
          },
          applyEligible: true,
        }),
      },
      chunks: [],
    });
    await store.sealFreeze!({
      ownerUid,
      revision: 'f'.repeat(40),
      target: 'test',
      inventoryDigest: 'a'.repeat(64),
      manifest: state.get('admin_shared_deck_migration_jobs/shared_deck_v2')?.manifest as never,
      chunks: [],
    });
    expect(state.get('admin_shared_deck_migration_jobs/shared_deck_v2')).toMatchObject({
      phase: 'sealed',
      inventoryDigest: 'a'.repeat(64),
      ledgerReady: false,
      manifest: expect.objectContaining({ scanStartedAt: '2026-08-24T00:00:00.000Z' }),
    });
  });

  it('reuses the durable scan context after a partial manifest seal', async () => {
    const records = Array.from({ length: 51 }, (_, index) => publicDocument(legacy(`seal-retry-${index}`, {
      category: `Category-${index}`,
    })));
    const map = new Map<string, Record<string, unknown>>(
      records.map(record => [`shared_decks/${record.id}`, record.data] as const),
    );
    const harness = firestoreMapDatabase(map, 2);
    const store = createFirestoreLegacySharedDeckInventoryStore(harness.database);
    const firstScan = {
      store,
      ownerUid,
      runId: 'partial-seal-run',
      revision: '7'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
    };
    await expect(createFrozenLegacySharedDeckInventory(firstScan)).rejects.toThrow('simulated transaction crash');
    expect(map.get('admin_shared_deck_migration_jobs/shared_deck_v2')).toMatchObject({
      phase: 'sealing',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
    });
    const retry = await createFrozenLegacySharedDeckInventory({
      ...firstScan,
      scanStartedAt: '2026-08-25T00:00:00.000Z',
    });
    expect(retry.scanStartedAt).toBe('2026-08-24T00:00:00.000Z');
    expect(retry.sealedManifest?.scanStartedAt).toBe('2026-08-24T00:00:00.000Z');
    expect(map.get('admin_shared_deck_migration_jobs/shared_deck_v2')).toMatchObject({ phase: 'sealed' });
  });

  it('seals a fresh null-cursor scan before allowing apply', async () => {
    const inventory = await createFrozenLegacySharedDeckInventory({
      store: pageStore([{
        publicDocuments: [publicDocument(legacy('fresh'))],
        privateDocuments: [],
        publicTerminal: true,
        privateTerminal: true,
      }]),
      ownerUid,
      runId: 'frozen-run',
      revision: 'a'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
    });

    expect(inventory.consistency).toBe('frozen');
    expect(inventory.applyEligible).toBe(true);
    expect(inventory.publicCursor).toBe('fresh');
    expect(inventory.checkpoint.publicCursor).toBe('fresh');
    expect(inventory.chainHead).toMatch(/^[a-f0-9]{64}$/);
    expect(inventory.sealedManifest).not.toHaveProperty('entries');
    expect(inventory.sealedChunks.length).toBeGreaterThan(0);
    expect(JSON.parse(buildInventoryReport(inventory)).sealedManifest).toMatchObject({
      rootDigest: inventory.sealedManifest?.rootDigest,
    });
  });

  it('rejects placeholder or unbound backup manifests', () => {
    const unsigned = {
      schemaVersion: 2 as const,
      backupObjectId: 'gs://verified-backup/owner-a/manifest.json',
      backupGeneration: '1700000000000000',
      backupDigest: 'd'.repeat(64),
      inventoryDigest: 'b'.repeat(64),
      target: 'test',
      revision: 'a'.repeat(40),
      ownerUid,
      verifiedAt: '2026-08-24T00:00:00.000Z',
    };
    const valid = {
      ...unsigned,
      signature: sign(null, canonicalLegacySharedDeckBackupManifest(unsigned), backupSigningKey).toString('base64'),
    };
    const expected = { digest: unsigned.inventoryDigest, target: unsigned.target, revision: unsigned.revision, ownerUid };
    expect(verifyLegacySharedDeckBackupManifest(valid, expected, backupVerificationKey, Date.parse(unsigned.verifiedAt))).toBe(true);
    expect(() => verifyLegacySharedDeckBackupManifest({ ...valid, backupDigest: '0'.repeat(64) }, expected, backupVerificationKey, Date.parse(unsigned.verifiedAt)))
      .toThrow(/backup/i);
    expect(() => verifyLegacySharedDeckBackupManifest({ ...valid, ownerUid: 'other-owner' }, expected, backupVerificationKey, Date.parse(unsigned.verifiedAt)))
      .toThrow(/backup/i);
  });

  it('requires a detached Ed25519 signature over the immutable backup manifest', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const unsigned = {
      schemaVersion: 2 as const,
      backupObjectId: 'gs://verified-backup/owner-a/manifest.json',
      backupGeneration: '1700000000000000',
      backupDigest: 'b'.repeat(64),
      inventoryDigest: 'c'.repeat(64),
      target: 'test',
      revision: 'a'.repeat(40),
      ownerUid,
      verifiedAt: '2026-08-24T00:00:00.000Z',
    };
    const signature = sign(null, canonicalLegacySharedDeckBackupManifest(unsigned), privateKey).toString('base64');
    const manifest = { ...unsigned, signature };
    expect(verifyLegacySharedDeckBackupManifest(manifest, {
      digest: unsigned.inventoryDigest,
      target: unsigned.target,
      revision: unsigned.revision,
      ownerUid,
    }, publicKey, Date.parse(unsigned.verifiedAt))).toBe(true);
    expect(() => verifyLegacySharedDeckBackupManifest({ ...manifest, target: 'changed' }, {
      digest: unsigned.inventoryDigest,
      target: unsigned.target,
      revision: unsigned.revision,
      ownerUid,
    }, publicKey, Date.parse(unsigned.verifiedAt))).toThrow(/backup/i);
    const resigned = (verifiedAt: string) => {
      const nextUnsigned = { ...unsigned, verifiedAt };
      return {
        ...nextUnsigned,
        signature: sign(null, canonicalLegacySharedDeckBackupManifest(nextUnsigned), privateKey).toString('base64'),
      };
    };
    const now = Date.parse('2026-08-24T12:00:00.000Z');
    expect(() => verifyLegacySharedDeckBackupManifest(
      resigned('2026-08-22T00:00:00.000Z'),
      { digest: unsigned.inventoryDigest, target: unsigned.target, revision: unsigned.revision, ownerUid },
      publicKey,
      now,
    )).toThrow(/backup/i);
    expect(() => verifyLegacySharedDeckBackupManifest(
      resigned('2026-08-26T00:00:00.000Z'),
      { digest: unsigned.inventoryDigest, target: unsigned.target, revision: unsigned.revision, ownerUid },
      publicKey,
      now,
    )).toThrow(/backup/i);
    expect(() => verifyLegacySharedDeckBackupManifest(
      { ...manifest, signature: Buffer.from('bad-signature').toString('base64') },
      { digest: unsigned.inventoryDigest, target: unsigned.target, revision: unsigned.revision, ownerUid },
      publicKey,
      now,
    )).toThrow(/backup/i);
  });

  it('applies a frozen owner atomically, preserves IDs and payload digest, and retries as a no-op', async () => {
    const inventory = await createFrozenLegacySharedDeckInventory({
      store: pageStore([{
        publicDocuments: [publicDocument(legacy('apply-me'))],
        privateDocuments: [],
        publicTerminal: true,
        privateTerminal: true,
      }]),
      ownerUid,
      runId: 'apply-run',
      revision: 'b'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
    });
    const data = new Map<string, Record<string, unknown>>([
      ['admin_shared_deck_migration_jobs/shared_deck_v2', {
        schemaVersion: 2,
        ownerUid,
        phase: 'sealed',
        revision: inventory.revision,
        inventoryDigest: inventory.inventoryDigest,
        ledgerReady: false,
        manifest: inventory.sealedManifest,
      }],
      ['shared_decks/apply-me', inventory.entries[0] ? (legacy('apply-me').publicData as Record<string, unknown>) : {}],
    ]);
    expect(digestCanonicalValue(data.get('admin_shared_deck_migration_jobs/shared_deck_v2')!.manifest))
      .toBe(digestCanonicalValue(inventory.sealedManifest));
    const writes: Array<{ method: string; path: string; value: Record<string, unknown> }> = [];
    const snapshotFor = (path: string) => ({
      exists: data.has(path),
      data: () => data.get(path),
    });
    const ref = (path: string) => ({ path, id: path.split('/').at(-1)!, collection: (name: string) => ({
      doc: (id: string) => ref(`${path}/${name}/${id}`),
    }) });
    const database = {
      collection: (name: string) => ({
        doc: (id: string) => ref(`${name}/${id}`),
      }),
      runTransaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
        get: async (document: { path: string }) => snapshotFor(document.path),
        create: (document: { path: string }, value: Record<string, unknown>) => {
          data.set(document.path, value);
          writes.push({ method: 'create', path: document.path, value });
        },
        set: (document: { path: string }, value: Record<string, unknown>) => {
          data.set(document.path, value);
          writes.push({ method: 'set', path: document.path, value });
        },
      }),
    } as never;
    const backupManifest = signedBackupManifest(inventory);
    const first = await applyLegacySharedDeckMigration(database, inventory, {
      ownerUid,
      revision: inventory.revision,
      target: inventory.target,
      confirmation: 'APPLY_SHARED_DECK_V2',
      backupManifest,
      backupPublicKey: backupVerificationKey,
      indexPreparation: preparedIndexes(inventory),
    });
    expect(first.migratedShareIds).toEqual(['apply-me']);
    expect(data.get('shared_decks/apply-me')).toMatchObject({ schemaVersion: 2 });
    expect(data.get('shared_decks/apply-me')).not.toHaveProperty('authorUid');
    expect(data.get('shared_deck_owners/apply-me')).toMatchObject({ ownerUid, schemaVersion: 2 });
    expect((data.get('shared_deck_owners/apply-me')?.expiresAt as Timestamp).toMillis())
      .toBe(Date.parse('2026-08-24T00:00:00.000Z') + 30 * 24 * 60 * 60 * 1_000);
    expect(classifyLegacyShare({ shareId: 'apply-me', publicData: data.get('shared_decks/apply-me') }, ownerUid).payloadDigest)
      .toBe(inventory.entries[0]?.payloadDigest);
    expect(data.get(`users/${ownerUid}/profile/shared_deck_usage`)).toMatchObject({
      schemaVersion: 1,
      activeCount: 1,
      activeBytes: inventory.entries[0]?.payloadBytes,
    });
    expect(writes.filter(write => write.path === 'shared_decks/apply-me')).toHaveLength(1);

    const staleIndexReport = {
      ...preparedIndexes(inventory).report,
      completedAt: '2020-01-01T00:00:00.000Z',
    };
    await expect(applyLegacySharedDeckMigration(database, inventory, {
      ownerUid,
      revision: inventory.revision,
      target: inventory.target,
      confirmation: 'APPLY_SHARED_DECK_V2',
      backupManifest,
      backupPublicKey: backupVerificationKey,
      indexPreparation: {
        workflowRunId: '123',
        reportSha256: digestCanonicalValue(staleIndexReport),
        report: staleIndexReport,
      },
    })).rejects.toBeInstanceOf(LegacySharedDeckApplyError);

    const appliedPublic = data.get('shared_decks/apply-me')!;
    const appliedPrivate = data.get('shared_deck_owners/apply-me')!;
    data.set('shared_decks/apply-me', { ...appliedPublic, createdAt: Timestamp.fromMillis(1_700_000_001_000) });
    await expect(applyLegacySharedDeckMigration(database, inventory, {
      ownerUid, revision: inventory.revision, target: inventory.target,
      confirmation: 'APPLY_SHARED_DECK_V2', backupManifest, backupPublicKey: backupVerificationKey,
      indexPreparation: preparedIndexes(inventory),
    })).rejects.toBeInstanceOf(LegacySharedDeckApplyError);
    data.set('shared_decks/apply-me', appliedPublic);
    data.set('shared_deck_owners/apply-me', { ...appliedPrivate, createdAt: Timestamp.fromMillis(1_700_000_001_000) });
    await expect(applyLegacySharedDeckMigration(database, inventory, {
      ownerUid, revision: inventory.revision, target: inventory.target,
      confirmation: 'APPLY_SHARED_DECK_V2', backupManifest, backupPublicKey: backupVerificationKey,
      indexPreparation: preparedIndexes(inventory),
    })).rejects.toBeInstanceOf(LegacySharedDeckApplyError);
    data.set('shared_deck_owners/apply-me', appliedPrivate);

    const writesBeforeRetry = writes.length;
    const retry = await applyLegacySharedDeckMigration(database, inventory, {
      ownerUid,
      revision: inventory.revision,
      target: inventory.target,
      confirmation: 'APPLY_SHARED_DECK_V2',
      backupManifest,
      backupPublicKey: backupVerificationKey,
      indexPreparation: preparedIndexes(inventory),
    });
    expect(retry.migratedShareIds).toEqual([]);
    expect(retry.quarantinedShareIds).toEqual([]);
    expect(writes).toHaveLength(writesBeforeRetry);
  });

  it('rehydrates the sealed scan for a later apply without using a new clock', async () => {
    const inventory = await createFrozenLegacySharedDeckInventory({
      store: pageStore([{
        publicDocuments: [publicDocument(legacy('rehydrate-me'))],
        privateDocuments: [],
        publicTerminal: true,
        privateTerminal: true,
      }]),
      ownerUid,
      runId: 'rehydrate-run',
      revision: 'd'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
    });
    const sealedState = {
      schemaVersion: 2,
      ownerUid,
      phase: 'sealed',
      revision: inventory.revision,
      target: inventory.target,
      scanStartedAt: inventory.scanStartedAt,
      inventoryDigest: inventory.inventoryDigest,
      ledgerReady: false,
      manifest: inventory.sealedManifest,
    };
    const map = new Map<string, Record<string, unknown>>([
      ['admin_shared_deck_migration_jobs/shared_deck_v2', sealedState],
      ...inventory.sealedChunks.map(chunk => [
        `admin_shared_deck_migration_jobs/shared_deck_v2/sealed_manifest_chunks/${chunk.chunkNamespace}-${chunk.index}`,
        chunk as unknown as Record<string, unknown>,
      ] as const),
      ['shared_decks/rehydrate-me', legacy('rehydrate-me').publicData as Record<string, unknown>],
    ]);
    const { database } = firestoreMapDatabase(map);
    const rehydrated = await readSealedLegacySharedDeckInventory(database, {
      ownerUid,
      revision: inventory.revision,
      target: inventory.target,
    });
    expect(rehydrated.scanStartedAt).toBe(inventory.scanStartedAt);
    expect(rehydrated.inventoryDigest).toBe(inventory.inventoryDigest);
    expect(rehydrated.sealedManifest).toEqual(inventory.sealedManifest);
    const applied = await applyLegacySharedDeckMigration(database, rehydrated, {
      ownerUid,
      revision: inventory.revision,
      target: inventory.target,
      confirmation: 'APPLY_SHARED_DECK_V2',
      backupManifest: signedBackupManifest(rehydrated),
      backupPublicKey: backupVerificationKey,
      indexPreparation: preparedIndexes(rehydrated),
      now: Timestamp.fromMillis(Date.parse('2026-08-24T12:00:00.000Z')),
    });
    expect(applied.migratedShareIds).toEqual(['rehydrate-me']);
  });

  it('preserves the sealed over-cap decision when rehydrating later', async () => {
    const records = Array.from({ length: 101 }, (_, index) => publicDocument(legacy(`duplicate-${index}`)));
    const inventory = await createFrozenLegacySharedDeckInventory({
      store: pageStore([{ publicDocuments: records, privateDocuments: [], publicTerminal: true, privateTerminal: true }]),
      ownerUid,
      runId: 'over-cap-rehydrate-run',
      revision: '9'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
    });
    expect(inventory.quota.overCap).toBe(true);
    expect(inventory.applyEligible).toBe(false);
    const map = new Map<string, Record<string, unknown>>([
      ['admin_shared_deck_migration_jobs/shared_deck_v2', {
        schemaVersion: 2, ownerUid, phase: 'sealed', revision: inventory.revision,
        target: inventory.target, inventoryDigest: inventory.inventoryDigest, ledgerReady: false,
        manifest: inventory.sealedManifest,
      }],
      ...inventory.sealedChunks.map(chunk => [
        `admin_shared_deck_migration_jobs/shared_deck_v2/sealed_manifest_chunks/${chunk.chunkNamespace}-${chunk.index}`,
        chunk as unknown as Record<string, unknown>,
      ] as const),
    ]);
    const { database } = firestoreMapDatabase(map);
    const rehydrated = await readSealedLegacySharedDeckInventory(database, {
      ownerUid, revision: inventory.revision, target: inventory.target,
    });
    expect(rehydrated.quota).toEqual(inventory.quota);
    expect(rehydrated.applyEligible).toBe(false);
    await expect(applyLegacySharedDeckMigration(database, rehydrated, {
      ownerUid, revision: inventory.revision, target: inventory.target,
      confirmation: 'APPLY_SHARED_DECK_V2', backupManifest: signedBackupManifest(rehydrated),
      backupPublicKey: backupVerificationKey,
      indexPreparation: preparedIndexes(rehydrated),
    })).rejects.toBeInstanceOf(LegacySharedDeckApplyError);
  });

  it('resumes after a committed batch crash and makes the final ledger transition idempotently', async () => {
    const inventory = await createFrozenLegacySharedDeckInventory({
      store: pageStore([{
        publicDocuments: [publicDocument(legacy('crash-resume'))],
        privateDocuments: [],
        publicTerminal: true,
        privateTerminal: true,
      }]),
      ownerUid,
      runId: 'crash-run',
      revision: 'e'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
    });
    const map = new Map<string, Record<string, unknown>>([
      ['admin_shared_deck_migration_jobs/shared_deck_v2', {
        schemaVersion: 2, ownerUid, phase: 'sealed', revision: inventory.revision,
        target: inventory.target, inventoryDigest: inventory.inventoryDigest, ledgerReady: false,
        manifest: inventory.sealedManifest,
      }],
      ['shared_decks/crash-resume', legacy('crash-resume').publicData as Record<string, unknown>],
    ]);
    const { database } = firestoreMapDatabase(map, 4);
    const backupManifest = signedBackupManifest(inventory);
    await expect(applyLegacySharedDeckMigration(database, inventory, {
      ownerUid, revision: inventory.revision, target: inventory.target,
      confirmation: 'APPLY_SHARED_DECK_V2', backupManifest, backupPublicKey: backupVerificationKey,
      indexPreparation: preparedIndexes(inventory),
    })).rejects.toThrow('simulated transaction crash');
    expect(map.get('admin_shared_deck_migration_jobs/shared_deck_v2')).toMatchObject({
      phase: 'applying', progress: { nextEntry: 1 },
    });
    const resumed = await applyLegacySharedDeckMigration(database, inventory, {
      ownerUid, revision: inventory.revision, target: inventory.target,
      confirmation: 'APPLY_SHARED_DECK_V2', backupManifest, backupPublicKey: backupVerificationKey,
      indexPreparation: preparedIndexes(inventory),
    });
    expect(resumed.migratedShareIds).toEqual([]);
    expect(map.get('admin_shared_deck_migration_jobs/shared_deck_v2')).toMatchObject({
      phase: 'applied', ledgerReady: true,
    });
  });

  it('splits a valid multi-megabyte inventory into bounded apply transactions', async () => {
    const largeCards = (deckIndex: number) => Array.from({ length: 50 }, (_, cardIndex) => ({
      ...card,
      word: `large-${deckIndex}-${cardIndex}`,
      translation: 't'.repeat(256),
      explanation: 'e'.repeat(2_048),
      explanationTranslation: 'x'.repeat(2_048),
      phonetic: 'p'.repeat(256),
      exampleSentence: 's'.repeat(2_048),
      exampleTranslation: 'y'.repeat(2_048),
      commonMistake: 'm'.repeat(2_048),
      register: 'r'.repeat(64),
    }));
    const records = Array.from({ length: 22 }, (_, index) => publicDocument(legacy(`large-${index}`, {
      cards: largeCards(index),
    })));
    const inventory = await createFrozenLegacySharedDeckInventory({
      store: pageStore([{ publicDocuments: records, privateDocuments: [], publicTerminal: true, privateTerminal: true }]),
      ownerUid,
      runId: 'large-run',
      revision: '1'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
    });
    expect(inventory.quota.overCap).toBe(false);
    expect(inventory.totalPayloadBytes).toBeGreaterThan(10 * 1024 * 1024);
    expect(inventory.sealedChunks.length).toBeGreaterThanOrEqual(1);
    for (const chunk of inventory.sealedChunks) {
      expect(chunk.entries.length).toBeLessThanOrEqual(MAX_SEALED_MANIFEST_CHUNK_ENTRIES);
      expect(canonicalUtf8Bytes(chunk).byteLength).toBeLessThanOrEqual(MAX_SEALED_MANIFEST_CHUNK_BYTES);
    }
    const map = new Map<string, Record<string, unknown>>([
      ['admin_shared_deck_migration_jobs/shared_deck_v2', {
        schemaVersion: 2, ownerUid, phase: 'sealed', revision: inventory.revision,
        target: inventory.target, inventoryDigest: inventory.inventoryDigest, ledgerReady: false,
        manifest: inventory.sealedManifest,
      }],
      ...records.map(record => [`shared_decks/${record.id}`, record.data] as const),
    ]);
    const harness = firestoreMapDatabase(map);
    await applyLegacySharedDeckMigration(harness.database, inventory, {
      ownerUid, revision: inventory.revision, target: inventory.target,
      confirmation: 'APPLY_SHARED_DECK_V2', backupManifest: signedBackupManifest(inventory),
      backupPublicKey: backupVerificationKey,
      indexPreparation: preparedIndexes(inventory),
    });
    expect(harness.transactionCount).toBeGreaterThan(4);
    expect(map.get('admin_shared_deck_migration_jobs/shared_deck_v2')).toMatchObject({ phase: 'applied' });
  });

  it('copies duplicate records to server quarantine and verifies them before cutover', async () => {
    const duplicate = await createFrozenLegacySharedDeckInventory({
      store: pageStore([{
        publicDocuments: [publicDocument(legacy('duplicate-a')), publicDocument(legacy('duplicate-b'))],
        privateDocuments: [],
        publicTerminal: true,
        privateTerminal: true,
      }]),
      ownerUid,
      runId: 'duplicate-run',
      revision: 'f'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
    });
    expect(duplicate.entries.every(entry => entry.payloadEquivalent)).toBe(true);
    const map = new Map<string, Record<string, unknown>>([
      ['admin_shared_deck_migration_jobs/shared_deck_v2', {
        schemaVersion: 2, ownerUid, phase: 'sealed', revision: duplicate.revision,
        target: duplicate.target, inventoryDigest: duplicate.inventoryDigest, ledgerReady: false,
        manifest: duplicate.sealedManifest,
      }],
      ['shared_decks/duplicate-a', legacy('duplicate-a').publicData as Record<string, unknown>],
      ['shared_decks/duplicate-b', legacy('duplicate-b').publicData as Record<string, unknown>],
    ]);
    const { database } = firestoreMapDatabase(map);
    const backupManifest = signedBackupManifest(duplicate);
    await applyLegacySharedDeckMigration(database, duplicate, {
      ownerUid, revision: duplicate.revision, target: duplicate.target,
      confirmation: 'APPLY_SHARED_DECK_V2', backupManifest, backupPublicKey: backupVerificationKey,
      indexPreparation: preparedIndexes(duplicate),
    });
    expect(map.has('admin_shared_deck_migration_quarantine/duplicate-a')).toBe(true);
    map.set('shared_decks/duplicate-a', {
      ...(legacy('duplicate-a').publicData as Record<string, unknown>),
      category: 'changed-after-seal',
    });
    await expect(verifyLegacySharedDeckCutover(database, duplicate)).rejects.toBeInstanceOf(LegacySharedDeckApplyError);
    map.set('shared_decks/duplicate-a', legacy('duplicate-a').publicData as Record<string, unknown>);
    const verification = await verifyLegacySharedDeckCutover(database, duplicate);
    expect(verification).toMatchObject({ verified: true, validLegacyPublicCount: 0, activeLedgerCount: 0 });
    const firstReport = buildLegacySharedDeckMigrationOperatorReport(duplicate, verification);
    const rerunVerification = await verifyLegacySharedDeckCutover(database, duplicate);
    expect(rerunVerification).toEqual(verification);
    expect(buildLegacySharedDeckMigrationOperatorReport(duplicate, rerunVerification)).toBe(firstReport);
    expect(JSON.parse(firstReport)).toMatchObject({
      migratedCount: 0,
      quarantinedCount: 2,
      sealedManifestRootDigest: duplicate.sealedManifest?.rootDigest,
    });
    expect(map.get('admin_shared_deck_migration_jobs/shared_deck_v2')).toMatchObject({ phase: 'verified' });
  });

  it('quarantines digestable malformed public records without deleting their source', async () => {
    const malformed = legacy('malformed-copyable', { unexpected: 'preserve-raw' });
    const inventory = await createFrozenLegacySharedDeckInventory({
      store: pageStore([{
        publicDocuments: [publicDocument(malformed)], privateDocuments: [],
        publicTerminal: true, privateTerminal: true,
      }]),
      ownerUid,
      runId: 'malformed-quarantine-run',
      revision: '8'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
    });
    expect(inventory.entries[0]).toMatchObject({ action: 'quarantine', disposition: 'quarantine-candidate' });
    const source = malformed.publicData as Record<string, unknown>;
    const map = new Map<string, Record<string, unknown>>([
      ['admin_shared_deck_migration_jobs/shared_deck_v2', {
        schemaVersion: 2, ownerUid, phase: 'sealed', revision: inventory.revision,
        target: inventory.target, inventoryDigest: inventory.inventoryDigest, ledgerReady: false,
        manifest: inventory.sealedManifest,
      }],
      ['shared_decks/malformed-copyable', source],
    ]);
    const { database } = firestoreMapDatabase(map);
    await applyLegacySharedDeckMigration(database, inventory, {
      ownerUid, revision: inventory.revision, target: inventory.target,
      confirmation: 'APPLY_SHARED_DECK_V2', backupManifest: signedBackupManifest(inventory),
      backupPublicKey: backupVerificationKey,
      indexPreparation: preparedIndexes(inventory),
    });
    expect(map.get('shared_decks/malformed-copyable')).toEqual(source);
    expect(map.get('admin_shared_deck_migration_quarantine/malformed-copyable')).toMatchObject({
      schemaVersion: 2, ownerUid, reasonCode: 'malformed-public',
      publicData: source, privateData: null,
    });
    await expect(verifyLegacySharedDeckCutover(database, inventory)).resolves.toMatchObject({ verified: true });
  });

  it('rejects a missing public or private side during the sealed-ID verification pass', async () => {
    for (const missing of ['public', 'private'] as const) {
      const shareId = `missing-${missing}-sealed-pass`;
      const inventory = await createFrozenLegacySharedDeckInventory({
        store: pageStore([{
          publicDocuments: [publicDocument(legacy(shareId))],
          privateDocuments: [],
          publicTerminal: true,
          privateTerminal: true,
        }]),
        ownerUid,
        runId: `missing-${missing}-run`,
        revision: missing === 'public' ? '4'.repeat(40) : '5'.repeat(40),
        target: 'test',
        scanStartedAt: '2026-08-24T00:00:00.000Z',
      });
      const map = new Map<string, Record<string, unknown>>([
        ['admin_shared_deck_migration_jobs/shared_deck_v2', {
          schemaVersion: 2, ownerUid, phase: 'sealed', revision: inventory.revision,
          target: inventory.target, inventoryDigest: inventory.inventoryDigest, ledgerReady: false,
          manifest: inventory.sealedManifest,
        }],
        [`shared_decks/${shareId}`, legacy(shareId).publicData as Record<string, unknown>],
      ]);
      const harness = firestoreMapDatabase(map);
      await applyLegacySharedDeckMigration(harness.database, inventory, {
        ownerUid, revision: inventory.revision, target: inventory.target,
        confirmation: 'APPLY_SHARED_DECK_V2', backupManifest: signedBackupManifest(inventory),
        backupPublicKey: backupVerificationKey, indexPreparation: preparedIndexes(inventory),
      });
      map.set('admin_shared_deck_migration_jobs/shared_deck_v2', {
        ...(map.get('admin_shared_deck_migration_jobs/shared_deck_v2') as Record<string, unknown>),
        verificationProgress: {
          active: true, publicCursor: shareId, privateCursor: shareId,
          publicTerminal: true, privateTerminal: true, sealedCursor: 0, validLegacyPublicCount: 0,
        },
      });
      map.delete(missing === 'public' ? `shared_decks/${shareId}` : `shared_deck_owners/${shareId}`);
      await expect(verifyLegacySharedDeckCutover(harness.database, inventory))
        .rejects.toBeInstanceOf(LegacySharedDeckApplyError);
    }
  });

  it('splits several large copy-only quarantine envelopes below the transaction bound', async () => {
    const records = Array.from({ length: 16 }, (_, index) => publicDocument(legacy(`large-malformed-${index}`, {
      unexpected: 'q'.repeat(180 * 1024),
    })));
    const inventory = await createFrozenLegacySharedDeckInventory({
      store: pageStore([{ publicDocuments: records, privateDocuments: [], publicTerminal: true, privateTerminal: true }]),
      ownerUid,
      runId: 'large-quarantine-run',
      revision: '3'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
    });
    expect(inventory.entries.every(entry => entry.action === 'quarantine')).toBe(true);
    expect(inventory.entries.every(entry => (entry.publicSourceBytes ?? 0) > 180 * 1024)).toBe(true);
    const map = new Map<string, Record<string, unknown>>([
      ['admin_shared_deck_migration_jobs/shared_deck_v2', {
        schemaVersion: 2, ownerUid, phase: 'sealed', revision: inventory.revision,
        target: inventory.target, inventoryDigest: inventory.inventoryDigest, ledgerReady: false,
        manifest: inventory.sealedManifest,
      }],
      ...records.map(record => [`shared_decks/${record.id}`, record.data] as const),
    ]);
    const harness = firestoreMapDatabase(map);
    await applyLegacySharedDeckMigration(harness.database, inventory, {
      ownerUid,
      revision: inventory.revision,
      target: inventory.target,
      confirmation: 'APPLY_SHARED_DECK_V2',
      backupManifest: signedBackupManifest(inventory),
      backupPublicKey: backupVerificationKey,
      indexPreparation: preparedIndexes(inventory),
    });
    // The conservative source/envelope/index estimate must create multiple
    // bounded batches, while every raw source remains copy-only and present.
    expect(harness.transactionCount).toBeGreaterThan(4);
    for (const record of records) {
      expect(map.get(`shared_decks/${record.id}`)).toEqual(record.data);
      expect(map.get(`admin_shared_deck_migration_quarantine/${record.id}`)).toBeDefined();
    }
  });

  it('resumes cutover verification from a durable page cursor after a crash', async () => {
    const records = Array.from({ length: 3 }, (_, index) => publicDocument(legacy(`verify-crash-${index}`, {
      category: `Verify-${index}`,
    })));
    const inventory = await createFrozenLegacySharedDeckInventory({
      store: pageStore([{ publicDocuments: records, privateDocuments: [], publicTerminal: true, privateTerminal: true }]),
      ownerUid,
      runId: 'verify-crash-run',
      revision: '6'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
    });
    const map = new Map<string, Record<string, unknown>>([
      ['admin_shared_deck_migration_jobs/shared_deck_v2', {
        schemaVersion: 2, ownerUid, phase: 'sealed', revision: inventory.revision,
        target: inventory.target, inventoryDigest: inventory.inventoryDigest, ledgerReady: false,
        manifest: inventory.sealedManifest,
      }],
      ...records.map(record => [`shared_decks/${record.id}`, record.data] as const),
    ]);
    const applyHarness = firestoreMapDatabase(map);
    await applyLegacySharedDeckMigration(applyHarness.database, inventory, {
      ownerUid, revision: inventory.revision, target: inventory.target,
      confirmation: 'APPLY_SHARED_DECK_V2', backupManifest: signedBackupManifest(inventory),
      backupPublicKey: backupVerificationKey,
      indexPreparation: preparedIndexes(inventory),
    });
    // Transactions 1-5 seal the initial progress and both source pages; the
    // sixth transaction commits the first sealed-ID batch before the worker
    // crashes. The durable sealedCursor must make the retry resume at batch 2.
    const verifyHarness = firestoreMapDatabase(map, 6);
    await expect(verifyLegacySharedDeckCutover(verifyHarness.database, inventory)).rejects.toThrow('simulated transaction crash');
    expect(map.get('admin_shared_deck_migration_jobs/shared_deck_v2')).toMatchObject({
      phase: 'applied', verificationProgress: {
        active: true, publicCursor: 'verify-crash-2', sealedCursor: 2,
      },
    });
    // The operator retries apply before verify. Once the durable phase is
    // applied, this call must validate only and leave the active cursor intact.
    await applyLegacySharedDeckMigration(verifyHarness.database, inventory, {
      ownerUid, revision: inventory.revision, target: inventory.target,
      confirmation: 'APPLY_SHARED_DECK_V2', backupManifest: signedBackupManifest(inventory),
      backupPublicKey: backupVerificationKey, indexPreparation: preparedIndexes(inventory),
    });
    expect(map.get('admin_shared_deck_migration_jobs/shared_deck_v2')).toMatchObject({
      phase: 'applied', verificationProgress: { active: true, sealedCursor: 2 },
    });
    const resumedVerification = await verifyLegacySharedDeckCutover(verifyHarness.database, inventory);
    const resumedReport = buildLegacySharedDeckMigrationOperatorReport(inventory, resumedVerification);
    expect(resumedVerification).toMatchObject({ verified: true });
    const resumedAgain = await verifyLegacySharedDeckCutover(verifyHarness.database, inventory);
    expect(buildLegacySharedDeckMigrationOperatorReport(inventory, resumedAgain)).toBe(resumedReport);
    expect(map.get('admin_shared_deck_migration_jobs/shared_deck_v2')).toMatchObject({
      phase: 'verified', verificationProgress: { active: false },
    });
  });

  it('aborts on a source digest change before emitting any valid-data write', async () => {
    const inventory = await createFrozenLegacySharedDeckInventory({
      store: pageStore([{
        publicDocuments: [publicDocument(legacy('changed'))],
        privateDocuments: [],
        publicTerminal: true,
        privateTerminal: true,
      }]),
      ownerUid,
      runId: 'changed-run',
      revision: 'c'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
    });
    const data = new Map<string, Record<string, unknown>>([
      ['admin_shared_deck_migration_jobs/shared_deck_v2', {
        schemaVersion: 2, ownerUid, phase: 'sealed', revision: inventory.revision,
        inventoryDigest: inventory.inventoryDigest, ledgerReady: false,
        manifest: inventory.sealedManifest,
      }],
      ['shared_decks/changed', { ...(legacy('changed').publicData as Record<string, unknown>), category: 'changed' }],
    ]);
    const writes: string[] = [];
    const ref = (path: string) => ({ path, id: path.split('/').at(-1)!, collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }) });
    const database = {
      collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
      runTransaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
        get: async (document: { path: string }) => ({ exists: data.has(document.path), data: () => data.get(document.path) }),
        create: (document: { path: string }) => writes.push(document.path),
        set: (document: { path: string }) => writes.push(document.path),
      }),
    } as never;
    const backupManifest = signedBackupManifest(inventory);
    await expect(applyLegacySharedDeckMigration(database, inventory, {
      ownerUid, revision: inventory.revision, target: inventory.target,
      confirmation: 'APPLY_SHARED_DECK_V2', backupManifest, backupPublicKey: backupVerificationKey,
      indexPreparation: preparedIndexes(inventory),
    })).rejects.toBeInstanceOf(LegacySharedDeckApplyError);
    expect(writes).toEqual([]);
  });

  it('aborts on a pre-existing mismatched ledger before advancing any source', async () => {
    const inventory = await createFrozenLegacySharedDeckInventory({
      store: pageStore([{
        publicDocuments: [publicDocument(legacy('ledger-mismatch'))],
        privateDocuments: [],
        publicTerminal: true,
        privateTerminal: true,
      }]),
      ownerUid,
      runId: 'ledger-mismatch-run',
      revision: '2'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
    });
    const map = new Map<string, Record<string, unknown>>([
      ['admin_shared_deck_migration_jobs/shared_deck_v2', {
        schemaVersion: 2, ownerUid, phase: 'sealed', revision: inventory.revision,
        target: inventory.target, inventoryDigest: inventory.inventoryDigest, ledgerReady: false,
        manifest: inventory.sealedManifest,
      }],
      ['shared_decks/ledger-mismatch', legacy('ledger-mismatch').publicData as Record<string, unknown>],
      [`users/${ownerUid}/profile/shared_deck_usage`, {
        schemaVersion: 1, shares: {}, activeCount: 99, activeBytes: 123,
      }],
    ]);
    const writes: string[] = [];
    const ref = (path: string) => ({ path, id: path.split('/').at(-1)!, collection: (name: string) => ({ doc: (id: string) => ref(`${path}/${name}/${id}`) }) });
    const database = {
      collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
      runTransaction: async (callback: (transaction: Record<string, unknown>) => Promise<unknown>) => callback({
        get: async (document: { path: string }) => ({ exists: map.has(document.path), data: () => map.get(document.path) }),
        create: (document: { path: string }) => writes.push(document.path),
        set: (document: { path: string }) => writes.push(document.path),
      }),
    } as never;
    await expect(applyLegacySharedDeckMigration(database, inventory, {
      ownerUid, revision: inventory.revision, target: inventory.target,
      confirmation: 'APPLY_SHARED_DECK_V2', backupManifest: signedBackupManifest(inventory),
      backupPublicKey: backupVerificationKey,
      indexPreparation: preparedIndexes(inventory),
    })).rejects.toBeInstanceOf(LegacySharedDeckApplyError);
    expect(writes).toEqual([]);
  });

  it('rejects an over-cap owner before opening an apply transaction', async () => {
    const records = Array.from({ length: 101 }, (_, index) => publicDocument(legacy(`over-${index}`)));
    const pages: TestPage[] = [];
    for (let index = 0; index < records.length; index += 10) {
      const page = records.slice(index, index + 10);
      pages.push({ publicDocuments: page, privateDocuments: [] });
    }
    const inventory = await createFrozenLegacySharedDeckInventory({
      store: pageStore(pages),
      ownerUid,
      runId: 'over-cap-run',
      revision: 'e'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
    });
    const database = {
      runTransaction: () => { throw new Error('must not open apply transaction'); },
    } as never;
    await expect(applyLegacySharedDeckMigration(database, inventory, {
      ownerUid,
      revision: inventory.revision,
      target: inventory.target,
      confirmation: 'APPLY_SHARED_DECK_V2',
      backupManifest: {},
      backupPublicKey: backupVerificationKey,
      indexPreparation: preparedIndexes(inventory),
    })).rejects.toBeInstanceOf(LegacySharedDeckApplyError);
  });

  it('supersedes only a sealed ineligible job, preserves its audit/chunks, and permits a new revision', async () => {
    const records = Array.from({ length: 101 }, (_, index) => publicDocument(legacy(`supersede-${index}`)));
    const inventory = await createFrozenLegacySharedDeckInventory({
      store: pageStore([{ publicDocuments: records, privateDocuments: [], publicTerminal: true, privateTerminal: true }]),
      ownerUid,
      runId: 'supersede-run',
      revision: 'a'.repeat(40),
      target: 'test',
      scanStartedAt: '2026-08-24T00:00:00.000Z',
    });
    expect(inventory.applyEligible).toBe(false);
    const map = new Map<string, Record<string, unknown>>([
      ['admin_shared_deck_migration_jobs/shared_deck_v2', {
        schemaVersion: 2, ownerUid, phase: 'sealed', revision: inventory.revision,
        target: inventory.target, inventoryDigest: inventory.inventoryDigest, ledgerReady: false,
        manifest: inventory.sealedManifest,
      }],
      ...inventory.sealedChunks.map(chunk => [
        `admin_shared_deck_migration_jobs/shared_deck_v2/sealed_manifest_chunks/${chunk.chunkNamespace}-${chunk.index}`,
        chunk as unknown as Record<string, unknown>,
      ] as const),
      ['shared_decks/supersede-0', records[0]!.data],
    ]);
    const harness = firestoreMapDatabase(map);
    await expect(supersedeLegacySharedDeckMigration(harness.database, {
      ownerUid,
      revision: inventory.revision,
      target: inventory.target,
      inventoryDigest: inventory.inventoryDigest,
      rootDigest: inventory.sealedManifest!.rootDigest,
      confirmation: 'WRONG',
    })).rejects.toBeInstanceOf(LegacySharedDeckApplyError);
    await expect(supersedeLegacySharedDeckMigration(harness.database, {
      ownerUid,
      revision: inventory.revision,
      target: inventory.target,
      inventoryDigest: '0'.repeat(64),
      rootDigest: inventory.sealedManifest!.rootDigest,
      confirmation: SUPERSEDE_SHARED_DECK_CONFIRMATION,
    })).rejects.toBeInstanceOf(LegacySharedDeckApplyError);
    const result = await supersedeLegacySharedDeckMigration(harness.database, {
      ownerUid,
      revision: inventory.revision,
      target: inventory.target,
      inventoryDigest: inventory.inventoryDigest,
      rootDigest: inventory.sealedManifest!.rootDigest,
      confirmation: SUPERSEDE_SHARED_DECK_CONFIRMATION,
    });
    expect(result.superseded).toBe(true);
    expect(map.get('admin_shared_deck_migration_jobs/shared_deck_v2')).toMatchObject({ phase: 'superseded' });
    expect(map.get('shared_decks/supersede-0')).toEqual(records[0]!.data);
    expect(map.has(`admin_shared_deck_migration_jobs/shared_deck_v2/sealed_manifest_chunks/${inventory.sealedChunks[0]!.chunkNamespace}-0`)).toBe(true);
    expect(map.get(result.historyPath)).toMatchObject({
      action: 'superseded', revision: inventory.revision, inventoryDigest: inventory.inventoryDigest,
      manifest: inventory.sealedManifest,
      stateSnapshot: { phase: 'sealed', manifest: inventory.sealedManifest },
    });
    await expect(supersedeLegacySharedDeckMigration(harness.database, {
      ownerUid,
      revision: inventory.revision,
      target: inventory.target,
      inventoryDigest: inventory.inventoryDigest,
      rootDigest: inventory.sealedManifest!.rootDigest,
      confirmation: SUPERSEDE_SHARED_DECK_CONFIRMATION,
    })).resolves.toEqual(result);
    await expect(supersedeLegacySharedDeckMigration(harness.database, {
      ownerUid,
      revision: inventory.revision,
      target: inventory.target,
      inventoryDigest: inventory.inventoryDigest,
      rootDigest: 'f'.repeat(64),
      confirmation: SUPERSEDE_SHARED_DECK_CONFIRMATION,
    })).rejects.toBeInstanceOf(LegacySharedDeckApplyError);
    const store = createFirestoreLegacySharedDeckInventoryStore(harness.database);
    await expect(store.beginFreeze!({
      ownerUid, revision: 'b'.repeat(40), target: 'test', scanStartedAt: '2026-08-25T00:00:00.000Z',
    })).resolves.toEqual({ scanStartedAt: '2026-08-25T00:00:00.000Z' });
    expect(map.get('admin_shared_deck_migration_jobs/shared_deck_v2')).toMatchObject({
      phase: 'frozen', revision: 'b'.repeat(40), inventoryDigest: null,
    });
  });
});
