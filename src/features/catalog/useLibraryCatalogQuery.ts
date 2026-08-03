import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  createLibraryLocation,
  normalizeLibraryQuery,
  readLibraryQuery,
  type LibraryCatalogQuery,
  type LibraryDifficulty,
} from './libraryCatalogQuery';

export interface LibraryCatalogBrowser {
  getCurrentUrl(): string;
  getHistoryState(): unknown;
  pushState(state: unknown, location: string): void;
  listenPopState(listener: () => void): () => void;
}

export interface LibraryCatalogTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface LibraryCatalogModel extends LibraryCatalogQuery {
  debouncedSearch: string;
}

export interface LibraryCatalogActions {
  changeSearch(search: string): void;
  chooseCategory(category: string): void;
  chooseDeck(deck: string): void;
  chooseDifficulty(difficulty: LibraryDifficulty): void;
  choosePartOfSpeech(partOfSpeech: string): void;
  chooseDate(date: string): void;
  toggleStarred(onlyStarred?: boolean): void;
  goToPage(page: number): void;
  goToNextPage(): void;
  goToPreviousPage(): void;
}

export interface LibraryCatalogQueryController {
  getSnapshot(): LibraryCatalogModel;
  subscribe(listener: () => void): () => void;
  start(): void;
  stop(): void;
  readonly actions: LibraryCatalogActions;
}

export interface LibraryCatalogQueryOptions {
  browser?: LibraryCatalogBrowser;
  timers?: LibraryCatalogTimers;
  searchDebounceMs?: number;
  urlSyncDelayMs?: number;
}

const windowBrowser: LibraryCatalogBrowser = {
  getCurrentUrl: () => window.location.href,
  getHistoryState: () => window.history.state,
  pushState: (state, location) => window.history.pushState(state, document.title, location),
  listenPopState: listener => {
    window.addEventListener('popstate', listener);
    return () => window.removeEventListener('popstate', listener);
  },
};

const windowTimers: LibraryCatalogTimers = {
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: handle => window.clearTimeout(handle as number),
};

function locationSearch(location: string): string {
  return new URL(location, 'https://sonflash.invalid').search;
}

function locationPath(location: string): string {
  const url = new URL(location, 'https://sonflash.invalid');
  return `${url.pathname}${url.search}${url.hash}`;
}

function sameModel(left: LibraryCatalogModel, right: LibraryCatalogModel): boolean {
  return left.search === right.search
    && left.debouncedSearch === right.debouncedSearch
    && left.category === right.category
    && left.deck === right.deck
    && left.difficulty === right.difficulty
    && left.partOfSpeech === right.partOfSpeech
    && left.starred === right.starred
    && left.date === right.date
    && left.page === right.page;
}

function historyStateWithLibraryMarker(state: unknown): Record<string, unknown> {
  const existing = state !== null && typeof state === 'object'
    ? state as Record<string, unknown>
    : {};
  return { ...existing, sonflashLibrary: true };
}

