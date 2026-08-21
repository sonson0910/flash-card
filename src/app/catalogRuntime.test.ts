import { describe, expect, it, vi } from 'vitest';

import { createCatalogWorkspaceRuntime, createSameOriginCatalogChunkSource } from './catalogRuntime';

const response = (chunks: readonly Uint8Array[], headers?: HeadersInit): Response => new Response(
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }),
  { status: 200, headers },
);

describe('same-origin catalog chunk source', () => {
  it('streams a relative catalog path with restrictive fetch options', async () => {
    const fetcher = vi.fn(async () => response([
      new Uint8Array([1, 2]),
      new Uint8Array([3]),
    ], { 'content-length': '3' }));
    const source = createSameOriginCatalogChunkSource({
      baseUrl: 'https://learn.example.test/app',
      fetcher,
      maximumBytes: 4,
    });

    await expect(source.fetchChunk('catalog/releases/chunk-000.json')).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(fetcher).toHaveBeenCalledWith(
      'https://learn.example.test/catalog/releases/chunk-000.json',
      {
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error',
        signal: expect.any(AbortSignal),
      },
    );
  });

  it.each([
    'https://evil.example/chunk.json',
    '//evil.example/chunk.json',
    '/catalog/chunk.json',
    '../chunk.json',
    'catalog/%2e%2e/chunk.json',
    'catalog/chunk.json?token=secret',
  ])('rejects unsafe path %s before fetching', async (path) => {
    const fetcher = vi.fn();
    const source = createSameOriginCatalogChunkSource({
      baseUrl: 'https://learn.example.test/',
      fetcher,
    });

    await expect(source.fetchChunk(path)).rejects.toThrow(/relative catalog path/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects an oversized declared response before reading it', async () => {
    const cancel = vi.fn(async () => undefined);
    const fetcher = vi.fn(async () => ({
      ok: true,
      headers: new Headers({ 'content-length': '5' }),
      body: { getReader: () => ({ read: vi.fn(), cancel }) },
    } as unknown as Response));
    const source = createSameOriginCatalogChunkSource({
      baseUrl: 'https://learn.example.test/',
      fetcher,
      maximumBytes: 4,
    });

    await expect(source.fetchChunk('catalog/chunk.json')).rejects.toThrow(/maximum size/i);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('bounds decoded bytes without requiring compressed Content-Length equality', async () => {
    const source = createSameOriginCatalogChunkSource({
      baseUrl: 'https://learn.example.test/',
      fetcher: vi.fn(async () => response(
        [new Uint8Array([1, 2, 3])],
        { 'content-encoding': 'gzip', 'content-length': '2' },
      )),
      maximumBytes: 4,
    });

    await expect(source.fetchChunk('catalog/chunk.json')).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it('cancels a streamed response that crosses the byte limit', async () => {
    const cancel = vi.fn(async () => undefined);
    const reads = [
      { done: false, value: new Uint8Array([1, 2, 3]) },
      { done: false, value: new Uint8Array([4, 5]) },
    ];
    const fetcher = vi.fn(async () => ({
      ok: true,
      headers: new Headers(),
      body: { getReader: () => ({ read: vi.fn(async () => reads.shift() ?? { done: true }), cancel }) },
    } as unknown as Response));
    const source = createSameOriginCatalogChunkSource({
      baseUrl: 'https://learn.example.test/',
      fetcher,
      maximumBytes: 4,
    });

    await expect(source.fetchChunk('catalog/chunk.json')).rejects.toThrow(/maximum size/i);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects non-success responses and missing streaming bodies', async () => {
    const unavailable = createSameOriginCatalogChunkSource({
      baseUrl: 'https://learn.example.test/',
      fetcher: vi.fn(async () => new Response(null, { status: 503 })),
    });
    const missingBody = createSameOriginCatalogChunkSource({
      baseUrl: 'https://learn.example.test/',
      fetcher: vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: null,
      } as Response)),
    });

    await expect(unavailable.fetchChunk('catalog/chunk.json')).rejects.toThrow(/HTTP 503/);
    await expect(missingBody.fetchChunk('catalog/chunk.json')).rejects.toThrow(/streaming body/i);
  });

  it('aborts a fetch that exceeds the portable timeout', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>(
      (_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
    ));
    const source = createSameOriginCatalogChunkSource({
      baseUrl: 'https://learn.example.test/',
      fetcher,
      timeoutMilliseconds: 25,
    });

    const pending = source.fetchChunk('catalog/chunk.json');
    const assertion = expect(pending).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    vi.useRealTimers();
  });

  it('aborts the fetch signal on timeout even when the caller supplies a signal', async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener('abort', () => reject(observedSignal?.reason), { once: true });
      });
    });
    const source = createSameOriginCatalogChunkSource({
      baseUrl: 'https://learn.example.test/',
      fetcher,
      timeoutMilliseconds: 25,
    });
    const caller = new AbortController();

    const pending = source.fetchChunk('catalog/chunk.json', caller.signal);
    const assertion = expect(pending).rejects.toThrow(/timed out/i);

    try {
      await vi.advanceTimersByTimeAsync(25);
      await assertion;
      expect(observedSignal?.aborted).toBe(true);
      expect(observedSignal?.reason).toEqual(new Error('Catalog chunk request timed out.'));
      expect(caller.signal.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a stalled response stream when the timeout expires', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(async () => undefined);
    const source = createSameOriginCatalogChunkSource({
      baseUrl: 'https://learn.example.test/',
      fetcher: vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: { getReader: () => ({ read: () => new Promise(() => undefined), cancel }) },
      } as unknown as Response)),
      timeoutMilliseconds: 25,
    });

    const pending = source.fetchChunk('catalog/chunk.json');
    const assertion = expect(pending).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(cancel).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('does not wait forever when response-stream cancellation never settles', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const source = createSameOriginCatalogChunkSource({
      baseUrl: 'https://learn.example.test/',
      fetcher: vi.fn(async () => ({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: { getReader: () => ({ read: () => new Promise(() => undefined), cancel }) },
      } as unknown as Response)),
      timeoutMilliseconds: 25,
    });
    let settled = false;
    const observed = source.fetchChunk('catalog/chunk.json').catch(() => { settled = true; });

    try {
      await vi.advanceTimersByTimeAsync(25);
      await Promise.resolve();
      expect(cancel).toHaveBeenCalledOnce();
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
      void observed;
    }
  });

  it('propagates caller cancellation and its reason into the fetch signal', async () => {
    let observedSignal: AbortSignal | undefined;
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener('abort', () => reject(observedSignal?.reason), { once: true });
      });
    });
    const source = createSameOriginCatalogChunkSource({
      baseUrl: 'https://learn.example.test/',
      fetcher,
      timeoutMilliseconds: 25,
    });
    const caller = new AbortController();

    const pending = source.fetchChunk('catalog/chunk.json', caller.signal);
    const cancellation = new Error('catalog install stopped');
    caller.abort(cancellation);

    await expect(pending).rejects.toThrow('catalog install stopped');
    expect(observedSignal?.aborted).toBe(true);
    expect(observedSignal?.reason).toBe(cancellation);
  });
});

describe('catalog workspace runtime composition', () => {
  it('exposes one owner-scoped runtime port for cache and Learning State responsibilities', async () => {
    const loadLearningStates = vi.fn(async (_ownerId: string | null, maximum: number) => ({
      states: new Map<string, never>(),
      rejected: 0,
      maximum,
    }));

    const runtime = createCatalogWorkspaceRuntime({ loadLearningStates });

    expect(runtime.inspect).toBeTypeOf('function');
    expect(runtime.summarize).toBeTypeOf('function');
    expect(runtime.install).toBeTypeOf('function');
    expect(runtime.readPage).toBeTypeOf('function');
    await expect(runtime.loadLearningStates('owner-1', 500)).resolves.toMatchObject({
      states: expect.any(Map),
      rejected: 0,
      maximum: 500,
    });
    expect(loadLearningStates).toHaveBeenCalledWith('owner-1', 500);

    await expect(runtime.loadLearningStates(null, 500)).resolves.toMatchObject({
      states: expect.any(Map),
      rejected: 0,
      maximum: 500,
    });
    expect(loadLearningStates).toHaveBeenCalledWith(null, 500);
  });
});
