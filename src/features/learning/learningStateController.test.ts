import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CardData } from '../../types/card';
import {
  createLearningStateController,
  type LearningStateMutation,
  type LearningStateMutationResult,
  type LearningStatePort,
  type LearningStatePublication,
} from './learningStateController';

const card: CardData = {
  id: 'word-focus',
  word: 'focus',
  normalizedWord: 'focus',
  translation: 'tập trung',
  explanation: '',
  phonetic: '',
  emoji: '🎯',
  category: 'Study',
  audioUrl: null,
  imageUrl: null,
  bookmarked: false,
  customDeck: null,
  difficulty: 'unrated',
  revision: 4,
  libraryEpoch: 2,
};

const resultFor = (mutation: LearningStateMutation): LearningStateMutationResult => ({
  ownerKey: mutation.ownerKey,
  operationId: mutation.operationId,
  publication: mutation.publication,
});

const createFake = () => {
  let ownerKey: string | null = 'user:a';
  const events: string[] = [];
  const persisted: LearningStateMutation[] = [];
  const port: LearningStatePort = {
    activeOwner: () => ownerKey,
    findCard: cardId => cardId === card.id ? card : undefined,
    persist: async mutation => {
      events.push(`persist:${mutation.intent}`);
      persisted.push(mutation);
      return resultFor(mutation);
    },
  };
  const apply = (snapshot: 'library' | 'practice') => (publication: LearningStatePublication) => {
    events.push(`${snapshot}:${publication.kind}`);
  };
  const controller = createLearningStateController({
    port,
    snapshots: { library: { apply: apply('library') }, practice: { apply: apply('practice') } },
    now: () => new Date('2026-08-03T00:00:00.000Z'),
  });
  return { controller, events, persisted, port, setOwner: (owner: string | null) => { ownerKey = owner; } };
};

describe('learning state controller', () => {
  it('publishes bookmark, deck, review, patch, delete and clear results to both snapshots in order', async () => {
    const { controller, events, persisted } = createFake();

    await controller.toggleBookmark(card.id, 'bookmark-1');
    await controller.assignDeck(card.id, 'IELTS', 'deck-1');
    await controller.review(card.id, 'good', 'review-1');
    await controller.patch(card.id, { translation: 'sự tập trung', id: 'unsafe-id' }, ['translation', 'id'], 'patch-1');
    await controller.delete(card.id, 'delete-1');
    await controller.clear('clear-1');

    expect(events).toEqual([
      'persist:bookmark', 'library:patch', 'practice:patch',
      'persist:deck', 'library:patch', 'practice:patch',
      'persist:review', 'library:patch', 'practice:patch',
      'persist:patch', 'library:patch', 'practice:patch',
      'persist:delete', 'library:delete', 'practice:delete',
      'persist:clear', 'library:clear', 'practice:clear',
    ]);
    expect(persisted[0]).toMatchObject({ operation: 'patch', intent: 'bookmark', baseRevision: 4, libraryEpoch: 2 });
    expect(persisted[0].publication).toEqual({ kind: 'patch', cardId: card.id, fields: { bookmarked: true } });
    expect(persisted[1].publication).toEqual({ kind: 'patch', cardId: card.id, fields: { customDeck: 'IELTS' } });
    expect(persisted[2].publication).toMatchObject({ kind: 'patch', cardId: card.id, fields: { difficulty: 'good' } });
    expect(persisted[3].publication).toEqual({ kind: 'patch', cardId: card.id, fields: { translation: 'sự tập trung' } });
  });

  it('drops a successful result when the active owner changes while persistence is in flight', async () => {
    const { controller, events, port, setOwner } = createFake();
    let resolvePersist!: () => void;
    port.persist = mutation => new Promise(resolve => {
      events.push('persist:pending');
      resolvePersist = () => resolve(resultFor(mutation));
    });

    const pending = controller.toggleBookmark(card.id, 'bookmark-stale');
    setOwner('user:b');
    resolvePersist();

    await expect(pending).resolves.toEqual({ status: 'stale-owner' });
    expect(events).toEqual(['persist:pending']);

    setOwner('user:a');
    port.persist = async mutation => {
      events.push('persist:retry');
      return resultFor(mutation);
    };
    await expect(controller.toggleBookmark(card.id, 'bookmark-stale')).resolves.toMatchObject({ status: 'published' });
    expect(events).toEqual(['persist:pending', 'persist:retry', 'library:patch', 'practice:patch']);
  });

  it('publishes a successful operation once, coalesces duplicates, and allows retry after failure', async () => {
    const { controller, events, port } = createFake();
    let attempts = 0;
    port.persist = async mutation => {
      attempts += 1;
      events.push(`persist:${attempts}`);
      if (attempts === 1) throw new Error('storage unavailable');
      return resultFor(mutation);
    };

    await expect(controller.delete(card.id, 'delete-retry')).rejects.toThrow('storage unavailable');
    expect(events).toEqual(['persist:1']);

    const [first, duplicate] = await Promise.all([
      controller.delete(card.id, 'delete-retry'),
      controller.delete(card.id, 'delete-retry'),
    ]);
    const repeated = await controller.delete(card.id, 'delete-retry');

    expect(first).toEqual(duplicate);
    expect(repeated).toEqual(first);
    expect(attempts).toBe(2);
    expect(events).toEqual(['persist:1', 'persist:2', 'library:delete', 'practice:delete']);
  });

  it('does not persist or publish missing cards and patches that are already applied', async () => {
    const { controller, events } = createFake();

    await expect(controller.patch(card.id, { translation: card.translation }, ['translation'], 'same')).resolves.toEqual({ status: 'noop' });
    await expect(controller.toggleBookmark('missing', 'missing')).resolves.toEqual({ status: 'missing-card' });
    expect(events).toEqual([]);
  });

  it('keeps the controller source vendor-free', () => {
    const source = readFileSync(fileURLToPath(new URL('./learningStateController.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/firebase|firestore/i);
    expect(source).not.toMatch(/from\s+['"]react['"]/);
  });
});
