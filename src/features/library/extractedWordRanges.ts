/** Where one extracted item occurs in the scanned passage, as UTF-16 offsets. */
export interface ExtractedWordRange {
  /** Position of the item in the extracted list. */
  index: number;
  start: number;
  end: number;
}

interface RangeSource {
  word: string;
  surface?: string;
}

const WORD_CHARACTER = /[\p{L}\p{M}\p{N}]/u;

/** Languages written without spaces between words, where a word boundary cannot be checked. */
const UNSPACED_LANGUAGES = new Set(['ja', 'zh', 'th', 'lo', 'km', 'my']);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const codePointAt = (text: string, index: number) => {
  const codePoint = text.codePointAt(index);
  return codePoint === undefined ? '' : String.fromCodePoint(codePoint);
};

const codePointBefore = (text: string, index: number) => {
  if (index <= 0) return '';
  const unit = text.charCodeAt(index - 1);
  return unit >= 0xdc00 && unit <= 0xdfff && index >= 2 ? text.slice(index - 2, index) : text.charAt(index - 1);
};

const isWordCharacter = (character: string) => character !== '' && WORD_CHARACTER.test(character);

const firstUnclaimedMatch = (
  passage: string,
  needle: string,
  checkBoundaries: boolean,
  claimed: readonly ExtractedWordRange[],
): { start: number; end: number } | null => {
  const needleStartsWord = isWordCharacter(codePointAt(needle, 0));
  const needleEndsWord = isWordCharacter(codePointBefore(needle, needle.length));
  for (const match of passage.matchAll(new RegExp(escapeRegExp(needle), 'giu'))) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (checkBoundaries && (
      (needleStartsWord && isWordCharacter(codePointBefore(passage, start)))
      || (needleEndsWord && isWordCharacter(codePointAt(passage, end)))
    )) continue;
    if (claimed.some(range => start < range.end && range.start < end)) continue;
    return { start, end };
  }
  return null;
};

/**
 * Finds each extracted item in the passage: its surface form first, then its
 * word, matched without regard to case and on whole words (plain substrings
 * for languages written without spaces). Every item takes the first
 * occurrence no earlier item claimed, so ranges never overlap; an item that is
 * not found has no range. Ranges come back in passage order.
 */
export function findExtractedRanges(
  passage: string,
  items: readonly RangeSource[],
  language: string,
): ExtractedWordRange[] {
  const checkBoundaries = !UNSPACED_LANGUAGES.has(language.toLowerCase().split('-')[0] ?? '');
  const claimed: ExtractedWordRange[] = [];
  items.forEach((item, index) => {
    const needles = [...new Set([item.surface, item.word].map(value => value?.trim() ?? '').filter(Boolean))];
    for (const needle of needles) {
      const range = firstUnclaimedMatch(passage, needle, checkBoundaries, claimed);
      if (range) {
        claimed.push({ index, ...range });
        return;
      }
    }
  });
  return claimed.sort((left, right) => left.start - right.start);
}
