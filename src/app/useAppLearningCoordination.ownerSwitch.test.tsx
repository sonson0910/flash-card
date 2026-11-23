import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../types/card';
import type { LearningStateOutcome } from '../features/learning/learningStateController';
import type { AppLibraryRuntime } from './useAppLibraryRuntime';

type CardUpdater = (cardId: string, fields: Partial<CardData>) => Promise<LearningStateOutcome>;

const runtime = vi.hoisted(() => ({
  applyCardPatchIfCurrent: vi.fn(),
  refs: { slots: [] as Array<{ current: unknown }>, index: 0 },
  // What each screen received on the latest render.
  screens: {
    study: null as { updateCard: CardUpdater } | null,
    library: null as { updateCard: CardUpdater } | null,
  },
}));

// The static renderer mounts afresh on every call; keeping the useRef slots makes a second
// render behave like a re-render of the same mounted app after the signed-in account changed.
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  const useRef = (initial: unknown) => {
    const slot = runtime.refs.index++;
    if (!runtime.refs.slots[slot]) runtime.refs.slots[slot] = { current: initial };
    return runtime.refs.slots[slot];
  };
  return { ...actual, default: { ...actual, useRef }, useRef };
});
vi.mock('../lib/firebase', () => ({
  app: { kind: 'app' },
  auth: { currentUser: null },
  db: { kind: 'database' },
  handleFirestoreError: vi.fn(),
  isFirebaseConfigured: true,
  OperationType: { DELETE: 'delete' },
  protectedFunctionsCapability: { available: true },
  getSonFlashFunctions: vi.fn(async () => ({ kind: 'functions' })),
}));
vi.mock('firebase/functions', () => ({ getFunctions: vi.fn(), httpsCallable: vi.fn(() => vi.fn()) }));
vi.mock('../lib/cardRepository', async () => ({
  ...await vi.importActual<typeof import('../lib/cardRepository')>('../lib/cardRepository'),
  applyCardPatchIfCurrent: runtime.applyCardPatchIfCurrent,
}));
vi.mock('../features/library/libraryStorage', async () => ({
  ...await vi.importActual<typeof import('../features/library/libraryStorage')>('../features/library/libraryStorage'),
  isCloudBackoffActive: () => false,
}));
vi.mock('./appDependencies', async () => {
  const { defaultLearningPersistenceHook } = await import('../features/learning/learningWorkspacePersistenceAdapter');
  return {
    appDependencies: {
      configuration: { cloudAvailable: true },
      practice: { pool: null },
      adapters: { ownerDecks: {} },
      intake: { forOwner: () => ({}) },
      sessions: { learningWorkspace: { usePersistence: defaultLearningPersistenceHook }, intakeSharing: {} },
    },
  };
});
// The screens around the learning workspace are stand-ins that record what they were handed.
vi.mock('../features/practice/usePracticeWorkspace', () => ({
  usePracticeWorkspace: (options: { learning: { updateCard: CardUpdater } }) => {
    runtime.screens.study = options.learning;
    return {
      model: { session: { learning: options.learning }, gamification: { rewards: {}, acceptAuthoritativeOutcome: vi.fn() } },
      actions: {},
      ports: { loadPracticePool: vi.fn() },
      snapshotRef: { current: { findCard: () => undefined, updateCard: vi.fn(), updateCards: vi.fn(), removeCard: vi.fn(), restoreCard: vi.fn(), clear: vi.fn() } },
    };
  },
}));
vi.mock('../features/library/useLibraryScreenContract', () => ({
  useLibraryScreenContract: (input: { workspace: { learning: { actions: { updateCard: CardUpdater } } } }) => {
    runtime.screens.library = input.workspace.learning.actions;
    return {};
  },
}));
vi.mock('./useAppCardMediaHydration', () => ({
  useAppCardMediaHydration: () => ({ actions: { isLifecycleCurrent: () => true, invalidateCard: vi.fn(), hydrateCard: vi.fn() } }),
}));
vi.mock('../features/library/useCustomDeckWorkspace', () => ({
  useCustomDeckWorkspace: () => ({ model: { decks: [], coverPresets: {}, newDeckInput: '' }, actions: {} }),
}));
vi.mock('../features/intake/useIntakeSharingSession', () => ({
  useIntakeSharingSession: () => ({ model: { isBusy: false }, actions: { cardCreator: {} } }),
}));
vi.mock('./useCatalogUnitContinuation', () => ({ useCatalogUnitContinuation: () => vi.fn() }));
vi.mock('./use-library-mutation-feedback', () => ({
  useLibraryMutationFeedback: () => ({ deleteCard: vi.fn(), clearAll: vi.fn(), clearStatus: 'idle', clearError: null, resetClearFeedback: vi.fn() }),
}));

import { ENGLISH_TO_VIETNAMESE_PROFILE } from '../features/language/languageProfile';
import { useAppLearningCoordination } from './useAppLearningCoordination';

const sharedCard = {
  id: 'word-focus',
  word: 'focus',
  normalizedWord: 'focus',
  explanation: 'Close attention.',
  phonetic: '',
  emoji: '🎯',
  category: 'Study',
  audioUrl: null,
  imageUrl: null,
  bookmarked: false,
  libraryEpoch: 0,
} satisfies Partial<CardData>;
// Card ids are derived from the word, so two accounts hold the same word under the same id.
const firstOwnerCard: CardData = { ...sharedCard, translation: 'tập trung (first owner wording)', revision: 3 };
const nextOwnerCard: CardData = { ...sharedCard, translation: 'sự chú ý', revision: 9 };

