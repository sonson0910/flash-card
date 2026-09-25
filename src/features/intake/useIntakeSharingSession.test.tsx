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

const spreadsheetRequestMock = vi.hoisted(() => ({
  fromFile: vi.fn(),
}));

vi.mock('./spreadsheetFileRequest', () => ({
  spreadsheetRequestFromFile: spreadsheetRequestMock.fromFile,
}));

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
  generateCard: vi.fn(async request => ({
    card: card(request.term),
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
        error: null,
        isLoading: false,
        isShareDialogOpen: false,
        activeShareId: null,
        shareLink: null,
        shareWarning: null,
        outgoingPreview: null,
        incomingPreview: null,
        expiresAt: null,
      },
    });
    expect(Object.keys(actions!)).toEqual([
      'changeDraft', 'clearDraft', 'generate', 'importFile', 'adoptCards', 'shareCategory',
      'acceptShared', 'cancelShared', 'revokeShare', 'dismissShareLink', 'showShareDialog',
      'clearShareError', 'clearError', 'clearNotice', 'invalidateCard',
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
        error: null,
        isLoading: false,
        isShareDialogOpen: false,
        activeShareId: null,
        shareLink: null,
        shareWarning: null,
        outgoingPreview: null,
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

  it('stales an import during the render-to-effect owner transition', async () => {
    const workbook = deferred<{ structuredRows: Array<Record<string, string>>; flatRows: string[][] }>();
    const renderedOwnerB = deferred<void>();
    const ownerA = intakeOptions();
    const ownerB = intakeOptions();
    ownerA.ownerId = 'owner-a';
    ownerB.ownerId = 'owner-b';
    ownerA.upsertDeviceCards = vi.fn(ownerA.upsertDeviceCards);
    ownerB.upsertDeviceCards = vi.fn(ownerB.upsertDeviceCards);
    ownerA.getCards = () => [card('apple')];
    ownerB.getCards = () => [card('apple')];
    ownerA.patchCard = vi.fn(ownerA.patchCard);
    ownerB.patchCard = vi.fn(ownerB.patchCard);
    const resetA = vi.fn();
    const resetB = vi.fn();
    spreadsheetRequestMock.fromFile.mockReturnValue({
      sizeBytes: 100,
      loadWorkbook: () => workbook.promise,
    });
    const sharing = {
      adapter: {
        load: vi.fn(async () => ({ cards: [] })),
        create: vi.fn(async () => ({ shareId: 'share-1', expiresAt: '2026-09-01T00:00:00.000Z' })),
        revoke: vi.fn(async () => undefined),
      },
      browser: {
        getCurrentUrl: () => 'https://example.test/library',
        replaceLocation: vi.fn(),
      },
      loadCards: vi.fn(async () => ({ cards: [], total: 0, hasNext: false })),
    };
    let ownerAActions: IntakeSharingSessionActions | null = null;
    let latestModel: IntakeSharingSessionModel | null = null;
    let ownerBRenders = 0;

    function Harness({ ownerKey }: { ownerKey: string }) {
      const session = useIntakeSharingSession({
        ownerKey,
        intake: ownerKey === 'owner-a' ? ownerA : ownerB,
        resetSpreadsheetSource: ownerKey === 'owner-a' ? resetA : resetB,
        sharing,
      }, { useIntakePort: useCardIntakePort });
      latestModel = session.model;
      if (ownerKey === 'owner-a') ownerAActions = session.actions;
      else {
        ownerBRenders += 1;
        renderedOwnerB.resolve();
      }
      return null;
    }

    const root = createRoot(installMinimalReactDom());
    try {
      await act(async () => {
        root.render(<Harness ownerKey="owner-a" />);
      });
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false);
      const pending = ownerAActions!.importFile({} as File);
      await Promise.resolve();

      root.render(<Harness ownerKey="owner-b" />);
      await renderedOwnerB.promise;
      workbook.resolve({ structuredRows: [{ Word: 'apple', Translation: 'táo' }], flatRows: [] });
      await expect(pending).resolves.toEqual({ status: 'stale' });
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
      await act(async () => { await Promise.resolve(); });

      expect(ownerA.upsertDeviceCards).not.toHaveBeenCalled();
      expect(ownerB.upsertDeviceCards).not.toHaveBeenCalled();
      expect(ownerA.patchCard).not.toHaveBeenCalled();
      expect(ownerB.patchCard).not.toHaveBeenCalled();
      expect(ownerA.publishCards).not.toHaveBeenCalled();
      expect(ownerB.publishCards).not.toHaveBeenCalled();
      expect(resetA).not.toHaveBeenCalled();
      expect(resetB).not.toHaveBeenCalled();
      expect(ownerBRenders).toBe(2);
      expect(latestModel).toMatchObject({ importResult: null, error: null, isImporting: false });
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
          shareWarning: { sharedCardCount: 100, totalCardCount: 120 },
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

  it('keeps intake errors out of share state and dismisses only share errors', async () => {
    const port = intakePort();
    port.generateCard = vi.fn(async () => {
      throw new Error('generation unavailable');
    });
    let failShareLoad = false;
    const sharing = {
      adapter: {
        load: vi.fn(async () => ({ cards: [] })),
        create: vi.fn(async () => ({
          shareId: 'share-1',
          expiresAt: '2026-09-01T00:00:00.000Z',
        })),
        revoke: vi.fn(async () => undefined),
      },
      browser: {
        getCurrentUrl: () => 'https://example.test/library',
        replaceLocation: vi.fn(),
      },
      loadCards: vi.fn(async () => {
        if (failShareLoad) throw new Error('share cards unavailable');
        return { cards: [card('shared')], total: 1, hasNext: false };
      }),
    };
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
      await act(async () => {
        actions!.changeDraft('pear');
        await actions!.generate();
      });
      const intakeError = latestModel!.error;
      expect(intakeError).toBeTruthy();
      expect(latestModel!.share.error).toBeNull();

      await act(async () => {
        await actions!.shareCategory('General');
      });
      expect(latestModel).toMatchObject({
        error: intakeError,
        share: { error: null, isShareDialogOpen: true },
      });

      failShareLoad = true;
      await act(async () => {
        await actions!.shareCategory('General');
      });
      expect(latestModel!.share.error).toBe(
        'Could not load the cards needed to create this share link. Please try again.',
      );
      expect(latestModel!.share.isShareDialogOpen).toBe(true);

      await act(async () => {
        actions!.clearShareError();
      });
      expect(latestModel).toMatchObject({
        error: intakeError,
        share: { error: null, isShareDialogOpen: true },
      });
    } finally {
      await act(async () => {
        root.unmount();
      });
      vi.unstubAllGlobals();
    }
  });

  it('does not resurface a shared-adoption failure after dismissing the share error', async () => {
    const port = intakePort();
    vi.mocked(port.findExisting).mockRejectedValue(new Error('library query unavailable'));
    const sharing = {
      adapter: {
        load: vi.fn(async () => ({ category: 'General', cards: [card('shared')] })),
        create: vi.fn(async () => ({
          shareId: 'share-1',
          expiresAt: '2026-09-01T00:00:00.000Z',
        })),
        revoke: vi.fn(async () => undefined),
      },
      browser: {
        getCurrentUrl: () => 'https://example.test/library?share=share-1',
        replaceLocation: vi.fn(),
      },
      loadCards: vi.fn(async () => ({ cards: [], total: 0, hasNext: false })),
    };
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
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(latestModel!.share.isShareDialogOpen).toBe(true);
      expect(latestModel!.share.incomingPreview).not.toBeNull();

      await act(async () => {
        await actions!.acceptShared();
      });
      expect(latestModel!.share.error).toBe('Could not add this shared deck safely. Please try again.');

      await act(async () => {
        actions!.clearShareError();
      });
      expect(latestModel!.share.error).toBeNull();
      expect(latestModel!.error).toBeNull();
    } finally {
      await act(async () => {
        root.unmount();
      });
      vi.unstubAllGlobals();
    }
  });
});
