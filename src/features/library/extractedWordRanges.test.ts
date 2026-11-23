import { describe, expect, it } from 'vitest';
import { findExtractedRanges } from './extractedWordRanges';

const marked = (passage: string, ranges: ReturnType<typeof findExtractedRanges>) =>
  ranges.map(range => [range.index, passage.slice(range.start, range.end)]);

describe('findExtractedRanges', () => {
  it('finds each item by its surface form, ignoring case, in passage order', () => {
    const passage = 'When the river crested at dawn, Residents felt vindicated.';
    const ranges = findExtractedRanges(passage, [
      { word: 'vindicate', surface: 'vindicated' },
      { word: 'crest', surface: 'crested' },
      { word: 'resident', surface: 'residents' },
    ], 'en');

    expect(marked(passage, ranges)).toEqual([[1, 'crested'], [2, 'Residents'], [0, 'vindicated']]);
  });

  it('matches whole words only in languages written with spaces', () => {
    const passage = 'The artist painted a part of the apartment.';
    expect(marked(passage, findExtractedRanges(passage, [{ word: 'art' }, { word: 'part' }], 'en')))
      .toEqual([[1, 'part']]);
  });

  it('treats Vietnamese diacritics as letters of the word', () => {
    const passage = 'Bạn học tiếng Việt và học sinh khác.';
    expect(marked(passage, findExtractedRanges(passage, [{ word: 'Việt' }, { word: 'học sinh' }, { word: 'iệt' }], 'vi')))
      .toEqual([[0, 'Việt'], [1, 'học sinh']]);
  });

  it('matches plain substrings for Japanese and Chinese', () => {
    const japanese = '私は毎朝新聞を読みます。';
    expect(marked(japanese, findExtractedRanges(japanese, [{ word: '新聞' }, { word: '読む', surface: '読み' }], 'ja')))
      .toEqual([[0, '新聞'], [1, '読み']]);
    const chinese = '我们明天去图书馆。';
    expect(marked(chinese, findExtractedRanges(chinese, [{ word: '图书馆' }], 'zh-Hans'))).toEqual([[0, '图书馆']]);
  });

  it('gives each item the first occurrence no earlier item claimed and never overlaps', () => {
    const passage = 'record the record, then record more';
    const ranges = findExtractedRanges(passage, [
      { word: 'record' },
      { word: 'record' },
      { word: 'the record' },
    ], 'en');

    expect(ranges).toEqual([
      { index: 0, start: 0, end: 6 },
      { index: 1, start: 11, end: 17 },
    ]);
  });

  it('falls back to the word when the surface is not found and leaves unknown items unmarked', () => {
    const passage = 'Engineers called the embankments provisional.';
    expect(marked(passage, findExtractedRanges(passage, [
      { word: 'provisional', surface: 'temporary' },
      { word: 'levee' },
      { word: '  ' },
    ], 'en'))).toEqual([[0, 'provisional']]);
  });

  it('reads search text literally', () => {
    const passage = 'Use C++ (or C#) for a.b tests.';
    expect(marked(passage, findExtractedRanges(passage, [{ word: 'C++' }, { word: '(or' }, { word: 'a.b' }], 'en')))
      .toEqual([[0, 'C++'], [1, '(or'], [2, 'a.b']]);
  });
});
