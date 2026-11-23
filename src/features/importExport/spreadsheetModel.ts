import { isSupportedAudioUrl } from '../../lib/audio';
import { normalizePartOfSpeech } from '../../lib/cardQuery';
import { isStockImageUrl } from '../../lib/mediaUrlPolicy';
import { cardLogicalKey, normalizeCardLanguage, normalizeCardWord } from '../../lib/cardIdentity';
import { isSupportedCardTranslationLanguage, normalizeCardTags } from '../../lib/cardNormalization';
import { LEGACY_CARD_LANGUAGE, type CardData, type LearnerDifficulty } from '../../types/card';
import { createLexemeId } from '../multilingual/lexemeIdentity';
import type { SpreadsheetFlatSourceCell, SpreadsheetStructuredSourceRow } from './spreadsheetWorkbook';

export interface StructuredCardRow {
  word: string;
  translation: string;
  explanation: string;
  phonetic: string;
  partOfSpeech: string;
  category: string;
  emoji: string;
  audioUrl: string | null;
  imageUrl: string | null;
  cefrLevel?: string;
  exampleSentence?: string;
  lexemeId?: string;
  language?: string;
  translationLanguage?: string;
  senseKey?: string;
  normalizedLemma?: string;
  /** The Deck cell as written; the import keeps it only when it names one of the learner's decks. */
  deck?: string;
  tags?: string[];
  bookmarked?: boolean;
  learnerDifficulty?: LearnerDifficulty;
}

export type StructuredCardRowClassification =
  | { kind: 'accepted'; row: StructuredCardRow; sourceRow: number }
  | { kind: 'invalid' | 'duplicate'; sourceRow: number; word?: string };

export type FlatWordClassification =
  | { kind: 'accepted'; word: string; sourceRow: number; sourceColumn: number }
  | { kind: 'duplicate' | 'skipped'; word: string; sourceRow: number; sourceColumn: number };

const sanitize = (value: unknown, maximum: number) =>
  (typeof value === 'string' ? value : String(value ?? '')).trim().slice(0, maximum);

const getColumn = (row: unknown, ...keys: string[]) => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return '';
  const source = row as Record<string, unknown>;
  const wanted = new Set(keys.map(key => key.toLocaleLowerCase()));
  const match = Object.keys(source).find(key => wanted.has(key.trim().toLocaleLowerCase()));
  return match ? sanitize(source[match], 4096) : '';
};

const STARRED_CELL_VALUES = new Set(['yes', 'y', 'true', '1', 'có']);

const LEARNER_DIFFICULTY_CELL_VALUES: ReadonlyMap<string, LearnerDifficulty> = new Map([
  ['easy', 'easy'], ['medium', 'medium'], ['hard', 'hard'],
  ['dễ', 'easy'], ['trung bình', 'medium'], ['khó', 'hard'],
]);

const LEARNER_DIFFICULTY_LABELS: Readonly<Record<LearnerDifficulty, string>> = {
  easy: 'Easy', medium: 'Medium', hard: 'Hard',
};

/** The Tags column joins tags with "; "; a tag itself never contains a comma. */
const TAG_CELL_SEPARATOR = /[;,]/u;

const learnerColumns = (row: unknown): Pick<StructuredCardRow, 'deck' | 'tags' | 'bookmarked' | 'learnerDifficulty'> => {
  const deck = sanitize(getColumn(row, 'deck', 'bộ thẻ'), 128);
  const tags = normalizeCardTags(getColumn(row, 'tags', 'tag', 'nhãn').split(TAG_CELL_SEPARATOR));
  const starred = STARRED_CELL_VALUES.has(getColumn(row, 'starred', 'star', 'đánh dấu sao').toLocaleLowerCase());
  const learnerDifficulty = LEARNER_DIFFICULTY_CELL_VALUES.get(getColumn(row, 'difficulty', 'độ khó').toLocaleLowerCase());
  return {
    ...(deck ? { deck } : {}),
    ...(tags.length ? { tags } : {}),
    ...(starred ? { bookmarked: true } : {}),
    ...(learnerDifficulty ? { learnerDifficulty } : {}),
  };
};

