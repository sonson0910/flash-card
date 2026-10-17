/**
 * A deliberately small, source-pinned subset of UniDic Kana Accent 2.1.2.
 * Entries are admitted only when their source row describes a standalone,
 * unmodified accent. See contract-japanese-pitch-accent.md for attribution.
 */
export interface JapanesePitchAccent {
  readonly readingKana: string;
  readonly moraCount: number;
  /** The mora after which the pitch falls. Zero represents heiban. */
  readonly downstep: number;
  readonly source: {
    readonly dataset: 'unidic-kana-accent';
    readonly version: '2.1.2';
    readonly archiveSha256: string;
    readonly row: string;
  };
}

export interface JapanesePitchCardInput {
  readonly word: string;
  readonly phonetic?: string | null;
  readonly japanesePitchAccent?: JapanesePitchAccent;
}

interface UniDicKanaAccentRow {
  readonly word: string;
  readonly kana: string;
  readonly aType: string;
  readonly aConType: string;
  readonly aModType: string;
  /** One-based line number in the pinned `lex.csv`. */
  readonly sourceLine: number;
}

const ARCHIVE_SHA256 = '70793cacda81b403eda71736cc180f3144303623755a612b13e1dffeb6554591';
const SMALL_HIRAGANA = new Set(['ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'ゃ', 'ゅ', 'ょ', 'ゎ', 'ゕ', 'ゖ']);

/**
 * Selected from the checksum-verified archive with:
 * `unzip -p unidic-mecab_kana-accent-2.1.2_src.zip '*\/lex.csv'`.
 *
 * The source lines below are deliberately retained, including the two
 * `面白い` forms. The resolver rejects a word/kana pair unless exactly one row
 * remains, so POS or inflection ambiguity never becomes a pitch assertion.
 */
const PINNED_SOURCE_ROWS: readonly UniDicKanaAccentRow[] = [
  { word: '解析', kana: 'カイセキ', aType: '0', aConType: 'C2', aModType: '*', sourceLine: 138215 },
  { word: '空港', kana: 'クーコー', aType: '0', aConType: 'C2', aModType: '*', sourceLine: 215091 },
  { word: '形態', kana: 'ケータイ', aType: '0', aConType: 'C2', aModType: '*', sourceLine: 235745 },
  { word: '国際', kana: 'コクサイ', aType: '0', aConType: 'C2', aModType: '*', sourceLine: 250943 },
  { word: '日本', kana: 'ニッポン', aType: '3', aConType: '*', aModType: '*', sourceLine: 503828 },
  { word: '面白い', kana: 'オモシロイ', aType: '4', aConType: 'C1', aModType: '*', sourceLine: 130125 },
  { word: '面白い', kana: 'オモシロイ', aType: '4', aConType: 'C1', aModType: '*', sourceLine: 130128 },
];

export const normalizeJapaneseKana = (value: string): string => Array.from(value.normalize('NFC').trim(), (character) => {
  const codePoint = character.codePointAt(0)!;
  return codePoint >= 0x30a1 && codePoint <= 0x30f6
    ? String.fromCodePoint(codePoint - 0x60)
    : character;
}).join('');

export const countJapaneseMora = (kana: string): number => {
  let count = 0;
  for (const character of normalizeJapaneseKana(kana)) {
    if (!SMALL_HIRAGANA.has(character)) count += 1;
  }
  return count;
};

const toPitchAccent = (row: UniDicKanaAccentRow): JapanesePitchAccent | undefined => {
  if (!/^\d+$/u.test(row.aType) || row.aModType !== '*') return undefined;

  const readingKana = normalizeJapaneseKana(row.kana);
  const moraCount = countJapaneseMora(readingKana);
  const downstep = Number(row.aType);
  if (moraCount === 0 || downstep > moraCount) return undefined;

  return {
    readingKana,
    moraCount,
    downstep,
    source: {
      dataset: 'unidic-kana-accent',
      version: '2.1.2',
      archiveSha256: ARCHIVE_SHA256,
      row: [row.sourceLine, row.word, row.kana, row.aType, row.aConType, row.aModType].join('|'),
    },
  };
};

/** Returns a candidate only for an exact source word and kana reading match. */
export const resolveStaticJapanesePitchAccent = (
  card: Pick<JapanesePitchCardInput, 'word' | 'phonetic'>,
): JapanesePitchAccent | undefined => {
  const word = card.word.trim();
  const readingKana = card.phonetic ? normalizeJapaneseKana(card.phonetic) : '';
  const rows = PINNED_SOURCE_ROWS.filter((candidate) => candidate.word === word && normalizeJapaneseKana(candidate.kana) === readingKana);
  return rows.length === 1 ? toPitchAccent(rows[0]) : undefined;
};

/**
 * Allows rendering only for metadata that exactly matches this pinned subset.
 * This prevents a caller from turning an arbitrary kana reading into a pitch claim.
 */
export const resolveStoredJapanesePitchAccent = (
  card: JapanesePitchCardInput,
): JapanesePitchAccent | undefined => {
  const expected = resolveStaticJapanesePitchAccent(card);
  const stored = card.japanesePitchAccent;
  if (!expected || !stored || !stored.source || typeof stored.source !== 'object') return undefined;

  return stored.readingKana === expected.readingKana
    && stored.moraCount === expected.moraCount
    && stored.downstep === expected.downstep
    && stored.source.dataset === expected.source.dataset
    && stored.source.version === expected.source.version
    && stored.source.archiveSha256 === expected.source.archiveSha256
    && stored.source.row === expected.source.row
    ? expected
    : undefined;
};

/** Applies the conservative acceptance rule used by the offline extractor. */
export const parseUniDicKanaAccentRow = (row: {
  readonly word: string;
  readonly kana: string;
  readonly aType: string;
  readonly aConType: string;
  readonly aModType: string;
  readonly sourceLine?: number;
}): JapanesePitchAccent | undefined => toPitchAccent({ ...row, sourceLine: row.sourceLine ?? 0 });
