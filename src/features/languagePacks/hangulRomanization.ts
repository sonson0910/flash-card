/**
 * Deterministic Revised Romanization of Korean (RR, 2000) for precomposed
 * Hangul syllable blocks (U+AC00-U+D7A3). Runs entirely on Unicode jamo
 * decomposition tables, so it needs no dictionary or network call and works
 * offline for any Hangul vocabulary word.
 *
 * Limitation, documented rather than hidden: this romanizes each syllable
 * block independently and does not apply cross-syllable phonological
 * assimilation (e.g. the ㅂ+ㄴ -> [mn] nasalization in 감사합니다, whose fully
 * assimilated romanization is "gamsahamnida" but this function returns the
 * per-syllable form "gamsahapnida"). That is the standard trade-off made by
 * syllable-by-syllable romanizers without a pronunciation dictionary, and it
 * is still a correct, readable romanization for isolated vocabulary entries.
 */

const LEAD_JAMO = [
  'g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's',
  'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h',
] as const;

const VOWEL_JAMO = [
  'a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa',
  'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i',
] as const;

/** Final-consonant romanization follows pronunciation, not the literal jamo shape. */
const TAIL_JAMO = [
  '', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k',
  'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't',
  't', 'ng', 't', 't', 'k', 't', 'p', 't',
] as const;

const HANGUL_SYLLABLE_START = 0xac00;
const HANGUL_SYLLABLE_END = 0xd7a3;
const VOWEL_COUNT = VOWEL_JAMO.length;
const TAIL_COUNT = TAIL_JAMO.length;

function isHangulSyllable(codePoint: number): boolean {
  return codePoint >= HANGUL_SYLLABLE_START && codePoint <= HANGUL_SYLLABLE_END;
}

function romanizeSyllable(codePoint: number): string {
  const index = codePoint - HANGUL_SYLLABLE_START;
  const leadIndex = Math.floor(index / (VOWEL_COUNT * TAIL_COUNT));
  const vowelIndex = Math.floor((index % (VOWEL_COUNT * TAIL_COUNT)) / TAIL_COUNT);
  const tailIndex = index % TAIL_COUNT;
  return `${LEAD_JAMO[leadIndex]}${VOWEL_JAMO[vowelIndex]}${TAIL_JAMO[tailIndex]}`;
}

/**
 * Romanizes every Hangul syllable block in `value`, leaving any other
 * character (spaces, punctuation, digits, already-Latin text) untouched.
 * Returns null when the input contains no Hangul syllable to romanize, so
 * callers can distinguish "nothing to show" from an empty reading.
 */
export function romanizeHangul(value: string): string | null {
  if (!value) return null;
  let result = '';
  let sawHangul = false;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (isHangulSyllable(codePoint)) {
      sawHangul = true;
      result += romanizeSyllable(codePoint);
    } else {
      result += character;
    }
  }
  return sawHangul ? result : null;
}