/** The active course's language pair, which a row without a Language or Translation Language cell takes. */
export interface StructuredImportLanguageDefaults {
  language: string;
  translationLanguage: string;
}

export const structuredCardLogicalKey = (row: Pick<StructuredCardRow,
  'word' | 'lexemeId' | 'language' | 'senseKey' | 'partOfSpeech' | 'normalizedLemma'>,
) => cardLogicalKey({ id: '', normalizedWord: row.word, ...row });

export const classifyStructuredCardRows = (
  sourceRows: SpreadsheetStructuredSourceRow[],
  defaults?: StructuredImportLanguageDefaults,
): StructuredCardRowClassification[] => {
  const seen = new Set<string>();
  // An English row stays without a language: the library already files it under English, and an
  // explicit language would send every row through the per-word lookup that other languages need.
  const defaultLanguage = normalizeCardLanguage(defaults?.language);
  const rowDefaultLanguage = defaultLanguage === LEGACY_CARD_LANGUAGE ? '' : defaultLanguage;
  const pairedTranslationLanguage = normalizeCardLanguage(defaults?.translationLanguage);
  const defaultTranslationLanguage = isSupportedCardTranslationLanguage(pairedTranslationLanguage) ? pairedTranslationLanguage : '';
  return sourceRows.slice(0, 5000).map(({ row, sourceRow }) => {
    const word = normalizeCardWord(sanitize(getColumn(row, 'word', 'từ vựng'), 80));
    const translation = sanitize(getColumn(row, 'translation', 'nghĩa', 'ý nghĩa'), 256);
    const lexemeId = sanitize(getColumn(row, 'lexeme id', 'lexemeid'), 128);
    const suppliedLanguage = sanitize(getColumn(row, 'language'), 64);
    const language = normalizeCardLanguage(suppliedLanguage);
    const suppliedTranslationLanguage = sanitize(getColumn(row, 'translation language', 'translationlanguage'), 64);
    const translationLanguage = normalizeCardLanguage(suppliedTranslationLanguage)
      || (suppliedTranslationLanguage ? '' : defaultTranslationLanguage);
    const senseKey = sanitize(getColumn(row, 'sense key', 'sensekey'), 128);
    const suppliedNormalizedLemma = sanitize(getColumn(row, 'normalized lemma', 'normalizedlemma'), 256);
    const normalizedLemma = suppliedNormalizedLemma || word;
    const partOfSpeech = normalizePartOfSpeech(getColumn(row, 'part of speech', 'partofspeech', 'word type', 'từ loại'));
    const hasCanonicalIdentity = Boolean(lexemeId || senseKey || suppliedNormalizedLemma);
    const invalidLanguage = Boolean(suppliedLanguage && !language);
    const invalidTranslationLanguage = Boolean(
      suppliedTranslationLanguage && (!translationLanguage || !isSupportedCardTranslationLanguage(translationLanguage)),
    );
    const invalidCanonicalIdentity = hasCanonicalIdentity && (!lexemeId || !language || !senseKey || !partOfSpeech
      || createLexemeId({ language, normalizedLemma, partOfSpeech, senseKey }) !== lexemeId);
    if (invalidLanguage || invalidTranslationLanguage || invalidCanonicalIdentity) {
      return { kind: 'invalid', sourceRow, ...(word ? { word } : {}) };
    }
    const rowLanguage = language || (lexemeId ? '' : rowDefaultLanguage);
    const identity = structuredCardLogicalKey({
      word, lexemeId: lexemeId || undefined, language: rowLanguage || undefined,
      senseKey: senseKey || undefined, partOfSpeech, normalizedLemma,
    });
    if (!word || !translation) return { kind: 'invalid', sourceRow, ...(word ? { word } : {}) };
    if (seen.has(identity)) return { kind: 'duplicate', sourceRow, word };
    seen.add(identity);
    const audio = getColumn(row, 'audiourl', 'audio', 'âm thanh');
    const image = getColumn(row, 'imageurl', 'image', 'hình ảnh');
    return {
      kind: 'accepted',
      sourceRow,
      row: {
        word,
        translation,
        explanation: sanitize(getColumn(row, 'explanation', 'giải thích'), 2048),
        phonetic: sanitize(getColumn(row, 'phonetic', 'phiên âm'), 256),
        partOfSpeech,
        category: sanitize(getColumn(row, 'category', 'chủ đề'), 128) || 'Excel Import',
        emoji: sanitize(getColumn(row, 'emoji', 'biểu tượng'), 64) || '📝',
        audioUrl: isSupportedAudioUrl(audio) ? audio : null,
        // A learner's own uploaded photo is refused by the card service unless it is the importer's
        // own, and a sheet can carry another learner's link, so only stock photos are kept.
        imageUrl: isStockImageUrl(image) ? image : null,
        ...(sanitize(getColumn(row, 'cefr level', 'cefrlevel', 'cefr'), 8) ? {
          cefrLevel: sanitize(getColumn(row, 'cefr level', 'cefrlevel', 'cefr'), 8).toUpperCase(),
        } : {}),
        ...(sanitize(getColumn(row, 'example sentence', 'examplesentence', 'example'), 2048) ? {
          exampleSentence: sanitize(getColumn(row, 'example sentence', 'examplesentence', 'example'), 2048),
        } : {}),
        ...(lexemeId ? {
          lexemeId,
          language,
          senseKey,
          normalizedLemma,
        } : {}),
        ...(!lexemeId && rowLanguage ? { language: rowLanguage } : {}),
        ...(translationLanguage ? { translationLanguage } : {}),
        ...learnerColumns(row),
      },
    };
  });
};

