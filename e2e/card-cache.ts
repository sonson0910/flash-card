import type { Page } from '@playwright/test';

interface ScopedCardCache<TCard> {
  version: number;
  ownerId: string | null;
  cards: TCard[];
}

interface CardCacheState<TCard> {
  scoped: ScopedCardCache<TCard> | null;
  legacy: string | null;
}

export const readCardCacheState = async <TCard>(page: Page): Promise<CardCacheState<TCard>> =>
  page.evaluate(() => {
    const scopedValue = localStorage.getItem('lingoflash_cards_scoped_v1');
    return {
      scoped: scopedValue === null
        ? null
        : JSON.parse(scopedValue) as ScopedCardCache<TCard>,
      legacy: localStorage.getItem('lingoflash_cards'),
    };
  });
