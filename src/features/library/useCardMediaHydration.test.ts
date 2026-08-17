import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';

const reactDoubles = vi.hoisted(() => ({ useEffect: vi.fn() }));

vi.mock('react', () => ({
  useEffect: reactDoubles.useEffect,
  useRef: <T,>(initial: T) => ({ current: initial }),
  useSyncExternalStore: <T,>(
    _subscribe: (listener: () => void) => () => void,
    getSnapshot: () => T,
  ) => getSnapshot(),
}));
import {
  createCardMediaHydrationController,
  useCardMediaHydration,
  type CardMediaHydrationPort,
  type CardMediaUpdate,
} from './useCardMediaHydration';

const card: CardData = {
  id: 'word-bank',
  word: 'bank',
  normalizedWord: 'bank',
  translation: 'ngân hàng',
  explanation: 'A financial institution.',
  phonetic: '',
  emoji: '🏦',
  category: 'Finance',
  audioUrl: null,
  imageUrl: null,
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
};

const port = (
  media: Promise<CardMediaUpdate | null> = Promise.resolve({
    imageUrl: 'https://images.pexels.com/bank.jpeg',
    imageSearchQuery: 'bank financial institution',
  }),
) => ({
  hasMedia: vi.fn(value => Boolean(value.imageUrl)),
  fetchMedia: vi.fn(() => media),
  updateCard: vi.fn(async () => undefined),
}) satisfies CardMediaHydrationPort;

