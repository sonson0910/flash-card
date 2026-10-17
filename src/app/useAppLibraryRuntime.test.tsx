import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  revoke: vi.fn<() => Promise<void>>(),
  finish: vi.fn(),
  signOut: vi.fn<() => Promise<{ status: 'completed' | 'failed' }>>(),
}));

vi.mock('../features/reminders/reminderService', () => ({
  revokeCurrentOwnerPushToken: runtime.revoke,
  finishReminderSignOut: runtime.finish,
}));

vi.mock('../features/catalog/useLibraryCatalogQuery', () => ({
  useLibraryCatalogQuery: () => ({
    model: {
      category: 'All', deck: 'All', difficulty: 'All', partOfSpeech: 'All', starred: false,
      date: 'All', debouncedSearch: '', page: 1,
    },
    actions: { goToPage: vi.fn(), goToPreviousPage: vi.fn() },
  }),
}));
vi.mock('../features/librarySession/useLibrarySession', () => ({
  useLibrarySession: () => ({
    model: {
      identity: {
        owner: { id: 'owner-a', displayName: null, email: null, photoUrl: null },
        ownerEpoch: null, canPublishMutations: true, error: null,
      },
      owner: {}, cloud: {},
    },
    actions: { identity: { signIn: vi.fn(), signOut: runtime.signOut, clearError: vi.fn() }, owner: { migrateLegacy: vi.fn() } },
  }),
}));
vi.mock('../features/librarySession/useLibrarySessionPorts', () => ({
  useLibrarySessionPorts: () => ({ ports: { session: {} }, actions: {} }),
}));
vi.mock('../features/importExport/useLibraryExport', () => ({
  useLibraryExport: () => ({ exportLibrary: vi.fn(), isExporting: false }),
}));
vi.mock('../features/browser/useBrowserCapabilities', () => ({
  useBrowserCapabilities: () => ({ model: { isOnline: true } }),
}));
vi.mock('../features/librarySession/useLibraryCloudProjection', () => ({ useLibraryCloudProjection: vi.fn() }));
vi.mock('../lib/cardQuery', () => ({ CLOUD_PAGE_SIZE: 20, queryStateKey: () => 'all' }));
vi.mock('../features/library/libraryPresentation', () => ({ dateLabelToQueryDate: () => null }));
vi.mock('../features/library/libraryStorage', () => ({ cloudFacetsCacheKey: () => 'facets', writeLocalValue: vi.fn() }));
vi.mock('./appDependencies', () => ({
  appDependencies: { library: { loadAllCards: vi.fn(), updateCategoryFacets: vi.fn() }, adapters: { ownerLibrary: {} }, sessions: { libraryHooks: {} } },
}));

import { useAppLibraryRuntime } from './useAppLibraryRuntime';

const installMinimalReactDom = () => {
  const documentLike: Record<string, unknown> = {
    nodeType: 9, activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), defaultView: globalThis,
  };
  const container = {
    nodeType: 1, ownerDocument: documentLike, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    nodeName: 'DIV', tagName: 'DIV', namespaceURI: 'http://www.w3.org/1999/xhtml',
  };
  documentLike.documentElement = container;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement {});
  vi.stubGlobal('HTMLElement', class HTMLElement {});
  vi.stubGlobal('Node', class Node {});
  return container as unknown as Element;
};

describe('useAppLibraryRuntime sign-out', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    runtime.revoke.mockReset();
    runtime.finish.mockReset();
    runtime.signOut.mockReset();
  });

  it('revokes reminders before signing out, clears cards after success, and releases the reminder latch', async () => {
    let releaseRevocation!: () => void;
    runtime.revoke.mockImplementation(() => new Promise(resolve => { releaseRevocation = resolve; }));
    runtime.signOut.mockResolvedValue({ status: 'completed' });
    const captured: { current: ReturnType<typeof useAppLibraryRuntime> | null } = { current: null };
    const reportError = vi.fn();
    const root = createRoot(installMinimalReactDom());
    function Harness() {
      captured.current = useAppLibraryRuntime({
        identity: {} as never, courseScopeReady: true, viewMode: 'library' as never, isStatsOpen: false,
        statsRefreshRequest: null, targetLanguage: 'en', reportError, clearError: vi.fn(), notify: vi.fn(),
      });
      return null;
    }

    try {
      await act(async () => { root.render(<Harness />); });
      await act(async () => { captured.current?.ports.setCards([{ id: 'card-a' } as never]); });
      const signingOut = captured.current!.actions.signOut();
      await vi.waitFor(() => expect(runtime.revoke).toHaveBeenCalledOnce());
      expect(runtime.signOut).not.toHaveBeenCalled();
      expect(captured.current!.model.cards).toHaveLength(1);

      releaseRevocation();
      await act(async () => { await signingOut; });

      expect(runtime.signOut).toHaveBeenCalledOnce();
      expect(captured.current!.model.cards).toEqual([]);
      expect(runtime.finish).toHaveBeenCalledOnce();
      expect(reportError).not.toHaveBeenCalled();
    } finally {
      await act(async () => { root.unmount(); });
    }
  });

  it('keeps the session and cards when reminder revocation fails, then releases the latch', async () => {
    const failure = new Error('offline');
    runtime.revoke.mockRejectedValue(failure);
    const captured: { current: ReturnType<typeof useAppLibraryRuntime> | null } = { current: null };
    const reportError = vi.fn();
    const root = createRoot(installMinimalReactDom());
    function Harness() {
      captured.current = useAppLibraryRuntime({
        identity: {} as never, courseScopeReady: true, viewMode: 'library' as never, isStatsOpen: false,
        statsRefreshRequest: null, targetLanguage: 'en', reportError, clearError: vi.fn(), notify: vi.fn(),
      });
      return null;
    }

    try {
      await act(async () => { root.render(<Harness />); });
      await act(async () => { captured.current?.ports.setCards([{ id: 'card-a' } as never]); });
      await expect(captured.current!.actions.signOut()).resolves.toMatchObject({ status: 'failed', error: failure });
      expect(runtime.signOut).not.toHaveBeenCalled();
      expect(captured.current!.model.cards).toHaveLength(1);
      expect(runtime.finish).toHaveBeenCalledOnce();
      expect(reportError).toHaveBeenCalledWith('Could not stop browser reminders. Try signing out again.');
    } finally {
      await act(async () => { root.unmount(); });
    }
  });

  it('releases the reminder latch without clearing cards when identity sign-out throws', async () => {
    const failure = new Error('identity offline');
    runtime.revoke.mockResolvedValue(undefined);
    runtime.signOut.mockRejectedValue(failure);
    const captured: { current: ReturnType<typeof useAppLibraryRuntime> | null } = { current: null };
    const root = createRoot(installMinimalReactDom());
    function Harness() {
      captured.current = useAppLibraryRuntime({
        identity: {} as never, courseScopeReady: true, viewMode: 'library' as never, isStatsOpen: false,
        statsRefreshRequest: null, targetLanguage: 'en', reportError: vi.fn(), clearError: vi.fn(), notify: vi.fn(),
      });
      return null;
    }

    try {
      await act(async () => { root.render(<Harness />); });
      await act(async () => { captured.current?.ports.setCards([{ id: 'card-a' } as never]); });
      await expect(captured.current!.actions.signOut()).rejects.toThrow(failure);
      expect(captured.current!.model.cards).toHaveLength(1);
      expect(runtime.finish).toHaveBeenCalledOnce();
    } finally {
      await act(async () => { root.unmount(); });
    }
  });
});
