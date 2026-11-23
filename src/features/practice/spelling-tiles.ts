export type SpellingTileState = 'typed' | 'empty' | 'correct' | 'wrong' | 'missing';

export interface SpellingTile {
  readonly char: string;
  readonly state: SpellingTileState;
}

/** Splits text into user-perceived characters so a Hangul block or an accented letter is one tile. */
export function spellingCharacters(value: string): string[] {
  const text = value.normalize('NFC');
  const Segmenter = (Intl as typeof Intl & { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Segmenter) return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment);
  return Array.from(text);
}

const same = (left: string, right: string) => left.toLocaleLowerCase() === right.toLocaleLowerCase();

/** Tiles while typing: what the learner has entered, then an empty slot for each letter still to go. */
export function draftSpellingTiles(input: string, word: string): SpellingTile[] {
  const typed = spellingCharacters(input);
  const slots = Math.max(typed.length, spellingCharacters(word.trim()).length);
  return Array.from({ length: slots }, (_, index) => (
    index < typed.length ? { char: typed[index], state: 'typed' } : { char: '', state: 'empty' }
  ));
}

/**
 * Aligns two character lists with the fewest edits. When a doubled letter makes the place of a
 * gap ambiguous, the backtrack from the end puts the gap at the earliest place.
 */
function align(typed: readonly string[], target: readonly string[]): SpellingTile[] {
  const rows = typed.length + 1;
  const columns = target.length + 1;
  const cost: number[][] = Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => (row === 0 ? column : column === 0 ? row : 0)));
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      cost[row][column] = Math.min(
        cost[row - 1][column - 1] + (same(typed[row - 1], target[column - 1]) ? 0 : 1),
        cost[row - 1][column] + 1,
        cost[row][column - 1] + 1,
      );
    }
  }
  const tiles: SpellingTile[] = [];
  let row = typed.length;
  let column = target.length;
  while (row > 0 || column > 0) {
    if (row > 0 && column > 0 && cost[row][column] === cost[row - 1][column - 1] + (same(typed[row - 1], target[column - 1]) ? 0 : 1)) {
      tiles.push({ char: typed[row - 1], state: same(typed[row - 1], target[column - 1]) ? 'correct' : 'wrong' });
      row -= 1;
      column -= 1;
    } else if (column > 0 && cost[row][column] === cost[row][column - 1] + 1) {
      tiles.push({ char: target[column - 1], state: 'missing' });
      column -= 1;
    } else {
      tiles.push({ char: typed[row - 1], state: 'wrong' });
      row -= 1;
    }
  }
  return tiles.reverse();
}

/**
 * Tiles after a check: the learner's answer aligned to the word with the fewest edits. Matching
 * letters are correct, a letter typed in place of another (or one too many) is wrong, and a letter
 * of the word the learner left out is shown as missing. The alignment runs on the reversed text so
 * a gap in a doubled letter lands on its second letter ("neces_ary"), which is how people read it.
 */
export function checkedSpellingTiles(input: string, word: string): SpellingTile[] {
  const typed = spellingCharacters(input.trim()).reverse();
  const target = spellingCharacters(word.trim()).reverse();
  return align(typed, target).reverse();
}

/** The tiles a learner sees: their input while typing, the letter-by-letter result after a check. */
export function spellingTilesFor(input: string, word: string, checked: boolean, correct: boolean): SpellingTile[] {
  if (!checked) return draftSpellingTiles(input, word);
  if (correct) return spellingCharacters(input.trim()).map(char => ({ char, state: 'correct' }));
  return checkedSpellingTiles(input, word);
}
