import { describe, expect, it } from 'vitest';
import { checkedSpellingTiles, draftSpellingTiles, spellingCharacters, spellingTilesFor } from './spelling-tiles';

const render = (tiles: ReturnType<typeof checkedSpellingTiles>) => tiles.map(tile => `${tile.char || '_'}:${tile.state}`).join(' ');

describe('spelling tiles', () => {
  it('mirrors typed letters and leaves an empty slot for each letter still to go', () => {
    expect(render(draftSpellingTiles('evi', 'evidence'))).toBe('e:typed v:typed i:typed _:empty _:empty _:empty _:empty _:empty');
    expect(render(draftSpellingTiles('', 'cat'))).toBe('_:empty _:empty _:empty');
  });

  it('grows past the word length instead of hiding extra letters', () => {
    expect(draftSpellingTiles('catss', 'cat')).toHaveLength(5);
    expect(draftSpellingTiles('catss', 'cat').every(tile => tile.state === 'typed')).toBe(true);
  });

  it('marks a left-out letter as missing at its place in the word', () => {
    expect(render(checkedSpellingTiles('necesary', 'necessary'))).toBe('n:correct e:correct c:correct e:correct s:correct s:missing a:correct r:correct y:correct');
    expect(render(checkedSpellingTiles('evidnce', 'evidence'))).toBe('e:correct v:correct i:correct d:correct e:missing n:correct c:correct e:correct');
  });

  it('marks a substituted or extra letter as wrong', () => {
    expect(render(checkedSpellingTiles('benafit', 'benefit'))).toBe('b:correct e:correct n:correct a:wrong f:correct i:correct t:correct');
    expect(render(checkedSpellingTiles('focuss', 'focus'))).toBe('f:correct o:correct c:correct u:correct s:correct s:wrong');
  });

  it('shows every letter of the word as missing for an empty answer', () => {
    expect(render(checkedSpellingTiles('', 'cat'))).toBe('c:missing a:missing t:missing');
  });

  it('ignores letter case and surrounding spaces when comparing', () => {
    expect(checkedSpellingTiles('  Adapt ', 'adapt').every(tile => tile.state === 'correct')).toBe(true);
  });

  it('keeps a Hangul syllable and a combining accent together as one tile', () => {
    expect(spellingCharacters('결심하다')).toEqual(['결', '심', '하', '다']);
    expect(spellingCharacters('café')).toEqual(['c', 'a', 'f', 'é']);
  });

  it('chooses draft tiles before a check and result tiles after it', () => {
    expect(spellingTilesFor('ad', 'adapt', false, false).map(tile => tile.state)).toEqual(['typed', 'typed', 'empty', 'empty', 'empty']);
    expect(spellingTilesFor('adapt', 'adapt', true, true).map(tile => tile.state)).toEqual(['correct', 'correct', 'correct', 'correct', 'correct']);
    expect(spellingTilesFor('adpt', 'adapt', true, false).map(tile => tile.state)).toEqual(['correct', 'correct', 'missing', 'correct', 'correct']);
  });
});
