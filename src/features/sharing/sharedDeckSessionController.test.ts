import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
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

  it('consumes a bounded share payload through Card Intake and preserves unrelated URL state', async () => {
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
    expect(intake.adoptShared).toHaveBeenCalledWith({ cards: rawCards.slice(0, 100) });
    expect(browser.replacements).toEqual(['/library?q=airport&utm=course#words']);
    expect(controller.getSnapshot()).toMatchObject({
      isLoading: false,
      notice: 'Added 80 new cards from the shared link; reused 19 already in your library.',
      error: null,
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
    expect(invalidPayload.controller.getSnapshot().error).toMatch(/verify/i);
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
    expect(intake.adoptShared).toHaveBeenCalledOnce();
    expect(intake.adoptShared).toHaveBeenCalledWith({ cards: [card('new')] });
  });

  it('creates and revokes a bounded share through the adapter', async () => {
    const { controller, adapter } = setup('https://sonflash.test/library?q=airport');
    await controller.activate('owner-1');
    const cards = Array.from({ length: 120 }, (_, index) => card(`word-${index}`));

    const created = await controller.actions.createShare({ category: 'IELTS', cards });
    expect(created).toMatchObject({ status: 'created' });
    expect(adapter.create).toHaveBeenCalledWith({ category: 'IELTS', cards: cards.slice(0, 100) });
    expect(controller.getSnapshot().shareLink).toBe('https://sonflash.test/library?share=share-new');

    await controller.actions.revokeShare();
    expect(adapter.revoke).toHaveBeenCalledWith('share-new');
    expect(controller.getSnapshot()).toMatchObject({
      shareLink: null,
      activeShareId: null,
      notice: 'The shared deck link has been revoked.',
      isLoading: false,
    });
  });

  it('does not expose an old owner share to the next owner', async () => {
    const { controller, adapter } = setup();
    await controller.activate('owner-1');
    await controller.actions.createShare({ category: 'IELTS', cards: [card('apple')] });

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

    const pending = controller.actions.createShare({ category: 'IELTS', cards: [card('apple')] });
    await controller.activate('owner-2');
    creation.resolve({ shareId: 'stale-share', expiresAt: '2026-08-10T00:00:00.000Z' });

    await expect(pending).resolves.toEqual({ status: 'stale' });
    expect(controller.getSnapshot().shareLink).toBeNull();

    vi.mocked(adapter.create).mockRejectedValueOnce(new Error('secret backend detail'));
    await controller.actions.createShare({ category: 'IELTS', cards: [card('pear')] });
    expect(controller.getSnapshot()).toMatchObject({
      error: 'Could not create a share link right now. Please try again.',
      isLoading: false,
    });
  });
});
