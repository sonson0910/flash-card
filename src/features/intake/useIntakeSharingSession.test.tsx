import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import type { CardIntakeControllerPort } from './cardIntakeController';
import { useCardIntakePort } from './useCardIntakePort';
import type { CardIntakePortOptions } from './cardIntakePortContract';
import {
  useIntakeSharingSession,
  type IntakeSharingSessionActions,
  type IntakeSharingSessionModel,
} from './useIntakeSharingSession';

const card = (id: string): CardData => ({
  id,
  word: id,
  translation: `${id}-vi`,
  explanation: '',
  phonetic: '',
  emoji: '📝',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
});

const intakeOptions = (): CardIntakePortOptions => ({
  ownerId: null,
  libraryEpoch: null,
  knownLibraryTotal: 0,
  cloudStats: { total: 0, reviewed: 0, easy: 0, good: 0, hard: 0, unrated: 0, bookmarked: 0, due: 0, legacyUnindexed: 0 },
  cardsPerPage: 9,
  getCards: () => [],
  publishCards: vi.fn(),
  upsertDeviceCards: async () => [],
  acknowledgeDevicePending: async () => undefined,
  patchCard: async () => undefined,
  hydrateExisting: vi.fn(),
  rememberPromoted: vi.fn(),
  resetCatalog: vi.fn(),
  resetCloudPage: vi.fn(),
  updateCloudStats: vi.fn(),
  updateCloudTotal: vi.fn(),
  updateCategoryFacets: async () => undefined,
  setCloudUnavailable: vi.fn(),
  notify: vi.fn(),
  focusLibrary: vi.fn(),
  addXp: vi.fn(),
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const intakePort = (): CardIntakeControllerPort => ({
  findExisting: vi.fn(async () => new Map()),
  persistStructured: vi.fn(async plan => ({ createdCount: plan.creates.length })),
  touchExisting: vi.fn(async () => undefined),
  generate: vi.fn(async () => ({ created: true })),
  completeFlat: vi.fn(async () => undefined),
  generateCard: vi.fn(async word => ({
    card: card(word),
    mediaPromise: Promise.resolve({ audioUrl: null, imageUrl: null }),
  })),
  persistCards: vi.fn(async (cards: readonly CardData[]) =>
    cards.map(value => ({ card: value, created: true }))),
  applyMedia: vi.fn(async () => undefined),
});

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
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement {});
  vi.stubGlobal('HTMLElement', class HTMLElement {});
  vi.stubGlobal('Node', class Node {});
  return container as unknown as Element;
};

