import { describe, expect, it } from 'vitest';
import type { CardData } from '../../types/card';
import type { AtomicCatalogPort, AtomicV2RollbackPort, MigrationAtomicDecision } from '../multilingual/migrationApplication';
import type { AtomicDocumentDecision, AtomicDocumentPort } from '../multilingual/learningStateV3Store';
import {
  applyMigrationRehearsal,
  createMigrationRehearsal,
  rollbackMigrationRehearsal,
  serializeMigrationEvidence,
} from './migrationRehearsal';

const legacyCard = (id: string, overrides: Partial<CardData> = {}): CardData => ({
  schemaVersion: 2, revision: 4, libraryEpoch: 2,
  id, word: id, normalizedWord: id, translation: `nghĩa ${id}`,
  explanation: 'Reviewed explanation.', phonetic: '', emoji: '📚', category: 'General',
  audioUrl: null, imageUrl: null, createdAt: '2026-01-01T00:00:00.000Z',
  reviews: 7, bookmarked: true,
  ...overrides,
});

class MemoryCatalog implements AtomicCatalogPort {
  readonly documents = new Map<string, unknown>();
  writes = 0;
  async createIfAbsent(path: string, value: unknown) {
    if (this.documents.has(path)) return { status: 'exists' as const, current: this.documents.get(path) };
    this.documents.set(path, value);
    this.writes += 1;
    return { status: 'created' as const };
  }
}

class MemoryDocuments implements AtomicDocumentPort {
  readonly documents = new Map<string, unknown>();
  writes = 0;
  afterWrite: (() => void) | null = null;
  async read(path: string) { return this.documents.get(path) ?? null; }
  async runAtomic<Result>(path: string, operation: (current: unknown | null) => AtomicDocumentDecision<Result>) {
    const decision = operation(this.documents.get(path) ?? null);
    if (decision.kind === 'set') {
      this.documents.set(path, decision.value);
      this.writes += 1;
      this.afterWrite?.();
    }
    return decision.result;
  }
}

class MemoryRollback implements AtomicV2RollbackPort {
  readonly documents = new Map<string, unknown>();
  writes = 0;
  async runAtomic<Result>(
    ownerId: string,
    sourceDocumentId: string,
    operation: (current: unknown | null) => MigrationAtomicDecision<Result>,
  ) {
    const path = `${ownerId}/${sourceDocumentId}`;
    const decision = operation(this.documents.get(path) ?? null);
    if (decision.kind === 'set') {
      this.documents.set(path, decision.value);
      this.writes += 1;
    }
    return decision.result;
  }
}

describe('Phase 6 migration rehearsal', () => {
  it('creates deterministic privacy-safe evidence and quarantines invalid or duplicate progress', () => {
    const input = {
      ownerId: 'owner-private', migratedAt: '2026-08-04T00:00:00.000Z',
      records: [
        { sourceDocumentId: 'card-a', senseKey: 'shared-sense', card: legacyCard('allocate') },
        { sourceDocumentId: 'card-b', senseKey: 'shared-sense', card: legacyCard('allocate') },
        { sourceDocumentId: 'card-c', card: legacyCard('missing', { word: '', normalizedWord: '' }) },
      ],
    };

    const first = createMigrationRehearsal(input);
    const second = createMigrationRehearsal(input);
    expect(first.evidence).toEqual(second.evidence);
    expect(first.evidence.counts).toEqual({ total: 3, migratable: 1, quarantined: 2, duplicateProgress: 1 });
    expect(first.evidence.rehearsalId).toMatch(/^migration-/);

    const serialized = serializeMigrationEvidence(first.evidence);
    expect(serialized).not.toContain('owner-private');
    expect(serialized).not.toContain('allocate');
    expect(serialized).not.toContain('nghĩa');
  });

  it('rejects an unbounded rehearsal before planning any record', () => {
    const records = Array.from({ length: 10_001 }, (_, index) => ({
      sourceDocumentId: `card-${index}`,
      card: legacyCard(`word-${index}`),
    }));

    expect(() => createMigrationRehearsal({
      ownerId: 'owner-a', migratedAt: '2026-08-04T00:00:00.000Z', records,
    })).toThrow(/10,000/);
  });

  it('rejects cross-owner input before opening a storage write', async () => {
    const plan = createMigrationRehearsal({
      ownerId: 'owner-a', migratedAt: '2026-08-04T00:00:00.000Z',
      records: [{ ownerId: 'owner-b', sourceDocumentId: 'card-a', card: legacyCard('allocate') }],
    });
    const catalog = new MemoryCatalog();
    const learningDocuments = new MemoryDocuments();

    await expect(applyMigrationRehearsal(plan, {
      activeOwner: () => 'owner-a', catalog, learningDocuments,
    })).resolves.toMatchObject({ status: 'rejected', reason: 'cross-owner-input' });
    expect(catalog.writes).toBe(0);
    expect(learningDocuments.writes).toBe(0);
  });

  it('applies catalog and learning state once and treats a retry as unchanged', async () => {
    const plan = createMigrationRehearsal({
      ownerId: 'owner-a', migratedAt: '2026-08-04T00:00:00.000Z',
      records: [{ sourceDocumentId: 'card-a', card: legacyCard('allocate') }],
    });
    const catalog = new MemoryCatalog();
    const learningDocuments = new MemoryDocuments();
    const ports = { activeOwner: () => 'owner-a', catalog, learningDocuments };

    await expect(applyMigrationRehearsal(plan, ports)).resolves.toMatchObject({
      status: 'completed', applied: 1, unchanged: 0, conflicts: 0,
    });
    await expect(applyMigrationRehearsal(plan, ports)).resolves.toMatchObject({
      status: 'completed', applied: 0, unchanged: 1, conflicts: 0,
    });
    expect(catalog.writes).toBe(2);
    expect(learningDocuments.writes).toBe(1);
  });

  it('stops synchronously when the active owner changes between records', async () => {
    const plan = createMigrationRehearsal({
      ownerId: 'owner-a', migratedAt: '2026-08-04T00:00:00.000Z',
      records: [
        { sourceDocumentId: 'card-a', card: legacyCard('allocate') },
        { sourceDocumentId: 'card-b', card: legacyCard('benefit') },
      ],
    });
    const catalog = new MemoryCatalog();
    const learningDocuments = new MemoryDocuments();
    let owner: string | null = 'owner-a';
    learningDocuments.afterWrite = () => { owner = 'owner-b'; };

    await expect(applyMigrationRehearsal(plan, {
      activeOwner: () => owner, catalog, learningDocuments,
    })).resolves.toMatchObject({ status: 'stale-owner', processed: 1 });
    expect(learningDocuments.writes).toBe(1);
  });

  it('rolls back only trusted current source documents and never recreates missing data', async () => {
    const original = legacyCard('allocate');
    const plan = createMigrationRehearsal({
      ownerId: 'owner-a', migratedAt: '2026-08-04T00:00:00.000Z',
      records: [
        { sourceDocumentId: 'card-a', card: original },
        { sourceDocumentId: 'card-missing', card: legacyCard('benefit') },
      ],
    });
    const rollback = new MemoryRollback();
    rollback.documents.set('owner-a/card-a', { ...original, translation: 'temporary' });

    await expect(rollbackMigrationRehearsal(plan, {
      activeOwner: () => 'owner-a', documents: rollback,
    })).resolves.toMatchObject({ status: 'completed', restored: 1, missing: 1, conflicts: 0 });
    expect((rollback.documents.get('owner-a/card-a') as CardData).translation).toBe('nghĩa allocate');
    expect(rollback.writes).toBe(1);
  });
});
