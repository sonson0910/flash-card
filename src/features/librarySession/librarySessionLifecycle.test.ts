import { describe, expect, it, vi } from 'vitest';
import { createLibrarySessionLifecycle } from './librarySessionLifecycle';

describe('library session lifecycle', () => {
  it('rejects results from an owner lease after the active owner changes', () => {
    const lifecycle = createLibrarySessionLifecycle();
    const firstOwner = lifecycle.activate('owner-a');

    lifecycle.activate('owner-b');

    expect(lifecycle.isCurrent(firstOwner)).toBe(false);
  });

  it('unsubscribes the previous listener and ignores late emissions', () => {
    const lifecycle = createLibrarySessionLifecycle();
    const published: string[] = [];
    let emitFirst: (value: string) => void = () => undefined;
    const unsubscribeFirst = vi.fn();
    const firstOwner = lifecycle.activate('owner-a');
    const cleanupFirst = lifecycle.listen<string>(firstOwner, emit => {
      emitFirst = emit;
      return unsubscribeFirst;
    }, value => published.push(value));

    lifecycle.activate('owner-b');
    cleanupFirst();
    emitFirst('stale page');

    expect(unsubscribeFirst).toHaveBeenCalledTimes(1);
    expect(published).toEqual([]);
  });
});