const libraryFor = (ownerId: string, cards: CardData[]) => {
  const setCards = vi.fn();
  const library = {
    model: {
      cards,
      user: { uid: ownerId },
      cloudStats: {},
      knownLibraryTotal: cards.length,
      libraryEpochState: { userId: ownerId, value: 0 },
      ownerLibrary: { ownerId, decks: [], coverPresets: {} },
      librarySession: { identity: { status: 'ready', canPublishMutations: true } },
      externalLibraryBusy: false,
      cardsPerPage: 24,
      catalog: { deck: { kind: 'all' } },
    },
    actions: { catalog: { goToPage: vi.fn(), replaceQuery: vi.fn(), chooseDeckScope: vi.fn() }, migrateLegacyCards: vi.fn() },
    ports: {
      cardsRef: { current: cards },
      setCards,
      practicePublicationRef: { current: null },
      recentlyPromotedCardsRef: { current: new Map() },
      activeOwnerIdRef: { current: ownerId },
      browser: { actions: { requestLibraryFocus: vi.fn(), bumpHydrationSession: vi.fn() }, refs: { libraryHeading: { current: null } } },
      session: { actions: { identity: { acceptVerifiedOwnerEpoch: vi.fn() } } },
      sessionPorts: { resetCloudState: vi.fn(), refreshCloud: vi.fn(), markCloudUnavailable: vi.fn() },
      setCloudStats: vi.fn(),
      setCloudTotal: vi.fn(),
      setCloudReadUnavailable: vi.fn(),
      setLibraryMutationPending: vi.fn(),
      updateCategoryFacets: vi.fn(async () => undefined),
      refreshCloud: vi.fn(),
    },
  };
  return { library: library as unknown as AppLibraryRuntime, setCards };
};

function App({ library }: { library: AppLibraryRuntime }) {
  useAppLearningCoordination({
    library,
    courseScopeReady: true,
    viewMode: 'library',
    languageProfile: ENGLISH_TO_VIETNAMESE_PROFILE,
    coursePort: null,
    setViewMode: vi.fn(),
    setPracticeMenuOpen: vi.fn(),
    rememberOpener: vi.fn(),
    shareOpenerRef: { current: null },
    reportError: vi.fn(),
    notify: vi.fn(),
    offerUndo: vi.fn(),
  });
  return null;
}
const renderAs = (library: AppLibraryRuntime) => {
  runtime.refs.index = 0;
  renderToStaticMarkup(<App library={library} />);
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
};

// The card handlers (memory hook, explanation translation, edit sheet after a headword rename) all
// have this shape: wait for a slow answer, then write it back through the updater they were rendered with.
const requestWriteBack = (updateCard: CardUpdater, answer: Promise<Partial<CardData>>) =>
  answer.then(fields => updateCard(firstOwnerCard.id, fields));

const lateWriteBacks: Array<[string, Partial<CardData>]> = [
  ['a memory hook', { mnemonic: 'hook built from the first owner wording' }],
  ['an explanation translation', { explanationTranslation: 'bản dịch của chủ thẻ đầu tiên' }],
  ['an edit sheet save', { translation: 'first owner free text', explanation: 'first owner note' }],
];

describe('card write-back that settles after the signed-in account changed', () => {
  beforeEach(() => {
    runtime.refs.slots = [];
    runtime.screens.study = null;
    runtime.screens.library = null;
    runtime.applyCardPatchIfCurrent.mockReset();
    runtime.applyCardPatchIfCurrent.mockResolvedValue({ applied: true, revision: 10 });
  });

  describe.each(['study', 'library'] as const)('requested from the %s screen', screen => {
    it.each(lateWriteBacks)('keeps %s out of the next account card with the same id', async (_label, fields) => {
      const first = libraryFor('owner-a', [firstOwnerCard]);
      const next = libraryFor('owner-b', [nextOwnerCard]);
      renderAs(first.library);
      const answer = deferred<Partial<CardData>>();
      const writeBack = requestWriteBack(runtime.screens[screen]!.updateCard, answer.promise);

      renderAs(next.library);
      answer.resolve(fields);

      expect(await writeBack).toEqual({ status: 'stale-owner' });
      expect(runtime.applyCardPatchIfCurrent).not.toHaveBeenCalled();
      expect(next.setCards).not.toHaveBeenCalled();
    });

    it('still saves a write-back for the account that requested it', async () => {
      const first = libraryFor('owner-a', [firstOwnerCard]);
      renderAs(first.library);
      const answer = deferred<Partial<CardData>>();
      const writeBack = requestWriteBack(runtime.screens[screen]!.updateCard, answer.promise);

      renderAs(first.library);
      answer.resolve({ mnemonic: 'hook' });

      expect(await writeBack).toMatchObject({ status: 'published' });
      expect(runtime.applyCardPatchIfCurrent).toHaveBeenCalledTimes(1);
      expect(runtime.applyCardPatchIfCurrent).toHaveBeenCalledWith(
        expect.anything(),
        'owner-a',
        expect.objectContaining({ cardId: firstOwnerCard.id, fields: { mnemonic: 'hook' }, baseRevision: 3 }),
      );
    });

    it('lets the next account edit its own card after the switch', async () => {
      renderAs(libraryFor('owner-a', [firstOwnerCard]).library);
      renderAs(libraryFor('owner-b', [nextOwnerCard]).library);

      const outcome = await runtime.screens[screen]!.updateCard(nextOwnerCard.id, { mnemonic: 'next owner hook' });

      expect(outcome).toMatchObject({ status: 'published' });
      expect(runtime.applyCardPatchIfCurrent).toHaveBeenCalledWith(
        expect.anything(),
        'owner-b',
        expect.objectContaining({ cardId: nextOwnerCard.id, baseRevision: 9 }),
      );
    });
  });
});
