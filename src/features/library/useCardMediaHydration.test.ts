import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import {
  createCardMediaHydrationController,
  useCardMediaHydration,
  type CardMediaHydrationActions,
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
    expect(source).toMatch(/hydrateLibrary\(\)\.catch/);
    expect(source).not.toMatch(/firebase|firestore|Repository/);
    expect(source).not.toMatch(/Dispatch|SetStateAction/);
  });

  it('handles automatic hydration failures and allows a later retry', async () => {
    const transientFailure = new Error('provider unavailable');
    const updates = {
      ...port(),
      fetchMedia: vi.fn()
        .mockRejectedValueOnce(transientFailure)
        .mockResolvedValueOnce({ imageUrl: 'https://images.pexels.com/bank.jpeg' }),
    } satisfies CardMediaHydrationPort;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const root = createRoot(installMinimalReactDom());
    const visibleCards = [card];
    let actions: CardMediaHydrationActions | null = null;

    function Harness() {
      actions = useCardMediaHydration({
        ownerKey: 'owner-a',
        cards: visibleCards,
        enabled: true,
        port: updates,
      }).actions;
      return null;
    }

    try {
      await act(async () => {
        root.render(createElement(Harness));
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(warning).toHaveBeenCalledWith(
        'Automatic card media hydration failed; it will retry later.',
        transientFailure,
      );
      await act(async () => {
        await actions!.hydrateCard(card, { force: true, allowInactive: true });
      });
      expect(updates.fetchMedia).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => root.unmount());
      warning.mockRestore();
      vi.unstubAllGlobals();
    }
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
});
