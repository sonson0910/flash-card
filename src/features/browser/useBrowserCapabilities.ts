import {
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from 'react';

export interface BrowserHeading {
  readonly isConnected: boolean;
  visible?: boolean;
  focus(options?: FocusOptions): void;
  scrollIntoView(options?: ScrollIntoViewOptions): void;
  closest(selector: string): unknown;
}

export interface BrowserCapabilitiesPort {
  readOnline(): boolean;
  listenOnline(listener: (online: boolean) => void): () => void;
  readSaveData(): boolean;
  listenSaveData(listener: (saveData: boolean) => void): () => void;
  applySaveDataDataset(saveData: boolean): void;
  requestFrame(callback: () => void): unknown;
  cancelFrame(handle: unknown): void;
  isVisible(heading: BrowserHeading): boolean;
  getActiveElement(): unknown;
  observeVisibility(target: unknown, listener: () => void): () => void;
  getScrollBehavior?(): ScrollBehavior;
}

interface SaveDataConnection {
  saveData?: boolean;
  addEventListener?(type: 'change', listener: () => void): void;
  removeEventListener?(type: 'change', listener: () => void): void;
}

const connection = (): SaveDataConnection | undefined =>
  (globalThis.navigator as Navigator & { connection?: SaveDataConnection } | undefined)?.connection;

const browserPort: BrowserCapabilitiesPort = {
  readOnline: () => globalThis.navigator?.onLine ?? true,
  listenOnline: listener => {
    const online = () => listener(true);
    const offline = () => listener(false);
    globalThis.addEventListener?.('online', online);
    globalThis.addEventListener?.('offline', offline);
    return () => {
      globalThis.removeEventListener?.('online', online);
      globalThis.removeEventListener?.('offline', offline);
    };
  },
  readSaveData: () => connection()?.saveData === true,
  listenSaveData: listener => {
    const activeConnection = connection();
    const changed = () => listener(activeConnection?.saveData === true);
    activeConnection?.addEventListener?.('change', changed);
    return () => activeConnection?.removeEventListener?.('change', changed);
  },
  applySaveDataDataset: saveData => {
    const root = globalThis.document?.documentElement;
    if (!root) return;
    if (saveData) root.dataset.saveData = 'true';
    else delete root.dataset.saveData;
  },
  requestFrame: callback => globalThis.requestAnimationFrame(callback),
  cancelFrame: handle => globalThis.cancelAnimationFrame(handle as number),
  isVisible: heading => heading.isConnected
    && globalThis.getComputedStyle(heading as unknown as Element).visibility !== 'hidden',
  getActiveElement: () => globalThis.document?.activeElement ?? null,
  observeVisibility: (target, listener) => {
    if (typeof MutationObserver === 'undefined' || typeof Node === 'undefined' || !(target instanceof Node)) {
      return () => undefined;
    }
    const observer = new MutationObserver(listener);
    observer.observe(target, { attributes: true, attributeFilter: ['class', 'style'] });
    return () => observer.disconnect();
  },
  getScrollBehavior: () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth',
};

interface BrowserCapabilitiesSnapshot {
  isOnline: boolean;
  saveData: boolean;
  hydrationGeneration: number;
  focusRequestSequence: number;
}

export interface BrowserCapabilitiesModel {
  isOnline: boolean;
  saveData: boolean;
  hydrationGeneration: number;
}

export interface BrowserCapabilitiesActions {
  requestLibraryFocus(): number;
  bumpHydrationSession(): number;
  isHydrationSessionCurrent(generation: number): boolean;
}

export function createBrowserCapabilitiesController(port: BrowserCapabilitiesPort = browserPort) {
  const hydrationGeneration = { current: 0 };
  let snapshot: BrowserCapabilitiesSnapshot = {
    isOnline: port.readOnline(),
    saveData: port.readSaveData(),
    hydrationGeneration: 0,
    focusRequestSequence: 0,
  };
  let started = false;
  let ownerInitialized = false;
  let activeOwner: string | null = null;
  let lastFocusedPage = 1;
  let completedFocusRequest = 0;
  let removeOnlineListener: (() => void) | null = null;
  let removeSaveDataListener: (() => void) | null = null;
  let cancelVisibilityObserver: (() => void) | null = null;
  let pendingFrame: unknown;
  const listeners = new Set<() => void>();

  const publish = (patch: Partial<BrowserCapabilitiesSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach(listener => listener());
  };

  const clearFrame = () => {
    if (pendingFrame === undefined) return;
    port.cancelFrame(pendingFrame);
    pendingFrame = undefined;
  };

  const clearVisibilityObserver = () => {
    cancelVisibilityObserver?.();
    cancelVisibilityObserver = null;
  };

  const focusNow = (heading: BrowserHeading, scroll: boolean): boolean => {
    if (!port.isVisible(heading)) return false;
    if (scroll) {
      heading.scrollIntoView({
        behavior: port.getScrollBehavior?.() ?? 'auto',
        block: 'start',
      });
    }
    heading.focus({ preventScroll: true });
    return port.getActiveElement() === heading;
  };

  const bumpHydrationSession = (): number => {
    hydrationGeneration.current += 1;
    publish({ hydrationGeneration: hydrationGeneration.current });
    return hydrationGeneration.current;
  };

  const actions = {
    changeOwner(owner: string | null): number {
      if (ownerInitialized && activeOwner === owner) return hydrationGeneration.current;
      ownerInitialized = true;
      activeOwner = owner;
      return bumpHydrationSession();
    },
    requestLibraryFocus(): number {
      const focusRequestSequence = snapshot.focusRequestSequence + 1;
      publish({ focusRequestSequence });
      return focusRequestSequence;
    },
    bumpHydrationSession,
    isHydrationSessionCurrent: (generation: number) =>
      hydrationGeneration.current === generation,
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (started) return;
      started = true;
      const isOnline = port.readOnline();
      const saveData = port.readSaveData();
      publish({ isOnline, saveData });
      port.applySaveDataDataset(saveData);
      removeOnlineListener = port.listenOnline(value => publish({ isOnline: value }));
      removeSaveDataListener = port.listenSaveData(value => {
        port.applySaveDataDataset(value);
        publish({ saveData: value });
      });
    },
    stop() {
      started = false;
      removeOnlineListener?.();
      removeSaveDataListener?.();
      removeOnlineListener = null;
      removeSaveDataListener = null;
      clearFrame();
      clearVisibilityObserver();
      port.applySaveDataDataset(false);
    },
    sequencePageFocus({
      page,
      isLoading,
      heading,
    }: {
      page: number;
      isLoading: boolean;
      heading: BrowserHeading | null;
    }) {
      if (isLoading || page === lastFocusedPage || !heading) return;
      lastFocusedPage = page;
      clearFrame();
      pendingFrame = port.requestFrame(() => {
        pendingFrame = undefined;
        focusNow(heading, true);
      });
    },
    sequenceRequestedFocus({
      view,
      isBusy,
      heading,
    }: {
      view: string;
      isBusy: boolean;
      heading: BrowserHeading | null;
    }) {
      clearVisibilityObserver();
      const request = snapshot.focusRequestSequence;
      if (request === 0 || request <= completedFocusRequest || view !== 'library' || isBusy || !heading) {
        return;
      }
      if (focusNow(heading, false)) {
        completedFocusRequest = request;
        return;
      }
      const target = heading.closest('[data-gsap-library-heading]') ?? heading;
      cancelVisibilityObserver = port.observeVisibility(target, () => {
        if (!focusNow(heading, false)) return;
        completedFocusRequest = request;
        clearVisibilityObserver();
      });
    },
    actions,
    refs: { hydrationGeneration },
  };
}