describe('card media hydration workspace', () => {
  it('keeps the hook boundary vendor-free and owns the library trigger', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./useCardMediaHydration.ts', import.meta.url)),
      'utf8',
    );

    expect(source).toMatch(/useEffect/);
    expect(source).toMatch(/hydrateLibrary/);
    expect(source).toMatch(
      /previewCard:\s*\(cardId, fields, options\)\s*=>\s*latestPortRef\.current\.previewCard/,
    );
    expect(source).not.toMatch(/firebase|firestore|Repository/);
    expect(source).not.toMatch(/Dispatch|SetStateAction/);
  });

  it('hydrates a visible library card once and publishes through the learning update port', async () => {
    const updates = port();
    const controller = createCardMediaHydrationController(updates);
    controller.replace({ ownerKey: 'owner-a', cards: [card], enabled: true });

    await controller.hydrateLibrary();
    await controller.hydrateLibrary();

    expect(updates.fetchMedia).toHaveBeenCalledOnce();
    expect(updates.updateCard).toHaveBeenCalledWith(
      card.id,
      expect.objectContaining({ imageUrl: 'https://images.pexels.com/bank.jpeg' }),
      expect.objectContaining({ source: card, expectedLifecycle: expect.any(String) }),
    );
    expect(controller.getSnapshot()).toEqual({ pendingCount: 0, isHydrating: false });
  });

  it('previews a recovered image only after durable persistence settles', async () => {
    const persistence = deferred<void>();
    const updates = {
      ...port(),
      previewCard: vi.fn(),
      updateCard: vi.fn(() => persistence.promise),
    } satisfies CardMediaHydrationPort;
    const controller = createCardMediaHydrationController(updates);
    controller.replace({ ownerKey: 'owner-a', cards: [card], enabled: true });

    const hydration = controller.hydrateLibrary();
    await Promise.resolve();

    expect(updates.previewCard).not.toHaveBeenCalled();

    persistence.resolve();
    await hydration;

    expect(updates.previewCard).toHaveBeenCalledWith(
      card.id,
      expect.objectContaining({ imageUrl: 'https://images.pexels.com/bank.jpeg' }),
      expect.objectContaining({ source: card, expectedLifecycle: expect.any(String) }),
    );
  });

  it('does not preview a failed persistence and allows the next hydration to retry', async () => {
    const updates = {
      ...port(),
      previewCard: vi.fn(),
      updateCard: vi.fn()
        .mockRejectedValueOnce(new Error('write failed'))
        .mockResolvedValueOnce(undefined),
    } satisfies CardMediaHydrationPort;
    const controller = createCardMediaHydrationController(updates);
    controller.replace({ ownerKey: 'owner-a', cards: [card], enabled: true });

    await expect(controller.hydrateLibrary()).rejects.toThrow('write failed');
    expect(updates.previewCard).not.toHaveBeenCalled();

    await controller.hydrateLibrary();
    expect(updates.fetchMedia).toHaveBeenCalledTimes(2);
    expect(updates.previewCard).toHaveBeenCalledOnce();
  });

  it('suppresses a late result after the owner changes', async () => {
    const image = deferred<CardMediaUpdate | null>();
    const updates = port(image.promise);
    const controller = createCardMediaHydrationController(updates);
    controller.replace({ ownerKey: 'owner-a', cards: [card], enabled: true });

    const hydration = controller.hydrateLibrary();
    controller.replace({ ownerKey: 'owner-b', cards: [card], enabled: true });
    image.resolve({ imageUrl: 'https://images.pexels.com/bank.jpeg' });
    await hydration;

    expect(updates.updateCard).not.toHaveBeenCalled();
  });

  it('suppresses a late result after the card disappears from the active library', async () => {
    const image = deferred<CardMediaUpdate | null>();
    const updates = port(image.promise);
    const controller = createCardMediaHydrationController(updates);
    controller.replace({ ownerKey: 'owner-a', cards: [card], enabled: true });

    const hydration = controller.hydrateLibrary();
    controller.replace({ ownerKey: 'owner-a', cards: [], enabled: true });
    image.resolve({ imageUrl: 'https://images.pexels.com/bank.jpeg' });
    await hydration;

    expect(updates.updateCard).not.toHaveBeenCalled();
  });

  it('suppresses a late result after a newer media revision replaces the card', async () => {
    const image = deferred<CardMediaUpdate | null>();
    const updates = port(image.promise);
    const controller = createCardMediaHydrationController(updates);
    controller.replace({ ownerKey: 'owner-a', cards: [card], enabled: true });

    const hydration = controller.hydrateLibrary();
    controller.replace({
      ownerKey: 'owner-a',
      cards: [{ ...card, revision: 2, imageUrl: 'https://images.pexels.com/bank-current.jpeg' }],
      enabled: true,
    });
    image.resolve({ imageUrl: 'https://images.pexels.com/bank-stale.jpeg' });
    await hydration;

    expect(updates.updateCard).not.toHaveBeenCalled();
  });

  it('hydrates an explicitly opened card even when it was outside the active page', async () => {
    const updates = port();
    const controller = createCardMediaHydrationController(updates);
    controller.replace({ ownerKey: 'owner-a', cards: [], enabled: true });

    await controller.actions.hydrateCard(card, { force: true, allowInactive: true });

    expect(updates.fetchMedia).toHaveBeenCalledWith(card);
    expect(updates.updateCard).toHaveBeenCalledWith(
      card.id,
      expect.objectContaining({ imageUrl: 'https://images.pexels.com/bank.jpeg' }),
      expect.objectContaining({ source: card, expectedLifecycle: expect.any(String) }),
    );
  });

  it('invalidates an in-flight card lifecycle before publication', async () => {
    const image = deferred<CardMediaUpdate | null>();
    const updates = port(image.promise);
    const controller = createCardMediaHydrationController(updates);
    controller.replace({ ownerKey: 'owner-a', cards: [card], enabled: true });

    const hydration = controller.hydrateLibrary();
    const token = controller.actions.lifecycleToken(card.id);
    controller.actions.invalidateCard(card.id);
    image.resolve({ imageUrl: 'https://images.pexels.com/bank.jpeg' });
    await hydration;

    expect(controller.actions.isLifecycleCurrent(card.id, token)).toBe(false);
    expect(updates.updateCard).not.toHaveBeenCalled();

    vi.mocked(updates.fetchMedia).mockResolvedValueOnce({
      imageUrl: 'https://images.pexels.com/bank-readded.jpeg',
    });
    await controller.hydrateLibrary();
    expect(updates.updateCard).toHaveBeenCalledOnce();
  });

  it('reports automatic persistence failures without leaving an unhandled rejection', async () => {
    const updates = {
      ...port(),
      updateCard: vi.fn(async () => { throw new Error('write failed'); }),
    } satisfies CardMediaHydrationPort;
    const reportError = vi.fn();
    reactDoubles.useEffect.mockImplementation((effect: () => unknown) => { effect(); });

    try {
      useCardMediaHydration({
        ownerKey: 'owner-a',
        cards: [card],
        enabled: true,
        port: updates,
        reportError,
      });

      await vi.waitFor(() => {
        expect(reportError).toHaveBeenCalledWith(
          'Some card images could not be saved. Please try again later.',
        );
      });
      expect(updates.fetchMedia).toHaveBeenCalledOnce();
    } finally {
      reactDoubles.useEffect.mockReset();
    }
  });
});
