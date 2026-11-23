import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppViewMode } from '../features/navigation/useAppNavigation';

const state = vi.hoisted(() => ({
  extensionUrls: [] as string[],
  identity: {
    status: 'anonymous',
    owner: null as { id: string; displayName?: string | null; email?: string | null; photoUrl?: string | null } | null,
    isSigningIn: false,
    error: null,
  },
}));

vi.mock('./appDependencies', () => ({
  appDependencies: {
    configuration: { cloudConfigured: true },
    sessions: { libraryHooks: { useIdentitySession: () => state.identity } },
  },
}));
vi.mock('./useAppLibraryRuntime', () => ({
  useAppLibraryRuntime: () => ({
    model: {
      user: state.identity.owner && { uid: state.identity.owner.id },
      cards: [],
      cloudStats: { due: 0 },
      libraryEpochState: null,
      shellSyncStatus: { isCheckingCloud: false },
      isBrowserOnline: true,
      isExporting: false,
      librarySession: {
        identity: state.identity,
        owner: { ownerId: state.identity.owner?.id ?? null, status: 'ready' },
        cloud: { ownerId: state.identity.owner?.id ?? null, stats: { due: 0 } },
      },
    },
    actions: {
      signIn: vi.fn(), signOut: vi.fn(), clearAuthError: vi.fn(), retrySync: vi.fn(), exportLibrary: vi.fn(),
    },
  }),
}));
vi.mock('./useAppLearningCoordination', () => ({
  useAppLearningCoordination: () => ({
    model: {
      libraryScreen: {}, practiceSession: { mode: 'idle', study: { isPaused: false, cards: [], index: 0 } }, customDecks: [],
      intakeSharing: { share: { isShareDialogOpen: false, isLoading: false } }, isLibraryBusy: false,
      canClearLibrary: false, equipFrame: vi.fn(), equippedFrameId: null, ownedTitleIds: [],
    },
    actions: { practice: {}, intakeSharing: {} },
  }),
}));
vi.mock('../features/overlays/useOverlayState', () => ({
  useOverlayState: () => ({
    notice: null, setNotice: vi.fn(), isPracticeMenuOpen: false, setIsPracticeMenuOpen: vi.fn(),
    isStatsOpen: false, setIsStatsOpen: vi.fn(), showClearConfirm: false, setShowClearConfirm: vi.fn(),
    hasMountedOverlays: false, shareOpenerRef: { current: null }, practiceOpenerRef: { current: null },
    statsOpenerRef: { current: null }, clearOpenerRef: { current: null }, rememberOpener: vi.fn(),
    openPractice: vi.fn(), openStats: vi.fn(), openClearConfirm: vi.fn(), undoToast: null, setUndoToast: vi.fn(),
  }),
  scheduleNoticeDismissal: () => undefined,
}));
vi.mock('../features/browserExtension/useBrowserExtensionImport', () => ({
  useBrowserExtensionImport: () => {
    useEffect(() => { state.extensionUrls.push(window.location.href); });
  },
}));
vi.mock('../features/extensionBridge/useExtensionDueCountBridge', () => ({ useExtensionDueCountBridge: vi.fn() }));
vi.mock('../features/onboarding/useOnboardingLibraryState', () => ({ useOnboardingLibraryState: () => ({}) }));
vi.mock('@lingui/react', () => ({
  Trans: ({ children }: { children?: unknown }) => children,
  useLingui: () => ({ _: (message: { message?: string }) => message.message ?? '' }),
}));

import AppRuntime, { latestStatsRefresh, libraryInsightsPhase, statsRefreshForTarget } from './AppRuntime';