export interface UseBrowserCapabilitiesOptions {
  ownerKey: string | null;
  page: number;
  pageLoading: boolean;
  view: string;
  libraryBusy: boolean;
  browser?: BrowserCapabilitiesPort;
}

export interface UseBrowserCapabilitiesResult {
  model: BrowserCapabilitiesModel;
  actions: BrowserCapabilitiesActions;
  refs: {
    libraryHeading: RefObject<HTMLHeadingElement | null>;
    hydrationGeneration: { current: number };
  };
}

export function useBrowserCapabilities({
  ownerKey,
  page,
  pageLoading,
  view,
  libraryBusy,
  browser = browserPort,
}: UseBrowserCapabilitiesOptions): UseBrowserCapabilitiesResult {
  const controller = useMemo(
    () => createBrowserCapabilitiesController(browser),
    [browser],
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const libraryHeading = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);

  useEffect(() => {
    controller.actions.changeOwner(ownerKey);
  }, [controller, ownerKey]);

  useEffect(() => {
    controller.sequencePageFocus({ page, isLoading: pageLoading, heading: libraryHeading.current });
  }, [controller, page, pageLoading]);

  useEffect(() => {
    controller.sequenceRequestedFocus({ view, isBusy: libraryBusy, heading: libraryHeading.current });
  }, [controller, libraryBusy, snapshot.focusRequestSequence, view]);

  return {
    model: {
      isOnline: snapshot.isOnline,
      saveData: snapshot.saveData,
      hydrationGeneration: snapshot.hydrationGeneration,
    },
    actions: {
      requestLibraryFocus: controller.actions.requestLibraryFocus,
      bumpHydrationSession: controller.actions.bumpHydrationSession,
      isHydrationSessionCurrent: controller.actions.isHydrationSessionCurrent,
    },
    refs: {
      libraryHeading,
      hydrationGeneration: controller.refs.hydrationGeneration,
    },
  };
}
