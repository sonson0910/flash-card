/**
 * Intl.Segmenter-based tokenization with a tested fallback for environments
 * where Intl.Segmenter is unavailable. Used anywhere a target-language string
 * must be split into user-perceived characters (spelling diagnostics) or
 * words (sentence building, word-overlap scoring) without assuming Latin
 * whitespace conventions, which Han and Kana text does not follow.
 */

type SegmenterLike = {
  segment(value: string): Iterable<{ segment: string; isWordLike?: boolean }>;
};

const segmenterConstructor: (new (
  locales?: string | string[],
  options?: { granularity?: 'grapheme' | 'word' | 'sentence' },
) => SegmenterLike) | undefined = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? (Intl as unknown as { Segmenter: new (
      locales?: string | string[],
      options?: { granularity?: 'grapheme' | 'word' | 'sentence' },
    ) => SegmenterLike }).Segmenter
  : undefined;

const graphemeSegmenter = segmenterConstructor
  ? new segmenterConstructor(undefined, { granularity: 'grapheme' })
  : undefined;
const wordSegmenter = segmenterConstructor
  ? new segmenterConstructor(undefined, { granularity: 'word' })
  : undefined;

const CJK_RUN_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/**
 * Splits into user-perceived characters (graphemes). Falls back to
 * per-code-point iteration when Intl.Segmenter is unavailable; that fallback
 * can misjoin combining-mark sequences but never collapses the string to a
 * single unmatched blob, which is what a naive ASCII-only strip would do.
 */
export function segmentGraphemes(value: string): string[] {
  if (!value) return [];
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(value), part => part.segment);
  }
  return Array.from(value);
}

/**
 * Splits into words. For Han/Kana runs without Intl.Segmenter support, falls
 * back to per-character tokens (an approximation, but one that still yields
 * partial overlap credit instead of treating an entire unspaced sentence as
 * one token that can only ever fully match or fully fail).
 */
export function segmentWords(value: string): string[] {
  if (!value) return [];
  if (wordSegmenter) {
    return Array.from(wordSegmenter.segment(value))
      .filter(part => part.isWordLike !== false && part.segment.trim().length > 0)
      .map(part => part.segment);
  }
  return value
    .split(/\s+/u)
    .filter(Boolean)
    .flatMap(chunk => (CJK_RUN_PATTERN.test(chunk) ? Array.from(chunk) : [chunk]));
}

export const supportsIntlSegmenter = segmenterConstructor !== undefined;
