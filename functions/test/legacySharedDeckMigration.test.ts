import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { calculateSharedDeckPayloadBytes } from '../src/inputValidation.js';
import { createFirestoreLegacySharedDeckInventoryStore } from '../src/legacySharedDeckInventoryFirestore.js';
import {
  buildInventoryReport,
  classifyLegacyShare,
  createLegacySharedDeckInventory,
  digestCanonicalValue,
  hashOwnerKey,
  type LegacySharedDeckRecord,
  type LegacySharedDeckInventoryStore,
} from '../src/legacySharedDeckMigration.js';
import { validateLegacySharedDeckOperatorEnvironment } from '../src/legacySharedDeckMigrationOperator.js';

const ownerUid = 'protected-owner';
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

  it('rejects malformed and non-lossless source values', () => {
    expect(classifyLegacyShare(legacy('extra', { unexpected: true }), ownerUid)).toMatchObject({
      disposition: 'block',
      reasonCode: 'malformed-public',
    });
    expect(classifyLegacyShare(legacy('nan', { cards: [{ ...card, score: Number.NaN }] }), ownerUid)).toMatchObject({
      disposition: 'block',
      reasonCode: 'unsupported-value',
    });
    expect(classifyLegacyShare(legacy('empty', { cards: [] }), ownerUid)).toMatchObject({
      disposition: 'block',
      reasonCode: 'empty-public',
    });
    expect(classifyLegacyShare(legacy('card-extra', {
      cards: [{ ...card, unknownField: 'reject' }],
    }), ownerUid)).toMatchObject({
      disposition: 'block',
      reasonCode: 'malformed-public',
    });
    expect(classifyLegacyShare(legacy('released-card-lossy', {
      cards: [{ ...releasedCard, word: ' hello ' }],
    }), ownerUid)).toMatchObject({
      disposition: 'block',
      reasonCode: 'malformed-public',
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
});
