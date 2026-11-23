/** How one word of the sentence came through in the learner's take. */
export type ShadowingWordMark = 'pending' | 'clear' | 'close' | 'missed';

export interface ShadowingWord {
  /** The word as written, with any punctuation that follows it. */
  readonly text: string;
  readonly mark: ShadowingWordMark;
  /** True for the card's own word, which the sentence accents. */
  readonly focus: boolean;
}

const UNSPACED_LANGUAGES = new Set(['ja', 'zh', 'th']);

/** Lower-case letters and digits only, without accents, so "Café," and "cafe" compare equal. */
const comparable = (value: string) => value
  .normalize('NFKD')
  .replace(/\p{M}+/gu, '')
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '');

function editDistance(left: readonly string[], right: readonly string[]): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1]! + 1,
        previous[column]! + 1,
        previous[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length]!;
}

/** Splits a sentence into the words a learner reads, keeping punctuation with its word. */
export function sentenceWords(sentence: string, language: string): string[] {
  const text = sentence.trim();
  if (!text) return [];
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (!UNSPACED_LANGUAGES.has(language) || !Segmenter) return text.split(/\s+/);
  const words: string[] = [];
  for (const segment of new Segmenter(language, { granularity: 'word' }).segment(text)) {
    if (segment.isWordLike || words.length === 0) words.push(segment.segment);
    else words[words.length - 1] += segment.segment;
  }
  return words.map(word => word.trim()).filter(Boolean);
}

/**
 * Marks each word of the target sentence against what the browser heard: clear when the
 * transcript has the word, close when it has a word at most a third different (a dropped or
 * swapped sound), otherwise missed. Before a take every word is pending.
 */
export function markSentence(sentence: string, transcript: string | null, focusWord: string, language: string): ShadowingWord[] {
  const focus = comparable(focusWord);
  const heard = transcript === null ? null : sentenceWords(transcript, language).map(comparable).filter(Boolean);
  return sentenceWords(sentence, language).map(text => {
    const word = comparable(text);
    const isFocus = Boolean(word) && word === focus;
    if (heard === null || !word) return { text, mark: 'pending', focus: isFocus };
    if (heard.includes(word)) return { text, mark: 'clear', focus: isFocus };
    const letters = Array.from(word);
    const close = letters.length >= 3 && heard.some(candidate => {
      const other = Array.from(candidate);
      return editDistance(letters, other) / Math.max(letters.length, other.length) <= 1 / 3;
    });
    return { text, mark: close ? 'close' : 'missed', focus: isFocus };
  });
}
