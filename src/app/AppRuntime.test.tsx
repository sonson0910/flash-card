import { describe, expect, it } from 'vitest';
import { getSafeListenPracticeHandoff } from './AppRuntime';
import type { ListenPracticeHandoff, ListenPracticeScope } from './AppViewStage';

const handoff: ListenPracticeHandoff = {
  ownerId: 'owner-a',
  clipId: 'clip-a',
  generation: 3,
  cards: [],
  opener: {} as HTMLButtonElement,
};

const scope: ListenPracticeScope = {
  ownerId: 'owner-a',
  clipId: 'clip-a',
  generation: 3,
};

describe('listen practice runtime handoff', () => {
  it('keeps a handoff only when owner, clip, and generation are current', () => {
    expect(getSafeListenPracticeHandoff(handoff, scope, 'owner-a')).toBe(handoff);
  });

  it.each([
    ['owner', { ...scope, ownerId: 'owner-b' }, 'owner-b'],
    ['clip', { ...scope, clipId: 'clip-b' }, 'owner-a'],
    ['generation', { ...scope, generation: 4 }, 'owner-a'],
  ])('drops a stale %s handoff before overlay render', (_dimension, staleScope, activeOwnerId) => {
    expect(getSafeListenPracticeHandoff(handoff, staleScope, activeOwnerId)).toBeNull();
  });

  it('keeps an A to B to A clip transition from reviving the old generation', () => {
    const clipB = { ownerId: 'owner-a', clipId: 'clip-b', generation: 4 } as const;
    const clipAAgain = { ...scope, generation: 5 };

    expect(getSafeListenPracticeHandoff(handoff, scope, 'owner-a')).toBe(handoff);
    expect(getSafeListenPracticeHandoff(handoff, clipB, 'owner-a')).toBeNull();
    expect(getSafeListenPracticeHandoff(handoff, clipAAgain, 'owner-a')).toBeNull();
  });
});
