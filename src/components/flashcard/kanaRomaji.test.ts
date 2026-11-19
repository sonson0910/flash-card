import { describe, expect, it } from 'vitest';
import { romanizeKana, splitKanaMorae, toHiragana } from './kanaRomaji';

describe('romanizeKana', () => {
  it.each([
    ['けいけん', 'keiken'],
    ['にっぽん', 'nippon'],
    ['かいせき', 'kaiseki'],
    ['くうこう', 'kuukou'],
    ['おもしろい', 'omoshiroi'],
    ['しゃしん', 'shashin'],
    ['ちょっと', 'chotto'],
    ['まっちゃ', 'matcha'],
    ['じゅぎょう', 'jugyou'],
    ['きんえん', "kin'en"],
    ['こんや', "kon'ya"],
    ['ふつう', 'futsuu'],
    ['ティー', 'tii'],
    ['ファン', 'fan'],
    ['ウィキ', 'wiki'],
    ['コーヒー', 'koohii'],
  ])('%s → %s', (kana, romaji) => {
    expect(romanizeKana(kana)).toBe(romaji);
  });

  it('passes text that is not kana through unchanged', () => {
    expect(romanizeKana('経験')).toBe('経験');
  });
});

describe('splitKanaMorae', () => {
  it('keeps small kana with the kana before them and counts っ, ん and ー as morae', () => {
    expect(splitKanaMorae('にっぽん')).toEqual(['に', 'っ', 'ぽ', 'ん']);
    expect(splitKanaMorae('しゃしん')).toEqual(['しゃ', 'し', 'ん']);
    expect(splitKanaMorae('コーヒー')).toEqual(['コ', 'ー', 'ヒ', 'ー']);
  });
});

describe('toHiragana', () => {
  it('maps katakana onto hiragana and leaves other text alone', () => {
    expect(toHiragana('カタカナ')).toBe('かたかな');
    expect(toHiragana('ー漢字a')).toBe('ー漢字a');
  });
});
