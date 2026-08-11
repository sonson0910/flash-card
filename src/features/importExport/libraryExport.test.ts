import { describe, expect, it, vi } from 'vitest';
import { createLibraryExportOperation } from './libraryExport';

const deferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

describe('library export operation', () => {
  it('holds a single-flight lock and reports operation-specific phases', async () => {
    const cards = deferred<readonly string[] | null>();
    const phases: string[] = [];
    const write = vi.fn();
    const exporter = createLibraryExportOperation({
      loadCards: () => cards.promise,
      prepare: async values => ({ rows: values }),
      write,
      onPhase: phase => phases.push(phase),
    });

    const first = exporter.run({ minimumExpectedCards: 2 });
    await expect(exporter.run({ minimumExpectedCards: 2 })).resolves.toEqual({ status: 'busy' });
    cards.resolve(['apple', 'pear']);

    await expect(first).resolves.toEqual({ status: 'completed', exportedCount: 2 });
    expect(write).toHaveBeenCalledWith({ rows: ['apple', 'pear'] });
    expect(phases).toEqual(['loading', 'preparing', 'writing', 'idle']);
  });

  it('refuses to download an incomplete cloud library', async () => {
    const prepare = vi.fn(async (values: readonly string[]) => values);
    const write = vi.fn();
    const exporter = createLibraryExportOperation({
      loadCards: async () => ['apple'],
      prepare,
      write,
    });

    await expect(exporter.run({ minimumExpectedCards: 12 })).resolves.toEqual({
      status: 'failed',
      reason: 'incomplete',
      message: 'Could not load your complete library, so no incomplete export was downloaded. Check your connection and try again.',
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('times out preparation and never writes a workbook that finishes late', async () => {
    vi.useFakeTimers();
    const prepared = deferred<{ rows: readonly string[] }>();
    const write = vi.fn();
    const exporter = createLibraryExportOperation({
      loadCards: async () => ['apple'],
      prepare: () => prepared.promise,
      write,
      timeoutMs: 1_000,
    });

    const result = exporter.run({ minimumExpectedCards: 1 });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(result).resolves.toEqual({
      status: 'failed',
      reason: 'timeout',
      message: 'Export preparation took too long. Nothing was downloaded; check your connection and try again.',
    });

    prepared.resolve({ rows: ['apple'] });
    await Promise.resolve();
    expect(write).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('reports a local download failure without claiming completion', async () => {
    const exporter = createLibraryExportOperation({
      loadCards: async () => ['apple'],
      prepare: async values => values,
      write: () => { throw new Error('download denied'); },
    });

    await expect(exporter.run({ minimumExpectedCards: 1 })).resolves.toEqual({
      status: 'failed',
      reason: 'write',
      message: 'The export was prepared, but the browser could not download it. Check download permissions and try again.',
    });
  });

  it('does not download cards after the signed-in owner changes', async () => {
    let current = true;
    const prepared = deferred<readonly string[]>();
    const write = vi.fn();
    const exporter = createLibraryExportOperation({
      loadCards: async () => ['owner-a-card'],
      prepare: () => prepared.promise,
      write,
    });

    const result = exporter.run({ minimumExpectedCards: 1, isCurrent: () => current });
    await Promise.resolve();
    current = false;
    prepared.resolve(['owner-a-card']);

    await expect(result).resolves.toEqual({
      status: 'failed',
      reason: 'stale',
      message: 'The signed-in library changed while exporting. Nothing was downloaded; start the export again.',
    });
    expect(write).not.toHaveBeenCalled();
  });
});
