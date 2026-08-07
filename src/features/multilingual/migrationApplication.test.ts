import { describe, expect, it } from 'vitest';
import type { CardData } from '../../types/card';
import {
  applyCatalogMigration,
  applyV2Rollback,
  type AtomicCatalogPort,
  type AtomicV2RollbackPort,
  type MigrationAtomicDecision,
} from './migrationApplication';
import { planV2CardMigration } from './v2Migration';

const card: CardData = {
  schemaVersion: 2, revision: 4, libraryEpoch: 2,
  id: 'word-allocate', word: 'allocate', normalizedWord: 'allocate', translation: 'phân bổ',
  explanation: 'Distribute resources.', phonetic: '', emoji: '📊', category: 'Business',
  audioUrl: null, imageUrl: null, createdAt: '2026-01-01T00:00:00.000Z',
};

const bundle = () => planV2CardMigration({
  ownerId: 'owner-a', sourceDocumentId: 'word-allocate', card,
  migratedAt: '2026-08-03T00:00:00.000Z',
});

class MemoryCatalogPort implements AtomicCatalogPort {
  readonly documents = new Map<string, unknown>();
  readonly sets: string[] = [];

  async createIfAbsent(path: string, value: unknown) {
    if (this.documents.has(path)) return { status: 'exists' as const, current: this.documents.get(path) };
    this.documents.set(path, value);
    this.sets.push(path);
    return { status: 'created' as const };
  }
}

class MemoryRollbackPort implements AtomicV2RollbackPort {
  current: unknown | null;
  writes = 0;

  constructor(current: unknown | null) {
    this.current = current;
  }

  async runAtomic<Result>(
    _ownerId: string,
    _sourceDocumentId: string,
    operation: (current: unknown | null) => MigrationAtomicDecision<Result>,
  ): Promise<Result> {
    const decision = operation(this.current);
    if (decision.kind === 'set') {
      this.current = decision.value;
      this.writes += 1;
    }
    return decision.result;
  }
}

describe('applyCatalogMigration', () => {
  it('creates catalog entities once and treats an identical retry as idempotent', async () => {
    const port = new MemoryCatalogPort();
    const migration = bundle();

    await expect(applyCatalogMigration(migration, port)).resolves.toMatchObject({ status: 'applied' });
    await expect(applyCatalogMigration(migration, port)).resolves.toMatchObject({ status: 'unchanged' });
    expect(port.sets).toHaveLength(2);
  });

  it('returns a conflict and never overwrites an existing lexeme with different content', async () => {
    const port = new MemoryCatalogPort();
    const migration = bundle();
    port.documents.set(`lexemes/${migration.lexeme.id}`, {
      ...migration.lexeme,
      compatibility: { ...migration.lexeme.compatibility, translation: 'khác' },
    });

    await expect(applyCatalogMigration(migration, port)).resolves.toMatchObject({
      status: 'conflict', entity: 'lexeme', id: migration.lexeme.id,
    });
    expect(port.sets).toEqual([]);
    expect((port.documents.get(`lexemes/${migration.lexeme.id}`) as typeof migration.lexeme)
      .compatibility.translation).toBe('khác');
  });

  it('does not overwrite a conflicting membership after accepting an identical lexeme', async () => {
    const port = new MemoryCatalogPort();
    const migration = bundle();
    port.documents.set(`lexemes/${migration.lexeme.id}`, migration.lexeme);
    port.documents.set(`track_memberships/${migration.memberships[0].id}`, {
      ...migration.memberships[0], legacyCategory: 'Conflicting category',
    });

    await expect(applyCatalogMigration(migration, port)).resolves.toMatchObject({
      status: 'conflict', entity: 'membership', id: migration.memberships[0].id,
    });
    expect(port.sets).toEqual([]);
  });
});

describe('applyV2Rollback', () => {
  const command = () => {
    const migration = bundle();
    return {
      snapshot: migration.rollback,
      trustedContext: {
        expectedOwnerId: migration.source.ownerId,
        expectedSourceDocumentId: migration.source.documentId,
        expectedSourceFingerprint: migration.source.fingerprint,
      },
      expectedRevision: 4,
      expectedLibraryEpoch: 2,
    };
  };

  it('restores through an atomic trusted port only when revision and epoch match', async () => {
    const port = new MemoryRollbackPort({ ...card, translation: 'temporary replacement' });

    await expect(applyV2Rollback(command(), port)).resolves.toMatchObject({ status: 'restored' });
    expect((port.current as CardData).translation).toBe('phân bổ');
    expect(port.writes).toBe(1);
  });

  it('rejects stale rollback and leaves newer data untouched', async () => {
    const newer = { ...card, revision: 5, translation: 'newer value' };
    const port = new MemoryRollbackPort(newer);

    await expect(applyV2Rollback(command(), port)).resolves.toMatchObject({
      status: 'conflict', currentRevision: 5, currentLibraryEpoch: 2,
    });
    expect(port.current).toEqual(newer);
    expect(port.writes).toBe(0);
  });

  it('rejects a different library epoch and never recreates a missing source document', async () => {
    const differentEpoch = { ...card, libraryEpoch: 3 };
    const stalePort = new MemoryRollbackPort(differentEpoch);
    const missingPort = new MemoryRollbackPort(null);

    await expect(applyV2Rollback(command(), stalePort)).resolves.toMatchObject({
      status: 'conflict', currentRevision: 4, currentLibraryEpoch: 3,
    });
    await expect(applyV2Rollback(command(), missingPort)).resolves.toEqual({ status: 'missing' });
    expect(stalePort.writes).toBe(0);
    expect(missingPort.writes).toBe(0);
  });

  it('is a no-op when the source already equals the trusted rollback snapshot', async () => {
    const port = new MemoryRollbackPort(card);

    await expect(applyV2Rollback(command(), port)).resolves.toMatchObject({ status: 'unchanged' });
    expect(port.writes).toBe(0);
  });
});