const installMinimalReactDom = (initialUrl: string) => {
  let href = initialUrl;
  const historyPushes: string[] = [];
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const HTMLElementStub = class HTMLElement {};
  const HTMLIFrameElementStub = class HTMLIFrameElement {};
  const NodeStub = class Node {};
  const location = {
    get href() { return href; },
    get origin() { return new URL(href).origin; },
    get pathname() { return new URL(href).pathname; },
  };
  const browser = {
    location,
    history: {
      state: null as unknown,
      pushState(state: unknown, _unused: string, next: string) {
        this.state = state;
        href = new URL(next, href).href;
        historyPushes.push(href);
      },
      replaceState(state: unknown, _unused: string, next: string) {
        this.state = state;
        href = new URL(next, href).href;
      },
    },
    addEventListener(type: string, listener: (event: Event) => void) {
      const handlers = listeners.get(type) ?? new Set();
      handlers.add(listener);
      listeners.set(type, handlers);
    },
    removeEventListener(type: string, listener: (event: Event) => void) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event: Event) {
      listeners.get(event.type)?.forEach(listener => listener(event));
      return true;
    },
    HTMLElement: HTMLElementStub,
    HTMLIFrameElement: HTMLIFrameElementStub,
    Node: NodeStub,
  };
  const documentLike: Record<string, unknown> = {
    nodeType: 9, activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), defaultView: browser,
  };
  const container = {
    nodeType: 1, ownerDocument: documentLike, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    nodeName: 'DIV', tagName: 'DIV', namespaceURI: 'http://www.w3.org/1999/xhtml',
  };
  documentLike.documentElement = container;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', browser);
  vi.stubGlobal('self', browser);
  vi.stubGlobal('top', browser);
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('HTMLElement', HTMLElementStub);
  vi.stubGlobal('HTMLIFrameElement', HTMLIFrameElementStub);
  vi.stubGlobal('Node', NodeStub);
  vi.stubGlobal('PopStateEvent', class PopStateEvent extends Event {
    constructor(type: string) { super(type); }
  });
  return { browser, container: container as unknown as Element, historyPushes };
};

