import { describe, expect, it } from 'vitest';
import { resolveStaticJapanesePitchAccent } from '../../features/languagePacks/japanesePitch';
import { loadLanguagePack } from '../../features/languagePacks/registry';
import type { CardData } from '../../types/card';
import { buildExampleSegments, buildLanguageCardReading, findExampleWord } from './languageCardReading';

type ReadingCard = Pick<CardData, 'word' | 'phonetic' | 'partOfSpeech' | 'japanesePitchAccent'>;

async function readingFor(pack: 'ko' | 'ja' | 'zh', card: ReadingCard) {
  const loaded = await loadLanguagePack(pack);
  return buildLanguageCardReading(card, loaded.rendering.buildReadingPlan(card));
}

describe('buildLanguageCardReading', () => {
  it('splits a Korean predicate into Hangul blocks and accents the stem before 하다', async () => {
    const reading = await readingFor('ko', { word: '결심하다', phonetic: '', partOfSpeech: 'verb' });

    expect(reading).toMatchObject({
      pack: 'ko',
      headword: [{ text: '결심', accent: true }, { text: '하다' }],
      blocks: [
        { text: '결', romanization: 'gyeol' },
        { text: '심', romanization: 'sim' },
        { text: '하', romanization: 'ha' },
        { text: '다', romanization: 'da' },
      ],
      backReading: 'gyeolsimhada',
    });
  });

  it('leaves a Korean noun unaccented', async () => {
    const reading = await readingFor('ko', { word: '사랑', phonetic: '', partOfSpeech: 'noun' });

    expect(reading?.headword).toEqual([{ text: '사랑' }]);
  });

  it('puts the kana over the kanji and romanizes it, without a pitch when none is verified', async () => {
    const reading = await readingFor('ja', { word: '経験', phonetic: 'けいけん', partOfSpeech: 'noun' });

    expect(reading).toMatchObject({
      pack: 'ja',
      headword: [{ text: '経験', ruby: 'けいけん' }],
      kana: 'けいけん',
      romaji: 'keiken',
      pitch: null,
      backReading: 'けいけん · keiken',
    });
    expect(reading?.pack === 'ja' && reading.morae.map(mora => mora.text)).toEqual(['け', 'い', 'け', 'ん']);
    expect(reading?.pack === 'ja' && reading.morae.every(mora => mora.high === undefined)).toBe(true);
  });

  it('sets no ruby over a word written in kana', async () => {
    const reading = await readingFor('ja', { word: 'りんご', phonetic: '/ringo/', partOfSpeech: 'noun' });

    expect(reading?.headword).toEqual([{ text: 'りんご' }]);
    expect(reading).toMatchObject({ pack: 'ja', romaji: 'ringo' });
  });

  it('keeps okurigana outside the ruby', async () => {
    const reading = await readingFor('ja', { word: '面白い', phonetic: 'おもしろい', partOfSpeech: 'adjective' });

    expect(reading?.headword).toEqual([{ text: '面白', ruby: 'おもしろ' }, { text: 'い' }]);
  });

  it('draws the pitch of a verified accent mora by mora', async () => {
    const accent = resolveStaticJapanesePitchAccent({ word: '日本', phonetic: 'にっぽん' });
    expect(accent?.downstep).toBe(3);
    const reading = await readingFor('ja', { word: '日本', phonetic: 'にっぽん', partOfSpeech: 'noun', japanesePitchAccent: accent });

    expect(reading).toMatchObject({ pack: 'ja', romaji: 'nippon', pitch: { type: 'nakadaka', downstep: 3 } });
    expect(reading?.pack === 'ja' && reading.morae).toEqual([
      { text: 'に', high: false, step: false },
      { text: 'っ', high: true, step: true },
      { text: 'ぽ', high: true, step: false },
      { text: 'ん', high: false, step: true },
    ]);
  });

  it('ignores a stored accent that does not match the pinned source', async () => {
    const accent = resolveStaticJapanesePitchAccent({ word: '日本', phonetic: 'にっぽん' });
    const reading = await readingFor('ja', { word: '日本', phonetic: 'にっぽん', partOfSpeech: 'noun', japanesePitchAccent: { ...accent!, downstep: 0 } });

    expect(reading?.pack === 'ja' && reading.pitch).toBeNull();
  });

  it('puts one pinyin syllable with its tone over each Chinese character', async () => {
    const reading = await readingFor('zh', { word: '机会', phonetic: 'jī huì', partOfSpeech: 'noun' });

    expect(reading).toMatchObject({
      pack: 'zh',
      headword: [{ text: '机', ruby: 'jī', tone: 1 }, { text: '会', ruby: 'huì', tone: 4 }],
      syllables: [{ text: 'jī', tone: 1 }, { text: 'huì', tone: 4 }],
      backReading: 'jī huì',
    });
  });

  it('shows no reading aid the card does not carry', async () => {
    const reading = await readingFor('zh', { word: '机会', phonetic: '', partOfSpeech: 'noun' });

    expect(reading).toMatchObject({ pack: 'zh', headword: [{ text: '机会' }], syllables: [], backReading: null });
  });
});

describe('findExampleWord', () => {
  it('finds a conjugated Korean predicate by its stem', () => {
    const sentence = '올해는 한국어를 꼭 배우기로 결심했어요.';
    const found = findExampleWord(sentence, { word: '결심하다', partOfSpeech: 'verb' }, 'ko');

    expect(found && sentence.slice(found.start, found.end)).toBe('결심했어요');
  });

  it('finds a conjugated Japanese verb by its stem', () => {
    const sentence = '毎日日本語を勉強します。';
    const found = findExampleWord(sentence, { word: '勉強する', partOfSpeech: 'verb' }, 'ja');

    expect(found && sentence.slice(found.start, found.end)).toBe('勉強');
  });

  it('leaves the sentence unmarked when the word is not in it', () => {
    expect(findExampleWord('这是一个很好的机会。', { word: '经验', partOfSpeech: 'noun' }, 'zh')).toBeNull();
  });
});

describe('buildExampleSegments', () => {
  it('marks the word and carries its kana when the sentence uses it exactly', async () => {
    const card = { word: '経験', phonetic: 'けいけん', partOfSpeech: 'noun' };
    const reading = await readingFor('ja', card);

    expect(buildExampleSegments('日本で働いた経験があります。', card, 'ja', reading)).toEqual([
      { text: '日本で働いた' },
      { text: '経験', highlight: true, ruby: 'けいけん' },
      { text: 'があります。' },
    ]);
  });

  it('marks a Chinese word without a ruby', () => {
    expect(buildExampleSegments('这是一个很好的机会。', { word: '机会', partOfSpeech: 'noun' }, 'zh', null)).toEqual([
      { text: '这是一个很好的' },
      { text: '机会', highlight: true, ruby: undefined },
      { text: '。' },
    ]);
  });
});
