import { isSupportedAudioUrl } from '../../lib/audio';
import { normalizePartOfSpeech } from '../../lib/cardQuery';
import { isSupportedImageUrl } from '../../lib/images';
import { cardLogicalKey, normalizeCardLanguage, normalizeCardWord } from '../../lib/cardIdentity';
import { isSupportedCardTranslationLanguage } from '../../lib/cardNormalization';
import type { CardData } from '../../types/card';
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

export const structuredCardLogicalKey = (row: Pick<StructuredCardRow,
  'word' | 'lexemeId' | 'language' | 'senseKey' | 'partOfSpeech' | 'normalizedLemma'>,
) => cardLogicalKey({ id: '', normalizedWord: row.word, ...row });

export const classifyStructuredCardRows = (
  sourceRows: SpreadsheetStructuredSourceRow[],
): StructuredCardRowClassification[] => {
  const seen = new Set<string>();
  return sourceRows.slice(0, 5000).map(({ row, sourceRow }) => {
    const word = normalizeCardWord(sanitize(getColumn(row, 'word', 'từ vựng'), 80));
    const translation = sanitize(getColumn(row, 'translation', 'nghĩa', 'ý nghĩa'), 256);
    const lexemeId = sanitize(getColumn(row, 'lexeme id', 'lexemeid'), 128);
    const suppliedLanguage = sanitize(getColumn(row, 'language'), 64);
    const language = normalizeCardLanguage(suppliedLanguage);
    const suppliedTranslationLanguage = sanitize(getColumn(row, 'translation language', 'translationlanguage'), 64);
    const translationLanguage = normalizeCardLanguage(suppliedTranslationLanguage);
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
    const identity = structuredCardLogicalKey({
      word, lexemeId: lexemeId || undefined, language: language || undefined,
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
        imageUrl: isSupportedImageUrl(image) ? image : null,
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
        ...(!lexemeId && language ? { language } : {}),
        ...(translationLanguage ? { translationLanguage } : {}),
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
  'Date Added': card.createdAt ? new Date(card.createdAt).toLocaleDateString() : 'N/A',
}));
