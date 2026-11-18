import type { CardData } from '../../types/card';
import { formatCardDate } from '../library/libraryPresentation';

/** Hostname without a leading `www.`, or null when the URL is missing/unparsable. */
export function webWordsSiteFromUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }
}

/**
 * Day bucket label ("Today" / "Yesterday" / "MMM d, yyyy") from `capturedAt`
 * with a `createdAt` fallback — reuses the exact same bucketing the library
 * grid already shows for `formatCardDate`/`displayCardDate`, so a learner
 * sees the same day boundaries in both places instead of two competing
 * date schemes.
 */
export function webWordsDayFromCard(card: CardData): string {
  return formatCardDate(card.source?.capturedAt || card.createdAt);
}

export interface WebWordsArticleGroup {
  /** Stable identity for this article: the sanitized source URL, or a title/card fallback for a card with no URL. */
  readonly key: string;
  readonly site: string | null;
  readonly title: string | null;
  readonly url: string | null;
  readonly day: string;
  readonly cards: readonly CardData[];
}

const articleKey = (card: CardData): string => {
  if (card.source?.url) return `url:${card.source.url}`;
  if (card.source?.title) return `title:${card.source.title}`;
  return `card:${card.id}`;
};

const byCapturedAtDesc = (left: CardData, right: CardData): number =>
  (right.source?.capturedAt || '').localeCompare(left.source?.capturedAt || '');

/**
 * Groups already-loaded, already-filtered web-sourced cards by the article
 * (page) they were captured from, newest article first. Pure and
 * client-side: it never issues a query of its own, so calling it on every
 * filter change costs nothing beyond re-deriving the same in-memory pages.
 */
export function groupWebWordsByArticle(cards: readonly CardData[]): WebWordsArticleGroup[] {
  const groups = new Map<string, CardData[]>();
  for (const card of cards) {
    if (!card.source) continue;
    const key = articleKey(card);
    const existing = groups.get(key);
    if (existing) existing.push(card);
    else groups.set(key, [card]);
  }
  const result: WebWordsArticleGroup[] = [];
  for (const [key, groupCards] of groups) {
    const sorted = [...groupCards].sort(byCapturedAtDesc);
    const first = sorted[0];
    result.push({
      key,
      site: webWordsSiteFromUrl(first.source?.url),
      title: first.source?.title || null,
      url: first.source?.url || null,
      day: webWordsDayFromCard(first),
      cards: sorted,
    });
  }
  return result.sort((left, right) => {
    const leftCapturedAt = left.cards[0]?.source?.capturedAt || '';
    const rightCapturedAt = right.cards[0]?.source?.capturedAt || '';
    return rightCapturedAt.localeCompare(leftCapturedAt);
  });
}
