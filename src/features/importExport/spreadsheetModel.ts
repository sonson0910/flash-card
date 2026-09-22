import { isSupportedAudioUrl } from '../../lib/audio';
import { normalizePartOfSpeech } from '../../lib/cardQuery';
import { isSupportedImageUrl } from '../../lib/images';
import { normalizeCardWord } from '../../lib/cardIdentity';
import type { CardData } from '../../types/card';
import { createLexemeId } from '../multilingual/lexemeIdentity';

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
  lexemeId?: string;
  language?: string;
  senseKey?: string;
  normalizedLemma?: string;
}

const sanitize = (value: unknown, maximum: number) =>
  (typeof value === 'string' ? value : String(value ?? '')).trim().slice(0, maximum);

const getColumn = (row: unknown, ...keys: string[]) => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return '';
  const source = row as Record<string, unknown>;
  const wanted = new Set(keys.map(key => key.toLocaleLowerCase()));
  const match = Object.keys(source).find(key => wanted.has(key.trim().toLocaleLowerCase()));
  return match ? sanitize(source[match], 4096) : '';
};

export const parseStructuredCardRows = (rows: unknown[]): StructuredCardRow[] => {
  const seen = new Set<string>();
  return rows.slice(0, 5000).flatMap(row => {
    const word = normalizeCardWord(sanitize(getColumn(row, 'word', 'từ vựng'), 80));
    const translation = sanitize(getColumn(row, 'translation', 'nghĩa', 'ý nghĩa'), 256);
    const lexemeId = sanitize(getColumn(row, 'lexeme id', 'lexemeid'), 128);
    const language = sanitize(getColumn(row, 'language'), 64);
    const senseKey = sanitize(getColumn(row, 'sense key', 'sensekey'), 128);
    const normalizedLemma = sanitize(getColumn(row, 'normalized lemma', 'normalizedlemma'), 256) || word;
    const partOfSpeech = normalizePartOfSpeech(getColumn(row, 'part of speech', 'partofspeech', 'word type', 'từ loại'));
    const hasCanonicalIdentity = Boolean(lexemeId || language || senseKey);
    if (hasCanonicalIdentity && (!lexemeId || !language || !senseKey || !partOfSpeech
      || createLexemeId({ language, normalizedLemma, partOfSpeech, senseKey }) !== lexemeId)) return [];
    const identity = lexemeId ? `lexeme:${lexemeId}` : word;
    if (!word || !translation || seen.has(identity)) return [];
    seen.add(identity);
    const audio = getColumn(row, 'audiourl', 'audio', 'âm thanh');
    const image = getColumn(row, 'imageurl', 'image', 'hình ảnh');
    return [{
      word,
      translation,
      explanation: sanitize(getColumn(row, 'explanation', 'giải thích'), 2048),
      phonetic: sanitize(getColumn(row, 'phonetic', 'phiên âm'), 256),
      partOfSpeech,
      category: sanitize(getColumn(row, 'category', 'chủ đề'), 128) || 'Excel Import',
      emoji: sanitize(getColumn(row, 'emoji', 'biểu tượng'), 64) || '📝',
      audioUrl: isSupportedAudioUrl(audio) ? audio : null,
      imageUrl: isSupportedImageUrl(image) ? image : null,
      ...(lexemeId ? {
        lexemeId,
        language,
        senseKey,
        normalizedLemma,
      } : {}),
    }];
  });
};

export const extractFlatWords = (rows: unknown[][], maximum = 200) => {
  const seen = new Set<string>();
  return rows.flat().flatMap(value => {
    if (typeof value !== 'string') return [];
    const word = value.trim().slice(0, 80);
    const key = normalizeCardWord(word);
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [word];
  }).slice(0, maximum);
};

export const cardsToSpreadsheetRows = (cards: CardData[]) => cards.map(card => ({
  'Lexeme ID': card.lexemeId || '',
  Language: card.language || '',
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
