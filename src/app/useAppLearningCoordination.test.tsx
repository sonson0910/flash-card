import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({
  learning: null as null | { library: { publication: { remove(id: string): void; clear(): void; patch(id: string, f: object): void; restore(c: object): void } } },
  intake: null as null | { intake: { rememberPromoted(card: object): void } },
  decks: null as null | { ports: { publishCards(cardIds: ReadonlySet<string>, fields: object): void } },
}));

vi.mock('../lib/firebase', () => ({ db: null }));
vi.mock('../features/learning/useLearningWorkspace', () => ({
  useLearningWorkspace: (options: never) => { captured.learning = options; return { actions: {} }; },
}));
vi.mock('../features/intake/useIntakeSharingSession', () => ({
  useIntakeSharingSession: (options: never) => {
    captured.intake = options;
    return { model: { isBusy: false }, actions: { createConfirmedCatalogCards: vi.fn(), shareCategory: vi.fn(), cardCreator: { open: vi.fn() } } };
  },
}));
vi.mock('../features/practice/usePracticeWorkspace', () => ({
  usePracticeWorkspace: () => ({
    model: {
      session: null,
      gamification: {
        streak: 0, xp: 0, xpHistory: [], level: 1, rewards: { equippedFrameId: null, ownedTitleIds: [] },
        reviewActivityByLanguage: {}, rewardTimeZone: 'UTC', acceptAuthoritativeOutcome: vi.fn(), equipFrame: vi.fn(),
      },
    },
    actions: { startStudy: vi.fn(), startStudyWithCards: vi.fn() },
    ports: { loadPracticePool: vi.fn() },
    snapshotRef: { current: { findCard: vi.fn(), restoreCard: vi.fn(), updateCard: vi.fn(), removeCard: vi.fn(), clear: vi.fn(), updateCards: vi.fn() } },
  }),
}));
vi.mock('../features/library/useCustomDeckWorkspace', () => ({
  useCustomDeckWorkspace: (options: never) => { captured.decks = options; return { model: { decks: [], coverPresets: {}, newDeckInput: '' }, actions: { changeNewDeckInput: vi.fn(), createDeck: vi.fn(), deleteDeck: vi.fn() } }; },
}));
vi.mock('../features/library/useLibraryScreenContract', () => ({ useLibraryScreenContract: () => ({}) }));
vi.mock('./use-library-mutation-feedback', () => ({
  useLibraryMutationFeedback: () => ({ deleteCard: vi.fn(), clearAll: vi.fn(), clearStatus: null, clearError: null, resetClearFeedback: vi.fn() }),
}));
vi.mock('./useCatalogUnitContinuation', () => ({ useCatalogUnitContinuation: () => vi.fn() }));
vi.mock('./useAppCardMediaHydration', () => ({
  useAppCardMediaHydration: () => ({ actions: { invalidateCard: vi.fn(), isLifecycleCurrent: () => true, hydrateCard: vi.fn() } }),
}));
vi.mock('./appDependencies', () => ({
  appDependencies: {
    practice: { pool: {} }, sessions: { learningWorkspace: {}, intakeSharing: {} },
    configuration: { cloudAvailable: true }, adapters: { ownerDecks: {} }, intake: { forOwner: () => ({}) },
  },
}));

import { useAppLearningCoordination } from './useAppLearningCoordination';
import { overlayRecentlyPromotedCards } from '../features/library/libraryPresentation';
import { ALL_PRACTICE_DECK_SCOPE } from '../lib/practiceScope';
import type { CardData } from '../types/card';

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

const card = (word: string, extra: Partial<CardData> = {}): CardData => ({
  id: `word-${word}`, word, normalizedWord: word, translation: 'x', explanation: '', phonetic: '', emoji: 'x',
  category: 'Other', audioUrl: null, imageUrl: null, createdAt: '2026-11-18T00:00:00.000Z', bookmarked: false,
  sortTouchedAt: '2026-11-18T10:00:00.000Z', ...extra,
});
const filters = {
  category: null, customDeck: ALL_PRACTICE_DECK_SCOPE, difficulty: null, partOfSpeech: null,
  bookmarkedOnly: false, createdDate: null, wordPrefix: '',
} as never;

