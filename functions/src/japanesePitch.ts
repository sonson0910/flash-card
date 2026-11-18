/** UniDic Kana Accent 2.1.2 entries approved for exact, standalone pitch. */
export interface JapanesePitchAccent {
  readingKana: string;
  moraCount: number;
  downstep: number;
  source: {
    dataset: 'unidic-kana-accent';
    version: '2.1.2';
    archiveSha256: string;
    row: string;
  };
}

const ARCHIVE_SHA256 = '70793cacda81b403eda71736cc180f3144303623755a612b13e1dffeb6554591';
const SMALL_KANA = new Set(['ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'ゃ', 'ゅ', 'ょ', 'ゎ', 'ゕ', 'ゖ']);

// Pinned lex.csv line, headword, kana, aType, aConType, aModType.
// The two 面白い entries are excluded because their word/kana pair has two
// source rows. See docs/design/sonflash-redesign/unidic-kana-accent-notice.md.
const ROWS = [
  [138215, '解析', 'カイセキ', 0, 'C2', '*'],
  [215091, '空港', 'クーコー', 0, 'C2', '*'],
  [235745, '形態', 'ケータイ', 0, 'C2', '*'],
  [250943, '国際', 'コクサイ', 0, 'C2', '*'],
  [503828, '日本', 'ニッポン', 3, '*', '*'],
] as const;

const normalizeKana = (value: string): string => Array.from(value.normalize('NFC').trim(), character => {
  const codePoint = character.codePointAt(0)!;
  return codePoint >= 0x30a1 && codePoint <= 0x30f6
    ? String.fromCodePoint(codePoint - 0x60)
    : character;
}).join('');

export function resolveJapanesePitchAccent(word: string, phonetic: string, language: string): JapanesePitchAccent | undefined {
  if (language !== 'ja') return undefined;
  const readingKana = normalizeKana(phonetic);
  const row = ROWS.find(([, sourceWord, kana]) => sourceWord === word && normalizeKana(kana) === readingKana);
  if (!row) return undefined;
  const [line, sourceWord, kana, downstep, connection, modification] = row;
  const moraCount = Array.from(readingKana).filter(character => !SMALL_KANA.has(character)).length;
  if (moraCount === 0 || downstep > moraCount) return undefined;
  return {
    readingKana,
    moraCount,
    downstep,
    source: {
      dataset: 'unidic-kana-accent',
      version: '2.1.2',
      archiveSha256: ARCHIVE_SHA256,
      row: [line, sourceWord, kana, downstep, connection, modification].join('|'),
    },
  };
}

export function matchesJapanesePitchAccent(value: unknown, expected: JapanesePitchAccent | undefined): boolean {
  if (!expected || !value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const source = candidate.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
  const provenance = source as Record<string, unknown>;
  return Object.keys(candidate).length === 4
    && Object.keys(provenance).length === 4
    && candidate.readingKana === expected.readingKana
    && candidate.moraCount === expected.moraCount
    && candidate.downstep === expected.downstep
    && provenance.dataset === expected.source.dataset
    && provenance.version === expected.source.version
    && provenance.archiveSha256 === expected.source.archiveSha256
    && provenance.row === expected.source.row;
}
