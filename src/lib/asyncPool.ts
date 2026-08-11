export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  requestedConcurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const concurrency = Math.max(1, Math.min(items.length, Math.floor(requestedConcurrency) || 1));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

export async function mapWithConcurrencyUntilFailure<T, R>(
  items: readonly T[],
  requestedConcurrency: number,
  mapper: (item: T, index: number, signal: AbortSignal) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const concurrency = Math.max(1, Math.min(items.length, Math.floor(requestedConcurrency) || 1));
  const controller = new AbortController();
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let firstError: unknown;
  let failed = false;

  const worker = async () => {
    while (!controller.signal.aborted && nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await mapper(items[index], index, controller.signal);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
          controller.abort(error);
        }
        throw error;
      }
    }
  };

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.allSettled(workers);
  if (failed) throw firstError;
  return results;
}