const renderCoordination = async () => {
  const promotedRef = { current: new Map<string, CardData>() };
  const library = {
    model: {
      cards: [], user: { uid: 'owner-a' }, cloudStats: {}, knownLibraryTotal: 0, libraryEpochState: null,
      ownerLibrary: { ownerId: 'owner-a', decks: [], coverPresets: {} },
      librarySession: { identity: { status: 'ready', canPublishMutations: true } },
      externalLibraryBusy: false, cardsPerPage: 20, catalog: { deck: ALL_PRACTICE_DECK_SCOPE },
    },
    actions: { catalog: { goToPage: vi.fn(), replaceQuery: vi.fn(), chooseDeckScope: vi.fn() }, migrateLegacyCards: vi.fn() },
    ports: {
      setCards: vi.fn(), cardsRef: { current: [] }, activeOwnerIdRef: { current: 'owner-a' },
      recentlyPromotedCardsRef: promotedRef, practicePublicationRef: { current: null },
      setCloudStats: vi.fn(), setCloudTotal: vi.fn(), setCloudReadUnavailable: vi.fn(), refreshCloud: vi.fn(),
      setLibraryMutationPending: vi.fn(), updateCategoryFacets: vi.fn(),
      browser: { actions: { requestLibraryFocus: vi.fn(), bumpHydrationSession: vi.fn() }, refs: { libraryHeading: { current: null } } },
      session: { actions: { identity: { acceptVerifiedOwnerEpoch: vi.fn() } } },
      sessionPorts: { resetCloudState: vi.fn(), refreshCloud: vi.fn(), markCloudUnavailable: vi.fn() },
    },
  };
  const root = createRoot(installMinimalReactDom());
  function Harness() {
    useAppLearningCoordination({
      library: library as never, courseScopeReady: true, viewMode: 'library' as never,
      languageProfile: { source: { code: 'en' } } as never, coursePort: null, setViewMode: vi.fn(),
      setPracticeMenuOpen: vi.fn(), rememberOpener: vi.fn(), shareOpenerRef: { current: null },
      reportError: vi.fn(), notify: vi.fn(), offerUndo: vi.fn(),
    });
    return null;
  }
  await act(async () => { root.render(createElement(Harness)); });
  // Same expression as useAppLibraryRuntime's promotedCards() publication.
  const page1 = (snapshot: CardData[]) => overlayRecentlyPromotedCards({
    pageCards: snapshot, promotedCards: [...promotedRef.current.values()], filters, page: 1, pageSize: 20,
  });
  return { root, page1 };
};

describe('recently promoted overlay follows later library mutations', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('does not bring back a card deleted after it was created this session', async () => {
    const { root, page1 } = await renderCoordination();
    try {
      const apple = card('apple');
      captured.intake!.intake.rememberPromoted(apple);
      captured.learning!.library.publication.remove(apple.id);
      const shown = page1([card('banana', { sortTouchedAt: '2026-11-17T00:00:00.000Z' })]).map(c => c.word);
      expect(shown).not.toContain('apple');
    } finally { await act(async () => { root.unmount(); }); }
  });

  it('leaves page 1 empty after the library is cleared', async () => {
    const { root, page1 } = await renderCoordination();
    try {
      captured.intake!.intake.rememberPromoted(card('apple'));
      captured.intake!.intake.rememberPromoted(card('pear'));
      captured.learning!.library.publication.clear();
      const shown = page1([]).map(c => c.word);
      expect(shown).toEqual([]);
    } finally { await act(async () => { root.unmount(); }); }
  });

  it('keeps a bookmark saved after creation on page 1', async () => {
    const { root, page1 } = await renderCoordination();
    try {
      const apple = card('apple');
      captured.intake!.intake.rememberPromoted(apple);
      captured.learning!.library.publication.patch(apple.id, { bookmarked: true });
      const shown = page1([{ ...apple, bookmarked: true, revision: 2 } as CardData]).find(c => c.word === 'apple');
      expect(shown?.bookmarked).toBe(true);
    } finally { await act(async () => { root.unmount(); }); }
  });

  it('shows the patched copy of a promoted card that the page does not contain yet', async () => {
    const { root, page1 } = await renderCoordination();
    try {
      const apple = card('apple');
      captured.intake!.intake.rememberPromoted(apple);
      captured.learning!.library.publication.patch(apple.id, { bookmarked: true, translation: 'táo' });
      expect(page1([]).find(c => c.id === apple.id)).toMatchObject({ bookmarked: true, translation: 'táo' });
    } finally { await act(async () => { root.unmount(); }); }
  });

  it('follows a word edit instead of keeping the old word pinned', async () => {
    const { root, page1 } = await renderCoordination();
    try {
      const apple = card('apple');
      captured.intake!.intake.rememberPromoted(apple);
      captured.learning!.library.publication.patch(apple.id, { word: 'apples', normalizedWord: 'apples' });
      expect(page1([]).map(c => c.word)).toEqual(['apples']);
    } finally { await act(async () => { root.unmount(); }); }
  });

  it('applies a deck change published for several cards to promoted copies', async () => {
    const { root, page1 } = await renderCoordination();
    try {
      const apple = card('apple', { customDeck: 'Fruit' });
      captured.intake!.intake.rememberPromoted(apple);
      captured.decks!.ports.publishCards(new Set([apple.id]), { customDeck: null });
      expect(page1([]).find(c => c.id === apple.id)?.customDeck).toBeNull();
    } finally { await act(async () => { root.unmount(); }); }
  });

  it('brings a deleted card back when the delete is undone', async () => {
    const { root, page1 } = await renderCoordination();
    try {
      const apple = card('apple');
      captured.intake!.intake.rememberPromoted(apple);
      captured.learning!.library.publication.remove(apple.id);
      captured.learning!.library.publication.restore(apple);
      expect(page1([]).map(c => c.word)).toEqual(['apple']);
    } finally { await act(async () => { root.unmount(); }); }
  });
});
