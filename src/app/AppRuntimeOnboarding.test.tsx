import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_LIBRARY_STATS } from '../features/librarySession/cloudLibraryPageController';
import { onboardingLibraryState, useOnboardingLibraryState } from '../features/onboarding/useOnboardingLibraryState';

const countCards = vi.hoisted(() => vi.fn());
vi.mock('../lib/firebase', () => ({ db: {} }));
vi.mock('../lib/cardRepository', () => ({ countCards }));

const cloud = (ownerId: string | null, total = 0) => ({
  ownerId,
  isLoading: false,
  cloudUnavailable: false,
  items: [],
  total,
  stats: EMPTY_LIBRARY_STATS,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

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
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('top', globalThis);
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('addEventListener', vi.fn());
  vi.stubGlobal('removeEventListener', vi.fn());
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement {});
  vi.stubGlobal('HTMLElement', class HTMLElement {});
  vi.stubGlobal('Node', class Node {});
  return container as unknown as Element;
};

describe('AppRuntime onboarding library binding', () => {
  it('classifies cards from the current cloud snapshot before the projected count updates', () => {
    const nextCloud = cloud('legacy-owner', 1);

    expect(onboardingLibraryState('legacy-owner', nextCloud)).toEqual({
      libraryReady: true,
      hasCards: true,
    });
  });

  it('waits for owner-wide count when the current filtered page is empty', () => {
    const filteredEmpty = cloud('legacy-owner');
    expect(onboardingLibraryState('legacy-owner', filteredEmpty)).toEqual({
      libraryReady: false,
      hasCards: false,
    });
    expect(onboardingLibraryState('legacy-owner', filteredEmpty, { ownerId: 'legacy-owner', count: 4 })).toEqual({
      libraryReady: true,
      hasCards: true,
    });
    expect(onboardingLibraryState('new-owner', cloud('new-owner'), { ownerId: 'new-owner', count: 0 })).toEqual({
      libraryReady: true,
      hasCards: false,
    });
  });

  it('does not classify another owner or an empty cached page', () => {
    expect(onboardingLibraryState('new-owner', cloud('previous-owner', 4))).toEqual({
      libraryReady: false,
      hasCards: false,
    });
    expect(onboardingLibraryState('new-owner', cloud('new-owner'), { ownerId: 'previous-owner', count: 4 })).toEqual({
      libraryReady: false,
      hasCards: false,
    });
    expect(onboardingLibraryState('legacy-owner', {
      ...cloud('legacy-owner'),
      isLoading: true,
    })).toEqual({ libraryReady: false, hasCards: false });
  });

  it('ignores a pending zero count when the gate is suppressed and recounts on return', async () => {
    const first = deferred<number>();
    const second = deferred<number>();
    countCards.mockReset().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const root = createRoot(installMinimalReactDom());
    let state = { libraryReady: false, hasCards: false };
    const Probe = ({ canClassify }: { canClassify: boolean }) => {
      state = useOnboardingLibraryState({
        ownerId: 'legacy-owner', cloud: cloud('legacy-owner'), needsOnboarding: true, canClassify,
      });
      return null;
    };

    await act(async () => { root.render(<Probe canClassify={false} />); });
    expect(countCards).not.toHaveBeenCalled();
    await act(async () => { root.render(<Probe canClassify />); });
    await vi.waitFor(() => expect(countCards).toHaveBeenCalledOnce());
    expect(countCards.mock.calls[0][2]).toMatchObject({
      category: null, customDeck: { kind: 'all' }, difficulty: null, partOfSpeech: null,
      bookmarkedOnly: false, createdDate: null, wordPrefix: '', targetLanguage: null,
    });

    await act(async () => { root.render(<Probe canClassify={false} />); });
    await act(async () => { first.resolve(0); await first.promise; });
    expect(state).toEqual({ libraryReady: false, hasCards: false });

    await act(async () => { root.render(<Probe canClassify />); });
    await vi.waitFor(() => expect(countCards).toHaveBeenCalledTimes(2));
    await act(async () => { second.resolve(4); await second.promise; });
    expect(state).toEqual({ libraryReady: true, hasCards: true });
    await act(async () => { root.unmount(); });
    vi.unstubAllGlobals();
  });
});
