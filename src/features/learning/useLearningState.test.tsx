import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import type { LearningStateMutation, LearningStateMutationResult, LearningStatePublication } from './learningStateController';
import {
  createLearningStateBinding,
  useLearningState,
  type LearningStateCommands,
  type LearningStatePersistencePort,
} from './useLearningState';

const card: CardData = {
  id: 'word-focus', word: 'focus', normalizedWord: 'focus', translation: 'tập trung',
  explanation: '', phonetic: '', emoji: '🎯', category: 'Study', audioUrl: null, imageUrl: null,
  bookmarked: false, revision: 3, libraryEpoch: 1,
};

const resultFor = (mutation: LearningStateMutation): LearningStateMutationResult => ({
  ownerKey: mutation.ownerKey,
  operationId: mutation.operationId,
  publication: mutation.publication,
});

describe('useLearningState binding', () => {
  it('publishes hook commands through persistence, library and practice ports', async () => {
    const events: string[] = [];
    const persistence: LearningStatePersistencePort = {
      findCard: cardId => cardId === card.id ? card : undefined,
      persist: async mutation => {
        events.push(`persist:${mutation.ownerKey}:${mutation.intent}`);
        return resultFor(mutation);
      },
    };
    const apply = (target: string) => (publication: LearningStatePublication) => {
      events.push(`${target}:${publication.kind}`);
    };
    let commands: LearningStateCommands | null = null;
    function Harness() {
      commands = useLearningState({
        ownerId: 'user-a',
        persistence,
        publishers: { library: { apply: apply('library') }, practice: { apply: apply('practice') } },
        createOperationId: intent => `op-${intent}`,
      });
      return null;
    }

    renderToStaticMarkup(<Harness />);
    await (commands as LearningStateCommands | null)?.toggleBookmark(card.id);

    expect(events).toEqual([
      'persist:user-a:bookmark',
      'library:patch',
      'practice:patch',
    ]);
  });

  it('drops an in-flight binding result after its owner changes', async () => {
    let resolvePersist!: (result: LearningStateMutationResult) => void;
    let pendingMutation!: LearningStateMutation;
    const publish = vi.fn();
    const binding = createLearningStateBinding({
      ownerId: 'user-a',
      persistence: {
        findCard: () => card,
        persist: mutation => {
          pendingMutation = mutation;
          return new Promise(resolve => { resolvePersist = resolve; });
        },
      },
      publishers: { library: { apply: publish }, practice: { apply: publish } },
      createOperationId: () => 'bookmark-owner-switch',
    });

    const pending = binding.commands.toggleBookmark(card.id);
    binding.updateOwner('user-b');
    resolvePersist(resultFor(pendingMutation));

    await expect(pending).resolves.toEqual({ status: 'stale-owner' });
    expect(publish).not.toHaveBeenCalled();
  });

  it('preserves an explicit review operation id for idempotent lesson retries', async () => {
    const persist = vi.fn(async (mutation: LearningStateMutation) => resultFor(mutation));
    const createOperationId = vi.fn(() => 'generated-review-id');
    const binding = createLearningStateBinding({
      ownerId: 'user-a',
      persistence: { findCard: () => card, persist },
      publishers: { library: { apply: vi.fn() }, practice: { apply: vi.fn() } },
      createOperationId,
    });

    await binding.commands.reviewCard(card.id, 'good', 'daily-review-stable');

    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'daily-review-stable' }));
    expect(createOperationId).not.toHaveBeenCalled();
  });

  it('exposes compact commands without operation ids, vendor types or React setters', () => {
    const source = readFileSync(fileURLToPath(new URL('./useLearningState.ts', import.meta.url)), 'utf8');

    expect(source).not.toMatch(/firebase|firestore|Repository/);
    expect(source).not.toMatch(/Dispatch|SetStateAction/);
    expect(source).toContain('toggleBookmark(cardId: string)');
    expect(source).toContain('deleteCard(cardId: string)');
    expect(source).toContain('clearLibrary()');
  });
});
