export const CATALOG_SEARCH_DEBOUNCE_MS = 250;

export interface CatalogSearchTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface CatalogSearchDebouncer {
  schedule(term: string): void;
  cancel(): void;
  dispose(): void;
}

const browserTimers: CatalogSearchTimers = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

export function createCatalogSearchDebouncer(
  commit: (term: string) => void,
  {
    timers = browserTimers,
    delayMs = CATALOG_SEARCH_DEBOUNCE_MS,
  }: {
    timers?: CatalogSearchTimers;
    delayMs?: number;
  } = {},
): CatalogSearchDebouncer {
  let pending: unknown;
  let disposed = false;

  const cancel = () => {
    if (pending === undefined) return;
    timers.clearTimeout(pending);
    pending = undefined;
  };

  return {
    schedule(term) {
      if (disposed) return;
      cancel();
      pending = timers.setTimeout(() => {
        pending = undefined;
        if (!disposed) commit(term);
      }, delayMs);
    },
    cancel,
    dispose() {
      disposed = true;
      cancel();
    },
  };
}
