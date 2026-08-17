import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardMediaHydrationPort } from '../features/library/useCardMediaHydration';
import type { LearningWorkspaceActions } from '../features/learning/useLearningWorkspace';
import { cardWordKey } from '../lib/cardIdentity';
import type { CardData } from '../types/card';
import type { AppLibraryRuntime } from './useAppLibraryRuntime';

const imageDoubles = vi.hoisted(() => ({ fetchImageUrl: vi.fn() }));
const hydrationDoubles = vi.hoisted(() => ({
  hydrateCard: vi.fn(),
  invalidateCard: vi.fn(),
  port: null as CardMediaHydrationPort | null,
}));

vi.mock('react', () => ({
  useCallback: <T,>(callback: T) => callback,
  useEffect: vi.fn(),
  useRef: <T,>(initial: T) => ({ current: initial }),
}));
vi.mock('../lib/images', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/images')>(),
  fetchImageUrl: imageDoubles.fetchImageUrl,
}));
vi.mock('../features/library/useCardMediaHydration', async importOriginal => ({
  ...await importOriginal<typeof import('../features/library/useCardMediaHydration')>(),
  useCardMediaHydration: vi.fn((options: { port: CardMediaHydrationPort }) => {
    hydrationDoubles.port = options.port;
    return {
      model: { pendingCount: 0, isHydrating: false },
      actions: {
        hydrateCard: hydrationDoubles.hydrateCard,
        invalidateCard: hydrationDoubles.invalidateCard,
        lifecycleToken: vi.fn(() => '0:0'),
        isLifecycleCurrent: vi.fn(() => true),
      },
    };
  }),
}));

import { useAppCardMediaCoordination } from './useAppCardMediaCoordination';

const failedUrl = 'https://images.pexels.com/bank-failed.jpeg';
const replacementUrl = 'https://images.pexels.com/bank-replacement.jpeg';
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
  imageUrl: failedUrl,
  createdAt: '2026-08-17T00:00:00.000Z',
};

beforeEach(() => {
  imageDoubles.fetchImageUrl.mockReset();
  hydrationDoubles.hydrateCard.mockReset();
  hydrationDoubles.invalidateCard.mockReset();
  hydrationDoubles.port = null;
});

describe('App card media coordination', () => {
  it('commits promoted media only after persistence and retains rejected candidates', async () => {
    let visibleCards = [card];
    const promotedCards = new Map([[cardWordKey(card), card]]);
    const setCards = vi.fn((update: (cards: CardData[]) => CardData[]) => {
      visibleCards = update(visibleCards);
    });
    const updateCard = vi.fn()
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce(undefined);
    const learningActionsRef = {
      current: { updateCard } as unknown as LearningWorkspaceActions,
    };
    const libraryPorts = {
      cardsRef: { current: visibleCards },
      recentlyPromotedCardsRef: { current: promotedCards },
      setCards,
    } as unknown as AppLibraryRuntime['ports'];
    imageDoubles.fetchImageUrl
      .mockResolvedValueOnce(replacementUrl)
      .mockResolvedValueOnce(failedUrl)
      .mockResolvedValueOnce(failedUrl);

    const coordination = useAppCardMediaCoordination({
      ownerKey: 'owner-a',
      cardsOwnerKey: 'owner-a',
      cards: visibleCards,
      cardsPerPage: 9,
      viewMode: 'library',
      libraryPorts,
      learningActionsRef,
      practiceSnapshotRef: { current: { findCard: () => undefined } },
      reportError: vi.fn(),
    });
    const port = hydrationDoubles.port;
    expect(port).not.toBeNull();

    await coordination.imageUnavailable(card, failedUrl);
    const sourceWithoutImage = { ...card, imageUrl: null };
    expect(updateCard).not.toHaveBeenCalled();
    expect(hydrationDoubles.hydrateCard).toHaveBeenCalledWith(
      sourceWithoutImage,
      { force: true, allowInactive: true },
    );
    const replacement = await port!.fetchMedia(sourceWithoutImage);
    expect(replacement).toEqual(expect.objectContaining({ imageUrl: replacementUrl }));

    const options = { source: sourceWithoutImage, expectedLifecycle: '0:0' };
    await expect(port!.updateCard(card.id, replacement!, options)).rejects.toThrow('write failed');
    expect(promotedCards.get(cardWordKey(card))?.imageUrl).toBe(failedUrl);
    expect(setCards).not.toHaveBeenCalled();
    await expect(port!.fetchMedia(sourceWithoutImage)).resolves.toBeNull();

    await port!.updateCard(card.id, replacement!, options);
    port!.previewCard?.(card.id, replacement!, options);
    expect(promotedCards.get(cardWordKey(card))?.imageUrl).toBe(replacementUrl);
    expect(visibleCards[0]?.imageUrl).toBe(replacementUrl);
    await expect(port!.fetchMedia(sourceWithoutImage)).resolves.toBeNull();
  });
});