describe('useIntakeSharingSession', () => {
  it('composes the three hooks behind a compact vendor-free boundary', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./useIntakeSharingSession.ts', import.meta.url)),
      'utf8',
    );

    expect(source).toMatch(/dependencies\.useIntakePort\(intake\)/);
    expect(source).toMatch(/IntakeSharingSessionDependencies/);
    expect(source).toMatch(/useCardIntake\(/);
    expect(source).toMatch(/useSharedDeckSession\(/);
    expect(source).not.toMatch(/firebase|firestore|cardRepository|Repository/);
    expect(source).not.toMatch(/from ['"]\.\/useCardIntakePort['"]/);
    expect(source).not.toMatch(/Dispatch|SetStateAction/);
  });

  it('exposes draft, file, progress, busy, feedback and share state through model/actions', async () => {
    const draft = { read: vi.fn(() => 'bonjour'), write: vi.fn(), clear: vi.fn() };
    const loadShareCards = vi.fn(async () => ({
      cards: [card('share')], total: 1, hasNext: false,
    }));
    let model: IntakeSharingSessionModel | null = null;
    let actions: IntakeSharingSessionActions | null = null;

    function Harness() {
      const session = useIntakeSharingSession({
        ownerKey: null,
        intake: intakeOptions(),
        draft,
        resetSpreadsheetSource: vi.fn(),
        sharing: {
          adapter: {
            load: async () => ({ cards: [] }),
            create: async () => ({ shareId: 'share-1', expiresAt: '2026-09-01T00:00:00.000Z' }),
            revoke: async () => undefined,
          },
          browser: {
            getCurrentUrl: () => 'https://example.test/library',
            replaceLocation: vi.fn(),
          },
          loadCards: loadShareCards,
        },
      }, { useIntakePort: useCardIntakePort });
      model = session.model;
      actions = session.actions;
      return null;
    }

    renderToStaticMarkup(<Harness />);

    expect(model).toMatchObject({
      draft: 'bonjour',
      importProgress: null,
      error: null,
      notice: null,
      isBusy: false,
      share: {
        isLoading: false,
        isShareDialogOpen: false,
        activeShareId: null,
        shareLink: null,
        shareWarning: null,
        incomingPreview: null,
        expiresAt: null,
      },
    });
    expect(Object.keys(actions!)).toEqual([
      'changeDraft', 'clearDraft', 'generate', 'importFile', 'adoptCards', 'shareCategory',
      'acceptShared', 'cancelShared', 'revokeShare', 'dismissShareLink', 'showShareDialog',
      'clearError', 'clearNotice', 'invalidateCard',
    ]);
    actions!.changeDraft('salut');
    expect(draft.write).toHaveBeenCalledWith('salut');
    actions!.clearDraft();
    expect(draft.clear).toHaveBeenCalledOnce();
    await expect(actions!.importFile(null)).resolves.toEqual({ status: 'missing' });
    expect(actions!.adoptCards).toEqual(expect.any(Function));
    await expect(actions!.shareCategory('IELTS')).resolves.toEqual({ status: 'unavailable' });
    expect(loadShareCards).toHaveBeenCalledWith('IELTS');
  });

  it('ignores cards loaded for a previous owner before creating or publishing a share', async () => {
    const pendingCards = deferred<{
      cards: readonly CardData[];
      total: number;
      hasNext: boolean;
    }>();
    const create = vi.fn(async () => ({
      shareId: 'owner-a-share',
      expiresAt: '2026-09-01T00:00:00.000Z',
    }));
    const sharing = {
      adapter: {
        load: vi.fn(async () => ({ cards: [] })),
        create,
        revoke: vi.fn(async () => undefined),
      },
      browser: {
        getCurrentUrl: () => 'https://example.test/library',
        replaceLocation: vi.fn(),
      },
      loadCards: vi.fn(() => pendingCards.promise),
    };
    const port = intakePort();
    const intake = intakeOptions();
    let latestModel: IntakeSharingSessionModel | null = null;
    let ownerAActions: IntakeSharingSessionActions | null = null;

    function Harness({ ownerKey }: { ownerKey: string }) {
      const session = useIntakeSharingSession({
        ownerKey,
        intake,
        sharing,
      }, { useIntakePort: () => port });
      latestModel = session.model;
      if (ownerKey === 'owner-a') ownerAActions = session.actions;
      return null;
    }

    const root = createRoot(installMinimalReactDom());
    try {
      await act(async () => {
        root.render(<Harness ownerKey="owner-a" />);
      });

      let shareResult!: ReturnType<IntakeSharingSessionActions['shareCategory']>;
      await act(async () => {
        shareResult = ownerAActions!.shareCategory('General');
        await Promise.resolve();
      });
      expect(sharing.loadCards).toHaveBeenCalledOnce();

      await act(async () => {
        root.render(<Harness ownerKey="owner-b" />);
      });
      await act(async () => {
        pendingCards.resolve({ cards: [card('owner-a-card')], total: 1, hasNext: false });
        await shareResult;
      });

      expect.soft(create).not.toHaveBeenCalled();
      expect(latestModel!.share).toEqual({
        isLoading: false,
        isShareDialogOpen: false,
        activeShareId: null,
        shareLink: null,
        shareWarning: null,
        incomingPreview: null,
        expiresAt: null,
      });
    } finally {
      await act(async () => {
        root.unmount();
      });
      vi.unstubAllGlobals();
    }
  });

  it('becomes busy before category loading, rejects duplicate starts, and preserves truncation metadata', async () => {
    const pendingCards = deferred<{
      cards: readonly CardData[];
      total: number;
      hasNext: boolean;
    }>();
    const create = vi.fn(async () => ({
      shareId: 'share-1',
      expiresAt: '2026-09-01T00:00:00.000Z',
    }));
    const sharing = {
      adapter: {
        load: vi.fn(async () => ({ cards: [] })),
        create,
        revoke: vi.fn(async () => undefined),
      },
      browser: {
        getCurrentUrl: () => 'https://example.test/library',
        replaceLocation: vi.fn(),
      },
      loadCards: vi.fn(() => pendingCards.promise),
    };
    const port = intakePort();
    let latestModel: IntakeSharingSessionModel | null = null;
    let actions: IntakeSharingSessionActions | null = null;

    function Harness() {
      const session = useIntakeSharingSession({
        ownerKey: 'owner-a',
        intake: intakeOptions(),
        sharing,
      }, { useIntakePort: () => port });
      latestModel = session.model;
      actions = session.actions;
      return null;
    }

    const root = createRoot(installMinimalReactDom());
    try {
      await act(async () => {
        root.render(<Harness />);
      });

      let first!: ReturnType<IntakeSharingSessionActions['shareCategory']>;
      let duplicate!: Awaited<ReturnType<IntakeSharingSessionActions['shareCategory']>>;
      await act(async () => {
        first = actions!.shareCategory('IELTS');
        duplicate = await actions!.shareCategory('IELTS');
      });

      expect(duplicate).toEqual({ status: 'busy' });
      expect(sharing.loadCards).toHaveBeenCalledOnce();
      expect(latestModel).toMatchObject({
        isBusy: true,
        share: { isLoading: true },
      });

      await act(async () => {
        pendingCards.resolve({
          cards: Array.from({ length: 100 }, (_, index) => card(`card-${index}`)),
          total: 120,
          hasNext: true,
        });
        await first;
      });

      expect(create).toHaveBeenCalledOnce();
      expect(latestModel).toMatchObject({
        isBusy: false,
        share: {
          isLoading: false,
          isShareDialogOpen: true,
          shareWarning: 'This link includes the first 100 of 120 cards. Split this category into smaller decks to share the rest.',
        },
      });
    } finally {
      await act(async () => {
        root.unmount();
      });
      vi.unstubAllGlobals();
    }
  });

  it('stops waiting and exposes a retryable error when category loading times out', async () => {
    vi.useFakeTimers();
    const sharing = {
      adapter: {
        load: vi.fn(async () => ({ cards: [] })),
        create: vi.fn(async () => ({
          shareId: 'share-1', expiresAt: '2026-09-01T00:00:00.000Z',
        })),
        revoke: vi.fn(async () => undefined),
      },
      browser: {
        getCurrentUrl: () => 'https://example.test/library',
        replaceLocation: vi.fn(),
      },
      loadCards: vi.fn(() => new Promise<never>(() => undefined)),
    };
    const port = intakePort();
    let latestModel: IntakeSharingSessionModel | null = null;
    let actions: IntakeSharingSessionActions | null = null;

    function Harness() {
      const session = useIntakeSharingSession({
        ownerKey: 'owner-a',
        intake: intakeOptions(),
        sharing,
      }, { useIntakePort: () => port });
      latestModel = session.model;
      actions = session.actions;
      return null;
    }

    const root = createRoot(installMinimalReactDom());
    try {
      await act(async () => {
        root.render(<Harness />);
      });
      let operation!: ReturnType<IntakeSharingSessionActions['shareCategory']>;
      await act(async () => {
        operation = actions!.shareCategory('IELTS');
        await Promise.resolve();
      });
      expect(latestModel).toMatchObject({ isBusy: true, share: { isLoading: true } });

      let result!: Awaited<typeof operation>;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
        result = await operation;
      });

      expect(result).toEqual({ status: 'failed' });
      expect(latestModel).toMatchObject({
        isBusy: false,
        error: 'Could not load the cards needed to create this share link. Please try again.',
        share: { isLoading: false },
      });
    } finally {
      await act(async () => {
        root.unmount();
      });
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