export function createLibraryCatalogQueryController(
  options: LibraryCatalogQueryOptions = {},
): LibraryCatalogQueryController {
  const browser = options.browser ?? windowBrowser;
  const timers = options.timers ?? windowTimers;
  const searchDebounceMs = options.searchDebounceMs ?? 350;
  const urlSyncDelayMs = options.urlSyncDelayMs ?? 400;
  const initialQuery = normalizeLibraryQuery(
    readLibraryQuery(locationSearch(browser.getCurrentUrl())),
  );
  let snapshot: LibraryCatalogModel = {
    ...initialQuery,
    debouncedSearch: initialQuery.search,
  };
  let started = false;
  let removePopStateListener: (() => void) | undefined;
  let debounceHandle: unknown;
  let urlSyncHandle: unknown;
  const listeners = new Set<() => void>();

  const publish = (next: LibraryCatalogModel): boolean => {
    if (sameModel(snapshot, next)) return false;
    snapshot = next;
    listeners.forEach(listener => listener());
    return true;
  };

  const clearDebounce = () => {
    if (debounceHandle === undefined) return;
    timers.clearTimeout(debounceHandle);
    debounceHandle = undefined;
  };

  const clearUrlSync = () => {
    if (urlSyncHandle === undefined) return;
    timers.clearTimeout(urlSyncHandle);
    urlSyncHandle = undefined;
  };

  const writeLocation = () => {
    urlSyncHandle = undefined;
    const nextLocation = createLibraryLocation(browser.getCurrentUrl(), snapshot);
    if (nextLocation === locationPath(browser.getCurrentUrl())) return;
    browser.pushState(
      historyStateWithLibraryMarker(browser.getHistoryState()),
      nextLocation,
    );
  };

  const scheduleUrlSync = () => {
    if (!started) return;
    clearUrlSync();
    urlSyncHandle = timers.setTimeout(writeLocation, urlSyncDelayMs);
  };

  const applyFilterIntent = (patch: Partial<LibraryCatalogQuery>) => {
    const candidate: LibraryCatalogQuery = {
      ...snapshot,
      ...patch,
      page: 1,
      search: snapshot.debouncedSearch,
    };
    const normalized = normalizeLibraryQuery(candidate);
    const changed = publish({
      ...normalized,
      search: snapshot.search,
      debouncedSearch: snapshot.debouncedSearch,
    });
    if (changed) scheduleUrlSync();
  };

  const restoreFromHistory = () => {
    clearDebounce();
    clearUrlSync();
    const restored = normalizeLibraryQuery(
      readLibraryQuery(locationSearch(browser.getCurrentUrl())),
    );
    publish({ ...restored, debouncedSearch: restored.search });
  };

  const actions: LibraryCatalogActions = {
    changeSearch(search) {
      clearDebounce();
      const changed = publish({ ...snapshot, search });
      if (!changed) return;
      scheduleUrlSync();
      if (!started) return;
      debounceHandle = timers.setTimeout(() => {
        debounceHandle = undefined;
        const normalized = normalizeLibraryQuery({
          ...snapshot,
          search,
          page: 1,
        });
        const didPublish = publish({
          ...normalized,
          search: snapshot.search,
          debouncedSearch: search,
        });
        if (didPublish) scheduleUrlSync();
      }, searchDebounceMs);
    },
    chooseCategory: category => applyFilterIntent({ category }),
    chooseDeck: deck => applyFilterIntent({ deck }),
    chooseDifficulty: difficulty => applyFilterIntent({ difficulty }),
    choosePartOfSpeech: partOfSpeech => applyFilterIntent({ partOfSpeech }),
    chooseDate: date => applyFilterIntent({ date }),
    toggleStarred: onlyStarred => applyFilterIntent({
      starred: onlyStarred ?? !snapshot.starred,
    }),
    goToPage(page) {
      const normalizedPage = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1;
      const changed = publish({ ...snapshot, page: normalizedPage });
      if (changed) scheduleUrlSync();
    },
    goToNextPage() {
      actions.goToPage(snapshot.page + 1);
    },
    goToPreviousPage() {
      actions.goToPage(snapshot.page - 1);
    },
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (started) return;
      started = true;
      removePopStateListener = browser.listenPopState(restoreFromHistory);
    },
    stop() {
      if (!started) return;
      started = false;
      clearDebounce();
      clearUrlSync();
      removePopStateListener?.();
      removePopStateListener = undefined;
    },
    actions,
  };
}

export interface UseLibraryCatalogQueryResult {
  model: LibraryCatalogModel;
  actions: LibraryCatalogActions;
}

export function useLibraryCatalogQuery(
  options: LibraryCatalogQueryOptions = {},
): UseLibraryCatalogQueryResult {
  const controllerRef = useRef<LibraryCatalogQueryController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createLibraryCatalogQueryController(options);
  }
  const controller = controllerRef.current;
  const model = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);

  return { model, actions: controller.actions };
}
