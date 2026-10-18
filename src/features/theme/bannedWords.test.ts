import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const bannedWords = ['rank', 'ranks', 'kill', 'kills', 'rift', 'battle', 'campaign', 'season', 'boss', 'duel', 'clash', 'strike', 'forge', 'raid'];
const bannedWordsByLocale: Record<string, readonly string[]> = {
  vi: ['xếp hạng', 'hạ gục', 'khe nứt', 'trận chiến', 'chiến dịch', 'mùa giải', 'trùm', 'đấu tay đôi', 'giao tranh', 'tấn công', 'lò rèn', 'đột kích'],
};

const bannedPatternForLocale = (locale: string) => new RegExp(
  `(?<![\\p{L}\\p{N}_])(${[...bannedWords, ...(bannedWordsByLocale[locale] ?? [])].join('|')})(?![\\p{L}\\p{N}_])`,
  'iu',
);

const crystalComponents = () => readdirSync(resolve(root, 'components/lumi'), { encoding: 'utf8', recursive: true })
  .filter(file => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
  .map(file => resolve(root, 'components/lumi', file));

const catalogMessageText = (entry: string) => {
  let capturing = false;
  return entry.split('\n').flatMap(line => {
    if (/^msg(?:id(?:_plural)?|str(?:\[\d+\])?) /.test(line)) {
      capturing = true;
      return line;
    }
    if (capturing && line.startsWith('"')) return line;
    capturing = false;
    return [];
  }).join('\n');
};

const crystalCatalogMessages = () => readdirSync(resolve(root, 'i18n/locales'), { encoding: 'utf8', recursive: true })
  .filter(file => file.endsWith('.po'))
  .flatMap(file => {
    const locale = file.split('/')[0];
    return readFileSync(resolve(root, 'i18n/locales', file), 'utf8')
      .split(/\n\s*\n/)
      .filter(entry => /^msgctxt "crystal\./m.test(entry))
      .map(message => ({ locale, text: catalogMessageText(message) }));
  });

const matchesBannedWord = (source: string, locale = 'en') => source.match(bannedPatternForLocale(locale))?.[0];

describe('Crystal Star copy guard', () => {
  it('recognizes banned words only as whole words', () => {
    expect(matchesBannedWord('A battle begins.')).toBe('battle');
    expect(matchesBannedWord('Ranks do not belong here.')).toBe('Ranks');
    expect(matchesBannedWord('KILLS do not belong here.')).toBe('KILLS');
    expect(matchesBannedWord('A crystalline study prompt.')).toBeUndefined();
    expect(matchesBannedWord('A ranked study prompt.')).toBeUndefined();
  });

  it('recognizes Vietnamese game terms without banning ordinary study words', () => {
    for (const word of bannedWordsByLocale.vi) {
      expect(matchesBannedWord(`Lumi nói ${word}.`, 'vi')).toBe(word);
    }

    expect(matchesBannedWord('Hôm nay học về mùa và xếp từ mới.', 'vi')).toBeUndefined();
  });

  it('keeps Crystal Star component copy free of banned words', () => {
    for (const file of crystalComponents()) {
      expect(matchesBannedWord(readFileSync(file, 'utf8')), file).toBeUndefined();
    }
  });

  it('keeps crystal-context catalog messages free of banned words', () => {
    for (const { locale, text } of crystalCatalogMessages()) {
      expect(matchesBannedWord(text, locale), `${locale}: ${text}`).toBeUndefined();
    }
  });
});
