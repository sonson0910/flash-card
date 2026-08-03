import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LearningStateV3 } from './schemaV3';
import {
  createLearningStateV3Store,
  learningStateV3DocumentPath,
  type AtomicDocumentDecision,
  type AtomicDocumentPort,
} from './learningStateV3Store';

const state = (overrides: Partial<LearningStateV3> = {}): LearningStateV3 => ({
  schemaVersion: 3,
  ownerId: 'owner-a',
  lexemeId: 'lexeme-allocate',
  legacyCardId: 'word-allocate',
  reviewHistory: [],
  bookmarked: false,
  difficulty: 'unrated',
  correctStreak: 0,
  customCollections: [],
  revision: 1,
  libraryEpoch: 2,
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
  ...overrides,
});

class MemoryAtomicDocumentPort implements AtomicDocumentPort {
  readonly documents = new Map<string, unknown>();
  readonly reads: string[] = [];
  readonly transactions: string[] = [];

  async read(path: string): Promise<unknown | null> {
    this.reads.push(path);
    return this.documents.has(path) ? this.documents.get(path) : null;
  }

  async runAtomic<Result>(
    path: string,
    operation: (current: unknown | null) => AtomicDocumentDecision<Result>,
  ): Promise<Result> {
    this.transactions.push(path);
    const current = this.documents.has(path) ? this.documents.get(path) : null;
    const decision = operation(current);
    if (decision.kind === 'set') this.documents.set(path, decision.value);
    return decision.result;
  }
}

describe('learningStateV3Store', () => {
  it('keeps the storage boundary vendor-free and validates through the v3 parser', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./learningStateV3Store.ts', import.meta.url)),
      'utf8',
    );

    expect(source).toMatch(/parseLearningStateV3/);
    expect(source).not.toMatch(/firebase|firestore\/|from ['"]react/iu);
    expect(source).not.toMatch(/\bdelete\s*\(/u);
  });

  it('builds a bounded owner-scoped document path and rejects path injection', () => {
    expect(learningStateV3DocumentPath('owner-a', 'lexeme-allocate'))
      .toBe('users/owner-a/learning_states/lexeme-allocate');
    expect(() => learningStateV3DocumentPath('owner/a', 'lexeme-allocate'))
      .toThrow(/ownerId/i);
    expect(() => learningStateV3DocumentPath('owner-a', '../lexeme'))
      .toThrow(/lexemeId/i);
    expect(() => learningStateV3DocumentPath('owner-a', '語彙'))
      .toThrow(/lexemeId/i);
  });

  it('loads only from the requested owner path and validates untrusted documents', async () => {
    const documents = new MemoryAtomicDocumentPort();
    const store = createLearningStateV3Store(documents);
    const expected = state();
    documents.documents.set(
      'users/owner-a/learning_states/lexeme-allocate',
      expected,
    );

    await expect(store.load('owner-a', 'lexeme-allocate')).resolves.toEqual(expected);
    expect(documents.reads).toEqual(['users/owner-a/learning_states/lexeme-allocate']);

    documents.documents.set(
      'users/owner-b/learning_states/lexeme-allocate',
      state({ ownerId: 'owner-a' }),
    );
    await expect(store.load('owner-b', 'lexeme-allocate')).rejects.toThrow(/ownerId/i);
  });

  it('rejects malformed documents returned by the storage port', async () => {
    const documents = new MemoryAtomicDocumentPort();
    const store = createLearningStateV3Store(documents);
    documents.documents.set('users/owner-a/learning_states/lexeme-allocate', {
      ...state(),
      administrator: true,
    });

    await expect(store.load('owner-a', 'lexeme-allocate')).rejects.toThrow(/administrator/i);
  });

  it('creates atomically without overwriting an existing learning state', async () => {
    const documents = new MemoryAtomicDocumentPort();
    const store = createLearningStateV3Store(documents);
    const initial = state();

    await expect(store.create(initial)).resolves.toEqual({
      status: 'created',
      state: initial,
    });
    const replacement = state({ bookmarked: true });
    await expect(store.create(replacement)).resolves.toEqual({
      status: 'exists',
      current: initial,
    });
    expect(documents.documents.get(
      'users/owner-a/learning_states/lexeme-allocate',
    )).toEqual(initial);
  });

  it('validates writes before opening an atomic mutation', async () => {
    const documents = new MemoryAtomicDocumentPort();
    const store = createLearningStateV3Store(documents);
    const malformed = {
      ...state(),
      administrator: true,
    } as unknown as LearningStateV3;

    await expect(store.create(malformed)).rejects.toThrow(/administrator/i);
    expect(documents.transactions).toEqual([]);
  });

  it('updates only when revision and library epoch match atomically', async () => {
    const documents = new MemoryAtomicDocumentPort();
    const store = createLearningStateV3Store(documents);
    const initial = state();
    const next = state({ revision: 2, bookmarked: true });
    documents.documents.set(
      'users/owner-a/learning_states/lexeme-allocate',
      initial,
    );

    await expect(store.compareAndSet(next, {
      expectedRevision: 1,
      expectedLibraryEpoch: 2,
    })).resolves.toEqual({ status: 'updated', state: next });
    expect(documents.documents.get(
      'users/owner-a/learning_states/lexeme-allocate',
    )).toEqual(next);
  });

  it('returns explicit conflict and missing results for a stale compare-and-set', async () => {
    const documents = new MemoryAtomicDocumentPort();
    const store = createLearningStateV3Store(documents);
    const current = state({ revision: 4, libraryEpoch: 3 });
    documents.documents.set(
      'users/owner-a/learning_states/lexeme-allocate',
      current,
    );

    await expect(store.compareAndSet(state({ revision: 2 }), {
      expectedRevision: 1,
      expectedLibraryEpoch: 2,
    })).resolves.toEqual({ status: 'conflict', current });
    await expect(store.compareAndSet(state({
      lexemeId: 'lexeme-missing',
      revision: 2,
    }), {
      expectedRevision: 1,
      expectedLibraryEpoch: 2,
    })).resolves.toEqual({ status: 'missing' });
  });

  it('requires the next revision and epoch to honor the compare-and-set command', async () => {
    const documents = new MemoryAtomicDocumentPort();
    const store = createLearningStateV3Store(documents);
    const initial = state();
    documents.documents.set(
      'users/owner-a/learning_states/lexeme-allocate',
      initial,
    );

    await expect(store.compareAndSet(state({ revision: 1 }), {
      expectedRevision: 1,
      expectedLibraryEpoch: 2,
    })).rejects.toThrow(/revision/i);
    await expect(store.compareAndSet(state({ revision: 2, libraryEpoch: 3 }), {
      expectedRevision: 1,
      expectedLibraryEpoch: 2,
    })).rejects.toThrow(/libraryEpoch/i);
  });
});
