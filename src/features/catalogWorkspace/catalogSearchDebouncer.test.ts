import { describe, expect, it, vi } from 'vitest';
import {
  createCatalogSearchDebouncer,
  type CatalogSearchTimers,
} from './catalogSearchDebouncer';

function createTimers() {
  let nextId = 0;
  const tasks = new Map<number, () => void>();
  const timers: CatalogSearchTimers = {
    setTimeout(callback) {
      const id = ++nextId;
      tasks.set(id, callback);
      return id;
    },
    clearTimeout(handle) {
      tasks.delete(handle as number);
    },
  };
  return {
    timers,
    flush() {
      const pending = [...tasks.values()];
      tasks.clear();
      pending.forEach(task => task());
    },
    pending: () => tasks.size,
  };
}

describe('catalog search debouncer', () => {
  it('commits only the latest term after rapid typing', () => {
    const clock = createTimers();
    const commit = vi.fn();
    const debouncer = createCatalogSearchDebouncer(commit, { timers: clock.timers });

    debouncer.schedule('a');
    debouncer.schedule('air');
    debouncer.schedule('airport');

    expect(clock.pending()).toBe(1);
    expect(commit).not.toHaveBeenCalled();
    clock.flush();
    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith('airport');
  });

  it('cancels pending work during history restoration or unmount', () => {
    const clock = createTimers();
    const commit = vi.fn();
    const debouncer = createCatalogSearchDebouncer(commit, { timers: clock.timers });

    debouncer.schedule('stale');
    debouncer.cancel();
    clock.flush();
    expect(commit).not.toHaveBeenCalled();

    debouncer.schedule('also stale');
    debouncer.dispose();
    clock.flush();
    expect(commit).not.toHaveBeenCalled();
  });
});
