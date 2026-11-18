import { act, type RefObject, type SetStateAction } from 'react';
import { createRoot } from 'react-dom/client';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LearningWorkspaceActions } from '../features/learning/useLearningWorkspace';
import { useLibraryMutationFeedback } from './use-library-mutation-feedback';

i18n.load('en', {});
i18n.activate('en');

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const installMinimalReactDom = () => {
  const documentLike: Record<string, unknown> = {
    nodeType: 9,
    activeElement: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    defaultView: globalThis,
  };
  const container = {
    nodeType: 1,
    ownerDocument: documentLike,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
  };
  documentLike.documentElement = container;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('top', globalThis);
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement {});
  vi.stubGlobal('HTMLElement', class HTMLElement {});
  vi.stubGlobal('Node', class Node {});
  return container as unknown as Element;
};

type Feedback = ReturnType<typeof useLibraryMutationFeedback>;

const createCommands = (): Pick<LearningWorkspaceActions, 'deleteCard' | 'restoreCard' | 'clearLibrary'> => ({
  deleteCard: vi.fn(),
  restoreCard: vi.fn(),
  clearLibrary: vi.fn(),
});

describe('useLibraryMutationFeedback', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps clear open through working, success, retryable failure, and reset', async () => {
    const clear = deferred<void>();
    const commands = createCommands();
    vi.mocked(commands.clearLibrary).mockReturnValueOnce(clear.promise);
    const reportError = vi.fn();
    const activeOwnerIdRef = { current: 'owner-a' } as RefObject<string | null>;
    const captured: { current: Feedback | null } = { current: null };
    const root = createRoot(installMinimalReactDom());

    function Probe() {
      captured.current = useLibraryMutationFeedback({
        ownerId: 'owner-a', activeOwnerIdRef, commands, isLibraryBusy: false, reportError, offerUndo: vi.fn(),
      });
      return null;
    }

    try {
      act(() => root.render(<I18nProvider i18n={i18n}><Probe /></I18nProvider>));
      let firstRequest!: Promise<void>;
      act(() => { firstRequest = captured.current!.clearAll(); });
      expect(captured.current!.clearStatus).toBe('working');
      act(() => { void captured.current!.clearAll(); });
      expect(commands.clearLibrary).toHaveBeenCalledOnce();

      await act(async () => {
        clear.resolve();
        await firstRequest;
      });
      expect(captured.current!.clearStatus).toBe('success');
      expect(reportError).not.toHaveBeenCalled();

      const failed = deferred<void>();
      vi.mocked(commands.clearLibrary).mockReturnValueOnce(failed.promise);
      act(() => captured.current!.resetClearFeedback());
      expect(captured.current!.clearStatus).toBe('idle');
      let failedRequest!: Promise<void>;
      act(() => { failedRequest = captured.current!.clearAll(); });
      expect(captured.current!.clearStatus).toBe('working');
      await act(async () => {
        failed.reject(new Error('clear unavailable'));
        await failedRequest;
      });
      expect(captured.current!.clearStatus).toBe('failure');
      expect(captured.current!.clearError).toBe('clear unavailable');
      expect(reportError).not.toHaveBeenCalled();

      vi.mocked(commands.clearLibrary).mockResolvedValueOnce(undefined);
      let retryRequest!: Promise<void>;
      act(() => { retryRequest = captured.current!.clearAll(); });
      expect(captured.current!.clearStatus).toBe('working');
      await act(async () => { await retryRequest; });
      expect(captured.current!.clearStatus).toBe('success');
    } finally {
      act(() => root.unmount());
    }
  });

  it('drops a deferred clear result when the active owner changes', async () => {
    const clear = deferred<void>();
    const commands = createCommands();
    vi.mocked(commands.clearLibrary).mockReturnValue(clear.promise);
    const reportError = vi.fn();
    const activeOwnerIdRef = { current: 'owner-a' } as RefObject<string | null>;
    const captured: { current: Feedback | null } = { current: null };
    const root = createRoot(installMinimalReactDom());

    function Probe({ ownerId }: { ownerId: string }) {
      activeOwnerIdRef.current = ownerId;
      captured.current = useLibraryMutationFeedback({
        ownerId, activeOwnerIdRef, commands, isLibraryBusy: false, reportError, offerUndo: vi.fn(),
      });
      return null;
    }

    try {
      act(() => root.render(<I18nProvider i18n={i18n}><Probe ownerId="owner-a" /></I18nProvider>));
      let firstRequest!: Promise<void>;
      act(() => { firstRequest = captured.current!.clearAll(); });
      expect(captured.current!.clearStatus).toBe('working');

      act(() => root.render(<I18nProvider i18n={i18n}><Probe ownerId="owner-b" /></I18nProvider>));
      expect(captured.current!.clearStatus).toBe('idle');
      clear.resolve();
      await act(async () => { await firstRequest; });
      expect(captured.current!.clearStatus).toBe('idle');
      expect(captured.current!.clearError).toBeNull();
      expect(reportError).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
    }
  });

  it('continues reporting card deletion failures', async () => {
    const commands = createCommands();
    vi.mocked(commands.deleteCard).mockRejectedValueOnce(new Error('delete unavailable'));
    const reportError = vi.fn();
    const activeOwnerIdRef = { current: 'owner-a' } as RefObject<string | null>;
    const captured: { current: Feedback | null } = { current: null };
    const root = createRoot(installMinimalReactDom());

    function Probe() {
      captured.current = useLibraryMutationFeedback({
        ownerId: 'owner-a', activeOwnerIdRef, commands, isLibraryBusy: false, reportError, offerUndo: vi.fn(),
      });
      return null;
    }

    try {
      act(() => root.render(<I18nProvider i18n={i18n}><Probe /></I18nProvider>));
      let deleted!: boolean;
      await act(async () => { deleted = await captured.current!.deleteCard('card-a'); });
      expect(deleted).toBe(false);
      expect(reportError).toHaveBeenCalledWith('delete unavailable');
    } finally {
      act(() => root.unmount());
    }
  });

  it('does not dispatch a deletion for an owner that is no longer active', async () => {
    const commands = createCommands();
    const activeOwnerIdRef = { current: 'owner-b' } as RefObject<string | null>;
    const captured: { current: Feedback | null } = { current: null };
    const root = createRoot(installMinimalReactDom());

    function Probe() {
      captured.current = useLibraryMutationFeedback({
        ownerId: 'owner-a', activeOwnerIdRef, commands, isLibraryBusy: false, reportError: vi.fn(), offerUndo: vi.fn(),
      });
      return null;
    }

    try {
      act(() => root.render(<I18nProvider i18n={i18n}><Probe /></I18nProvider>));
      await act(async () => { await expect(captured.current!.deleteCard('card-a')).resolves.toBe(false); });
      expect(commands.deleteCard).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
    }
  });

  it('clears only its own stale delete error after a successful retry', async () => {
    const commands = createCommands();
    vi.mocked(commands.deleteCard)
      .mockRejectedValueOnce(new Error('delete unavailable'))
      .mockResolvedValueOnce({ status: 'published', result: {} } as never);
    const activeOwnerIdRef = { current: 'owner-a' } as RefObject<string | null>;
    const captured: { current: Feedback | null } = { current: null };
    let banner: string | null = null;
    const reportError = vi.fn((next: SetStateAction<string | null>) => {
      banner = typeof next === 'function' ? next(banner) : next;
    });
    const root = createRoot(installMinimalReactDom());

    function Probe() {
      captured.current = useLibraryMutationFeedback({
        ownerId: 'owner-a', activeOwnerIdRef, commands, isLibraryBusy: false, reportError, offerUndo: vi.fn(),
      });
      return null;
    }

    try {
      act(() => root.render(<I18nProvider i18n={i18n}><Probe /></I18nProvider>));
      await act(async () => { await expect(captured.current!.deleteCard('card-a')).resolves.toBe(false); });
      expect(banner).toBe('delete unavailable');

      banner = 'A different error';
      await act(async () => { await expect(captured.current!.deleteCard('card-a')).resolves.toBe(true); });
      expect(banner).toBe('A different error');
    } finally {
      act(() => root.unmount());
    }
  });

  it('clears an unchanged delete error after an ordinary same-card retry', async () => {
    const commands = createCommands();
    vi.mocked(commands.deleteCard)
      .mockRejectedValueOnce(new Error('delete unavailable'))
      .mockResolvedValueOnce({ status: 'published', result: {} } as never);
    const activeOwnerIdRef = { current: 'owner-a' } as RefObject<string | null>;
    const captured: { current: Feedback | null } = { current: null };
    let banner: string | null = null;
    const reportError = vi.fn((next: SetStateAction<string | null>) => {
      banner = typeof next === 'function' ? next(banner) : next;
    });
    const root = createRoot(installMinimalReactDom());

    function Probe() {
      captured.current = useLibraryMutationFeedback({
        ownerId: 'owner-a', activeOwnerIdRef, commands, isLibraryBusy: false, reportError, offerUndo: vi.fn(),
      });
      return null;
    }

    try {
      act(() => root.render(<I18nProvider i18n={i18n}><Probe /></I18nProvider>));
      await act(async () => { await expect(captured.current!.deleteCard('card-a')).resolves.toBe(false); });
      expect(banner).toBe('delete unavailable');
      await act(async () => { await expect(captured.current!.deleteCard('card-a')).resolves.toBe(true); });
      expect(banner).toBeNull();
    } finally {
      act(() => root.unmount());
    }
  });

  it('does not clear a later card failure with the same message', async () => {
    const first = deferred<{ status: 'published'; result: {} }>();
    const commands = createCommands();
    vi.mocked(commands.deleteCard).mockImplementation(cardId => cardId === 'card-a'
      ? first.promise as never
      : Promise.reject(new Error('The card could not be deleted. Please try again.')) as never);
    const activeOwnerIdRef = { current: 'owner-a' } as RefObject<string | null>;
    const captured: { current: Feedback | null } = { current: null };
    let banner: string | null = null;
    const reportError = vi.fn((next: SetStateAction<string | null>) => {
      banner = typeof next === 'function' ? next(banner) : next;
    });
    const root = createRoot(installMinimalReactDom());

    function Probe() {
      captured.current = useLibraryMutationFeedback({
        ownerId: 'owner-a', activeOwnerIdRef, commands, isLibraryBusy: false, reportError, offerUndo: vi.fn(),
      });
      return null;
    }

    try {
      act(() => root.render(<I18nProvider i18n={i18n}><Probe /></I18nProvider>));
      const firstRequest = captured.current!.deleteCard('card-a');
      await act(async () => { await expect(captured.current!.deleteCard('card-b')).resolves.toBe(false); });
      expect(banner).toBe('The card could not be deleted. Please try again.');

      first.resolve({ status: 'published', result: {} });
      await act(async () => { await expect(firstRequest).resolves.toBe(true); });
      expect(banner).toBe('The card could not be deleted. Please try again.');
    } finally {
      act(() => root.unmount());
    }
  });

  it('does not report deletion success to a replacement owner', async () => {
    const pending = deferred<{ status: 'published'; result: { undoToken?: never } }>();
    const commands = createCommands();
    vi.mocked(commands.deleteCard).mockReturnValueOnce(pending.promise as never);
    const activeOwnerIdRef = { current: 'owner-a' } as RefObject<string | null>;
    const captured: { current: Feedback | null } = { current: null };
    const root = createRoot(installMinimalReactDom());

    function Probe() {
      captured.current = useLibraryMutationFeedback({
        ownerId: 'owner-a', activeOwnerIdRef, commands, isLibraryBusy: false, reportError: vi.fn(), offerUndo: vi.fn(),
      });
      return null;
    }

    try {
      act(() => root.render(<I18nProvider i18n={i18n}><Probe /></I18nProvider>));
      let request!: Promise<boolean>;
      act(() => { request = captured.current!.deleteCard('card-a'); });
      activeOwnerIdRef.current = 'owner-b';
      pending.resolve({ status: 'published', result: {} });
      await act(async () => { await expect(request).resolves.toBe(false); });
    } finally {
      act(() => root.unmount());
    }
  });
});
