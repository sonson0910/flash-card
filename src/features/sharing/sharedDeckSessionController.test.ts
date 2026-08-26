import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { ProtectedFunctionError } from '../../lib/protectedFunctionsCapability';
import type { CardData } from '../../types/card';
import {
  createSharedDeckSessionController,
  type SharedDeckAdapter,
  type SharedDeckBrowser,
  type SharedDeckIntakePort,
} from './sharedDeckSessionController';

const card = (word: string): CardData => ({
  id: `word-${word}`,
  word,
  normalizedWord: word,
  translation: `${word}-vi`,
  explanation: '',
  phonetic: '',
  emoji: '📝',
  category: 'Shared',
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-08-03T00:00:00.000Z',
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

class FakeBrowser implements SharedDeckBrowser {
  replacements: string[] = [];

  constructor(public url: string) {}

  getCurrentUrl(): string {
    return this.url;
  }

  replaceLocation(location: string): void {
    this.replacements.push(location);
    this.url = new URL(location, this.url).href;
  }
}

const setup = (url = 'https://sonflash.test/library') => {
  const browser = new FakeBrowser(url);
  const adapter: SharedDeckAdapter = {
    load: vi.fn(async () => ({ category: 'IELTS', cards: [card('apple')] })),
    create: vi.fn(async () => ({ shareId: 'share-new', expiresAt: '2026-08-10T00:00:00.000Z' })),
    revoke: vi.fn(async () => undefined),
  };
  const intake: SharedDeckIntakePort = {
    adoptShared: vi.fn(async ({ cards }) => ({
      status: 'completed' as const,
      candidateCount: cards.length,
      createdCount: cards.length,
      reusedCount: 0,
    })),
  };
  const controller = createSharedDeckSessionController({ adapter, intake, browser });
  return { browser, adapter, intake, controller };
};

describe('shared deck session controller', () => {
  it('is vendor-free and has a React binding without public setters', () => {
    const controllerSource = readFileSync(
      fileURLToPath(new URL('./sharedDeckSessionController.ts', import.meta.url)),
      'utf8',
    );
    const hookSource = readFileSync(
      fileURLToPath(new URL('./useSharedDeckSession.ts', import.meta.url)),
      'utf8',
    );

    expect(controllerSource).not.toMatch(/firebase|Firestore|QueryDocumentSnapshot|Dispatch|SetStateAction/i);
    expect(hookSource).toMatch(/useSyncExternalStore/);
    expect(hookSource).not.toMatch(/firebase|Firestore|QueryDocumentSnapshot|Dispatch|SetStateAction/i);
    expect(Object.keys(setup().controller.actions).some(key => key.startsWith('set'))).toBe(false);
  });

  it('loads a bounded preview without writing, then adopts only after explicit acceptance', async () => {
    const { controller, adapter, intake, browser } = setup(
      'https://sonflash.test/library?share=deck-1&q=airport&utm=course#words',
    );
    const rawCards = Array.from({ length: 120 }, (_, index) => ({
      word: index === 1 ? 'APPLE' : `word-${index}`,
      translation: 'translation',
    }));
    vi.mocked(adapter.load).mockResolvedValue({ category: 'X'.repeat(200), cards: rawCards });
    vi.mocked(intake.adoptShared).mockResolvedValue({
      status: 'completed', candidateCount: 99, createdCount: 80, reusedCount: 19,
    });

    await controller.activate('owner-1');

    expect(adapter.load).toHaveBeenCalledWith('deck-1');
    expect(intake.adoptShared).not.toHaveBeenCalled();
    expect(browser.replacements).toHaveLength(0);
    expect(controller.getSnapshot()).toMatchObject({
      isLoading: false,
      isShareDialogOpen: true,
      incomingPreview: {
        shareId: 'deck-1',
        cardCount: 100,
      },
      notice: null,
      error: null,
    });

    await expect(controller.actions.acceptShared()).resolves.toEqual({ status: 'accepted' });

    expect(intake.adoptShared).toHaveBeenCalledWith({ cards: rawCards.slice(0, 100) });
    expect(browser.replacements).toEqual(['/library?q=airport&utm=course#words']);
    expect(controller.getSnapshot()).toMatchObject({
      isLoading: false,
      isShareDialogOpen: false,
      incomingPreview: null,
      notice: 'Added 80 new cards from the shared link; reused 19 already in your library.',
      error: null,
    });
  });

  it('keeps a shared deck pending when intake reports no valid candidates', async () => {
    const originalUrl = 'https://sonflash.test/library?share=deck-1&q=airport#words';
    const { controller, intake, browser } = setup(originalUrl);
    vi.mocked(intake.adoptShared).mockResolvedValue({
      status: 'completed', candidateCount: 0, createdCount: 0, reusedCount: 0,
    });

    await controller.activate('owner-1');
    const preview = controller.getSnapshot().incomingPreview;

    await expect(controller.actions.acceptShared()).resolves.toEqual({ status: 'failed' });

    expect(browser.url).toBe(originalUrl);
    expect(browser.replacements).toHaveLength(0);
    expect(controller.getSnapshot()).toMatchObject({
      isLoading: false,
      isShareDialogOpen: true,
      incomingPreview: preview,
      notice: null,
      error: 'This shared deck contains no usable vocabulary cards. No changes were made; ask the sender to create a new link.',
    });
  });

  it('cancels an incoming preview without writing and removes only the share parameter', async () => {
    const { controller, intake, browser } = setup(
      'https://sonflash.test/library?share=deck-1&q=airport#words',
    );

    await controller.activate('owner-1');
    controller.actions.cancelShared();

    expect(intake.adoptShared).not.toHaveBeenCalled();
    expect(browser.replacements).toEqual(['/library?q=airport#words']);
    expect(controller.getSnapshot()).toMatchObject({
      incomingPreview: null,
      isShareDialogOpen: false,
    });
  });

  it('rejects invalid IDs and payloads before Card Intake', async () => {
    const invalidId = setup('https://sonflash.test/library?share=%20bad%2Fid%20&utm=x');
    await invalidId.controller.activate('owner-1');
    expect(invalidId.adapter.load).not.toHaveBeenCalled();
    expect(invalidId.intake.adoptShared).not.toHaveBeenCalled();
    expect(invalidId.controller.getSnapshot().error).toMatch(/invalid/i);

    const invalidPayload = setup('https://sonflash.test/library?share=deck-1');
    vi.mocked(invalidPayload.adapter.load).mockResolvedValue({ category: 'IELTS', cards: 'wrong' });
    await invalidPayload.controller.activate('owner-1');
    expect(invalidPayload.intake.adoptShared).not.toHaveBeenCalled();
    expect(invalidPayload.browser.replacements).toHaveLength(0);
    expect(invalidPayload.controller.getSnapshot().error).toMatch(/load/i);

    const emptyPayload = setup('https://sonflash.test/library?share=deck-empty');
    vi.mocked(emptyPayload.adapter.load).mockResolvedValue({ category: 'IELTS', cards: [] });
    await emptyPayload.controller.activate('owner-1');
    expect(emptyPayload.intake.adoptShared).not.toHaveBeenCalled();
    expect(emptyPayload.controller.getSnapshot()).toMatchObject({
      incomingPreview: null,
      isShareDialogOpen: false,
      error: expect.stringMatching(/load/i),
    });
  });

  it('rejects a malformed card batch atomically before preview or adoption', async () => {
    const originalUrl = 'https://sonflash.test/library?share=deck-malformed&q=airport#words';
    const { controller, adapter, intake, browser } = setup(originalUrl);
    vi.mocked(adapter.load).mockResolvedValue({
      category: 'IELTS',
      cards: [null, {}, { word: '', translation: '' }],
    });

    await controller.activate('owner-1');

    expect(intake.adoptShared).not.toHaveBeenCalled();
    expect(browser.url).toBe(originalUrl);
    expect(browser.replacements).toHaveLength(0);
    expect(controller.getSnapshot()).toMatchObject({
      isLoading: false,
      incomingPreview: null,
      isShareDialogOpen: false,
      notice: null,
      error: 'This shared deck contains invalid vocabulary cards. No changes were made; ask the sender to create a new link.',
    });
  });

  it('leaves the busy state with a safe error when loading a shared deck times out', async () => {
    vi.useFakeTimers();
    try {
      const { controller, adapter, intake } = setup('https://sonflash.test/?share=deck-1');
      vi.mocked(adapter.load).mockReturnValue(new Promise(() => undefined));

      const activation = controller.activate('owner-1');
      expect(controller.getSnapshot().isLoading).toBe(true);

      await vi.advanceTimersByTimeAsync(20_000);
      await activation;

      expect(intake.adoptShared).not.toHaveBeenCalled();
      expect(controller.getSnapshot()).toMatchObject({
        isLoading: false,
        error: 'Could not load this shared deck safely. No cards were added.',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a loaded deck when the active owner changes', async () => {
    const { controller, adapter, intake } = setup('https://sonflash.test/?share=deck-1');
    const firstLoad = deferred<Awaited<ReturnType<SharedDeckAdapter['load']>>>();
    const secondLoad = deferred<Awaited<ReturnType<SharedDeckAdapter['load']>>>();
    vi.mocked(adapter.load)
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(secondLoad.promise);

    const first = controller.activate('owner-1');
    const second = controller.activate('owner-2');
    firstLoad.resolve({ category: 'Old', cards: [card('old')] });
    await first;
    expect(intake.adoptShared).not.toHaveBeenCalled();

    secondLoad.resolve({ category: 'New', cards: [card('new')] });
    await second;
    expect(controller.getSnapshot().incomingPreview).toMatchObject({
      category: 'New',
      cardCount: 1,
    });
    expect(intake.adoptShared).not.toHaveBeenCalled();

    await controller.actions.acceptShared();
    expect(intake.adoptShared).toHaveBeenCalledOnce();
    expect(intake.adoptShared).toHaveBeenCalledWith({ cards: [card('new')] });
  });

  it('creates and revokes a bounded share through the adapter', async () => {
    const { controller, adapter } = setup('https://sonflash.test/library?q=airport');
    await controller.activate('owner-1');
    const cards = Array.from({ length: 100 }, (_, index) => card(`word-${index}`));

    const created = await controller.actions.createShare({
      category: 'IELTS',
      cards,
      total: 120,
      hasNext: true,
    });
    expect(created).toMatchObject({ status: 'created' });
    expect(adapter.create).toHaveBeenCalledWith({ ownerId: 'owner-1', category: 'IELTS', cards });
    expect(controller.getSnapshot()).toMatchObject({
      shareLink: 'https://sonflash.test/library?share=share-new',
      isShareDialogOpen: true,
      shareWarning: 'This link includes the first 100 of 120 cards. Split this category into smaller decks to share the rest.',
      notice: 'Shared the first 100 of 120 cards. Create smaller categories to share the rest.',
    });

    controller.actions.dismissShareLink();
    expect(controller.getSnapshot()).toMatchObject({
      shareLink: 'https://sonflash.test/library?share=share-new',
      activeShareId: 'share-new',
      isShareDialogOpen: false,
    });
    controller.actions.showShareDialog();
    expect(controller.getSnapshot().isShareDialogOpen).toBe(true);

    await controller.actions.revokeShare();
    expect(adapter.revoke).toHaveBeenCalledWith('share-new', 'owner-1');
    expect(controller.getSnapshot()).toMatchObject({
      shareLink: null,
      activeShareId: null,
      shareWarning: null,
      isShareDialogOpen: false,
      notice: 'The shared deck link has been revoked.',
      isLoading: false,
    });
  });

  it('does not expose an old owner share to the next owner', async () => {
    const { controller, adapter } = setup();
    await controller.activate('owner-1');
    await controller.actions.createShare({
      category: 'IELTS', cards: [card('apple')], total: 1, hasNext: false,
    });

    await controller.activate('owner-2');
    expect(controller.getSnapshot()).toMatchObject({ activeShareId: null, shareLink: null });
    await expect(controller.actions.revokeShare()).resolves.toEqual({ status: 'missing' });
    expect(adapter.revoke).not.toHaveBeenCalled();
  });

  it('ignores create completion from a stale owner and exposes safe errors', async () => {
    const { controller, adapter } = setup();
    const creation = deferred<Awaited<ReturnType<SharedDeckAdapter['create']>>>();
    vi.mocked(adapter.create).mockReturnValue(creation.promise);
    await controller.activate('owner-1');

    const pending = controller.actions.createShare({
      category: 'IELTS', cards: [card('apple')], total: 1, hasNext: false,
    });
    await controller.activate('owner-2');
    creation.resolve({ shareId: 'stale-share', expiresAt: '2026-08-10T00:00:00.000Z' });

    await expect(pending).resolves.toEqual({ status: 'stale' });
    expect(controller.getSnapshot().shareLink).toBeNull();

    vi.mocked(adapter.create).mockRejectedValueOnce(new Error('secret backend detail'));
    await controller.actions.createShare({
      category: 'IELTS', cards: [card('pear')], total: 1, hasNext: false,
    });
    expect(controller.getSnapshot()).toMatchObject({
      error: 'Could not create a share link right now. Please try again.',
      isLoading: false,
    });

    vi.mocked(adapter.create).mockRejectedValueOnce(new ProtectedFunctionError({
      message: 'Deck sharing needs a current sign-in. Sign in again, then retry.',
      kind: 'authentication',
      code: 'unauthenticated',
      retryable: false,
    }));
    await controller.actions.createShare({
      category: 'IELTS', cards: [card('plum')], total: 1, hasNext: false,
    });
    expect(controller.getSnapshot().error).toBe(
      'Deck sharing needs a current sign-in. Sign in again, then retry.',
    );
  });
});