export const parseStructuredCardRows = (rows: unknown[]): StructuredCardRow[] => classifyStructuredCardRows(
  rows.map((row, index) => ({ row, sourceRow: index + 1 })),
).flatMap(classification => classification.kind === 'accepted' ? [classification.row] : []);

export function* classifyFlatWords(
  sourceCells: SpreadsheetFlatSourceCell[],
  maximum = 200,
): Generator<FlatWordClassification> {
  const seen = new Set<string>();
  let accepted = 0;
  for (const { value, sourceRow, sourceColumn } of sourceCells) {
    if (typeof value !== 'string') continue;
    const word = value.trim().slice(0, 80);
    const key = normalizeCardWord(word);
    if (!key) continue;
    if (seen.has(key)) {
      yield { kind: 'duplicate', word, sourceRow, sourceColumn };
      continue;
    }
    seen.add(key);
    if (accepted >= maximum) {
      yield { kind: 'skipped', word, sourceRow, sourceColumn };
      continue;
    }
    accepted += 1;
    yield { kind: 'accepted', word, sourceRow, sourceColumn };
  }
}

export const extractFlatWords = (rows: unknown[][], maximum = 200) => {
  const words: string[] = [];
  for (const classification of classifyFlatWords(rows.flatMap((row, rowIndex) => row.map((value, columnIndex) => ({
    value,
    sourceRow: rowIndex + 1,
    sourceColumn: columnIndex + 1,
  }))), maximum)) {
    if (classification.kind === 'accepted') words.push(classification.word);
  }
  return words;
};

export const cardsToSpreadsheetRows = (cards: CardData[]) => cards.map(card => ({
  'Lexeme ID': card.lexemeId || '',
  Language: card.language || '',
  'Translation Language': card.translationLanguage || '',
  'Sense Key': card.senseKey || '',
  'Normalized Lemma': card.normalizedLemma || '',
  Word: card.word,
  Translation: card.translation,
  Explanation: card.explanation,
  Phonetic: card.phonetic,
  'Part of Speech': normalizePartOfSpeech(card.partOfSpeech),
  Category: card.category,
  Emoji: card.emoji,
  Deck: card.customDeck || '',
  Tags: normalizeCardTags(card.tags).join('; '),
  Starred: card.bookmarked ? 'Yes' : '',
  Difficulty: card.learnerDifficulty ? LEARNER_DIFFICULTY_LABELS[card.learnerDifficulty] : '',
  'CEFR Level': card.cefrLevel || '',
  'Date Added': card.createdAt ? new Date(card.createdAt).toLocaleDateString() : 'N/A',
}));