describe('AppRuntime signed-out return', () => {
  it('does not treat cached insights as fresh after their cloud refresh fails', () => {
    expect(libraryInsightsPhase({ ownerMatches: true, isLoading: false, statsTargetMatches: true, error: 'Offline' })).toBe('failure');
    expect(libraryInsightsPhase({ ownerMatches: true, isLoading: false, statsTargetMatches: false, error: 'Offline' })).toBe('failure');
    expect(libraryInsightsPhase({ ownerMatches: true, isLoading: true, statsTargetMatches: true, error: 'Offline' })).toBe('loading');
    expect(libraryInsightsPhase({ ownerMatches: true, isLoading: false, statsTargetMatches: true, error: null })).toBe('ready');
  });

  it('does not reissue a recap refresh after its course language changes', () => {
    const request = { ownerId: 'owner-a', requestId: 1, targetLanguage: 'en' };
    expect(statsRefreshForTarget(request, 'ko')).toBeNull();
    expect(statsRefreshForTarget(request, 'en')).toEqual(request);
  });

  it('uses the newest active stats refresh when recap follows an Insights retry', () => {
    const insights = { ownerId: 'owner-a', requestId: 1, targetLanguage: 'en' };
    const recap = { ownerId: 'owner-a', requestId: 2, targetLanguage: 'en' };
    expect(latestStatsRefresh(insights, recap)).toEqual(recap);
  });

  afterEach(() => {
    state.identity = { status: 'anonymous', owner: null, isSigningIn: false, error: null };
    state.extensionUrls = [];
    vi.unstubAllGlobals();
  });

  it('restores an anonymous deep link after a simulated sign-in', async () => {
    const initialUrl = 'https://app.example.test/?view=library#lf-import=verified-import';
    const { browser, container } = installMinimalReactDom(initialUrl);
    let viewMode: AppViewMode = 'library';
    const setViewMode = vi.fn((next: AppViewMode) => {
      viewMode = next;
      const url = new URL(browser.location.href);
      if (next === 'landing') url.searchParams.delete('view');
      browser.history.pushState(browser.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    });
    const popState = vi.fn();
    browser.addEventListener('popstate', popState);
    const root = createRoot(container);
    const render = () => root.render(<AppRuntime
      visible={false}
      navigation={{ viewMode, setViewMode, viewHeadingRef: { current: null }, viewFocusIntent: 0, isDarkMode: false } as never}
      practiceOpenerRef={{ current: null }}
      signInRequest={null}
      onSignInRequestHandled={vi.fn()}
      onLandingUserChange={vi.fn()}
    />);

    try {
      await act(async () => { render(); });
      expect(setViewMode).toHaveBeenCalledWith('landing');
      expect(browser.location.href).toBe('https://app.example.test/#lf-import=verified-import');

      state.identity = { status: 'authenticated', owner: { id: 'owner-b' }, isSigningIn: false, error: null };
      await act(async () => { render(); });

      expect(browser.location.href).toBe(initialUrl);
      expect(popState).toHaveBeenCalledOnce();
    } finally {
      await act(async () => { root.unmount(); });
      browser.removeEventListener('popstate', popState);
    }
  });

  it('does not restore owner A\'s signed-out return intent for B or a later owner C', async () => {
    const initialUrl = 'https://app.example.test/?view=library#lf-import=owner-a-import';
    const { browser, container, historyPushes } = installMinimalReactDom(initialUrl);
    state.identity = { status: 'authenticated', owner: { id: 'owner-a' }, isSigningIn: false, error: null };
    let viewMode: AppViewMode = 'library';
    const setViewMode = vi.fn((next: AppViewMode) => {
      viewMode = next;
      const url = new URL(browser.location.href);
      if (next === 'landing') url.searchParams.delete('view');
      browser.history.pushState(browser.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    });
    const popState = vi.fn();
    browser.addEventListener('popstate', popState);
    const root = createRoot(container);
    const render = () => root.render(<AppRuntime
      visible={false}
      navigation={{ viewMode, setViewMode, viewHeadingRef: { current: null }, viewFocusIntent: 0, isDarkMode: false } as never}
      practiceOpenerRef={{ current: null }}
      signInRequest={null}
      onSignInRequestHandled={vi.fn()}
      onLandingUserChange={vi.fn()}
    />);

    try {
      await act(async () => { render(); });
      state.identity = { status: 'anonymous', owner: null, isSigningIn: false, error: null };
      await act(async () => { render(); });

      const signedOutUrl = 'https://app.example.test/';
      expect(browser.location.href).toBe(signedOutUrl);

      state.identity = { status: 'authenticated', owner: { id: 'owner-b' }, isSigningIn: false, error: null };
      await act(async () => { render(); });
      const ownerBUrl = browser.location.href;
      const historyPushesBeforeOwnerC = [...historyPushes];
      const popStateCallsBeforeOwnerC = popState.mock.calls.length;

      state.identity = { status: 'authenticated', owner: { id: 'owner-c' }, isSigningIn: false, error: null };
      await act(async () => { render(); });

      expect(ownerBUrl).toBe(signedOutUrl);
      expect(browser.location.href).toBe(signedOutUrl);
      expect(historyPushesBeforeOwnerC).toEqual([signedOutUrl]);
      expect(historyPushes).toEqual([signedOutUrl]);
      expect(popState).toHaveBeenCalledTimes(popStateCallsBeforeOwnerC);
    } finally {
      await act(async () => { root.unmount(); });
      browser.removeEventListener('popstate', popState);
    }
  });

  it('clears owner A\'s deep link on a direct authenticated switch to B', async () => {
    const initialUrl = 'https://app.example.test/?view=library#lf-import=owner-a-import';
    const { browser, container, historyPushes } = installMinimalReactDom(initialUrl);
    state.identity = { status: 'authenticated', owner: { id: 'owner-a' }, isSigningIn: false, error: null };
    const popState = vi.fn();
    browser.addEventListener('popstate', popState);
    const setViewMode = vi.fn();
    const root = createRoot(container);
    const render = () => root.render(<AppRuntime
      visible={false}
      navigation={{ viewMode: 'library', setViewMode, viewHeadingRef: { current: null }, viewFocusIntent: 0, isDarkMode: false } as never}
      practiceOpenerRef={{ current: null }}
      signInRequest={null}
      onSignInRequestHandled={vi.fn()}
      onLandingUserChange={vi.fn()}
    />);

    try {
      await act(async () => { render(); });
      expect(browser.location.href).toBe(initialUrl);

      state.identity = { status: 'authenticated', owner: { id: 'owner-b' }, isSigningIn: false, error: null };
      await act(async () => { render(); });

      expect(browser.location.href).toBe('https://app.example.test/');
      expect(state.extensionUrls.at(-1)).toBe('https://app.example.test/');
      expect(historyPushes).toEqual([]);
      expect(popState).not.toHaveBeenCalled();
      expect(setViewMode).not.toHaveBeenCalled();
    } finally {
      await act(async () => { root.unmount(); });
      browser.removeEventListener('popstate', popState);
    }
  });

  it('keeps deletion warnings while clearing A\'s deep link, without replaying warnings on sign-in', async () => {
    const initialUrl = 'https://app.example.test/?view=library&sfDeleteCache=1#lf-import=owner-a-import';
    const { browser, container } = installMinimalReactDom(initialUrl);
    state.identity = { status: 'authenticated', owner: { id: 'owner-a' }, isSigningIn: false, error: null };
    let viewMode: AppViewMode = 'library';
    const setViewMode = vi.fn((next: AppViewMode) => {
      viewMode = next;
      const url = new URL(browser.location.href);
      if (next === 'landing') url.searchParams.delete('view');
      browser.history.pushState(browser.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    });
    const root = createRoot(container);
    const render = () => root.render(<AppRuntime
      visible={false}
      navigation={{ viewMode, setViewMode, viewHeadingRef: { current: null }, viewFocusIntent: 0, isDarkMode: false } as never}
      practiceOpenerRef={{ current: null }}
      signInRequest={null}
      onSignInRequestHandled={vi.fn()}
      onLandingUserChange={vi.fn()}
    />);

    try {
      await act(async () => { render(); });
      state.identity = { status: 'anonymous', owner: null, isSigningIn: false, error: null };
      await act(async () => { render(); });
      expect(browser.location.href).toBe('https://app.example.test/?sfDeleteCache=1');

      state.identity = { status: 'authenticated', owner: { id: 'owner-a' }, isSigningIn: false, error: null };
      await act(async () => { render(); });
      expect(browser.location.href).toBe('https://app.example.test/?view=library#lf-import=owner-a-import');
    } finally {
      await act(async () => { root.unmount(); });
    }
  });

  it('restores owner A\'s exact deep link once when A signs back in', async () => {
    const initialUrl = 'https://app.example.test/?view=library#lf-import=owner-a-return';
    const { browser, container, historyPushes } = installMinimalReactDom(initialUrl);
    state.identity = { status: 'authenticated', owner: { id: 'owner-a' }, isSigningIn: false, error: null };
    let viewMode: AppViewMode = 'library';
    const setViewMode = vi.fn((next: AppViewMode) => {
      viewMode = next;
      const url = new URL(browser.location.href);
      if (next === 'landing') url.searchParams.delete('view');
      browser.history.pushState(browser.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    });
    const popState = vi.fn();
    browser.addEventListener('popstate', popState);
    const root = createRoot(container);
    const render = () => root.render(<AppRuntime
      visible={false}
      navigation={{ viewMode, setViewMode, viewHeadingRef: { current: null }, viewFocusIntent: 0, isDarkMode: false } as never}
      practiceOpenerRef={{ current: null }}
      signInRequest={null}
      onSignInRequestHandled={vi.fn()}
      onLandingUserChange={vi.fn()}
    />);

    try {
      await act(async () => { render(); });
      state.identity = { status: 'anonymous', owner: null, isSigningIn: false, error: null };
      await act(async () => { render(); });
      expect(browser.location.href).toBe('https://app.example.test/');

      state.identity = { status: 'authenticated', owner: { id: 'owner-a' }, isSigningIn: false, error: null };
      await act(async () => { render(); });
      expect(browser.location.href).toBe(initialUrl);
      expect(historyPushes).toEqual(['https://app.example.test/', initialUrl]);
      expect(popState).toHaveBeenCalledOnce();

      await act(async () => { render(); });
      expect(historyPushes).toEqual(['https://app.example.test/', initialUrl]);
      expect(popState).toHaveBeenCalledOnce();
    } finally {
      await act(async () => { root.unmount(); });
      browser.removeEventListener('popstate', popState);
    }
  });
});
