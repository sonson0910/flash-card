import { describe, expect, it } from 'vitest';
import {
  cardsToSpreadsheetRows,
  classifyFlatWords,
  classifyStructuredCardRows,
  extractFlatWords,
  parseStructuredCardRows,
} from './spreadsheetModel';
import { createLexemeId } from '../multilingual/lexemeIdentity';
import { getActiveUiLocale, setActiveUiLocale } from '../../i18n/loadCatalog';

describe('spreadsheet import/export model', () => {
  it('normalizes aliases, bounds text, rejects unsafe media and removes duplicates', () => {
    const rows = parseStructuredCardRows([
      { 'Từ vựng': '  Hello  ', Nghĩa: 'Xin chào', 'Từ loại': 'Modal-Verb', Image: 'javascript:alert(1)' },
      { Word: 'hello', Translation: 'duplicate' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ word: 'hello', translation: 'Xin chào', partOfSpeech: 'modal verb', imageUrl: null });
  });

  it('rejects structured rows whose translation is empty after trimming', () => {
    expect(parseStructuredCardRows([
      { Word: 'empty', Translation: '' },
      { Word: 'spaces', Translation: '   \t  ' },
      { Word: 'valid', Translation: ' hợp lệ ' },
    ])).toEqual([
      expect.objectContaining({ word: 'valid', translation: 'hợp lệ' }),
    ]);
  });

  it('extracts a bounded unique flat word list and maps export rows', () => {
    expect(extractFlatWords([[' Apple ', 'apple'], ['Pear', 42]])).toEqual(['Apple', 'Pear']);
    expect(cardsToSpreadsheetRows([{
      id: '1', word: 'apple', translation: 'táo', explanation: '', phonetic: '', emoji: '🍎',
      category: 'Food', partOfSpeech: 'Noun', audioUrl: null, imageUrl: null,
    }])[0]).toMatchObject({ Word: 'apple', Translation: 'táo', 'Part of Speech': 'noun' });
  });

  it('classifies structured rows with their physical source rows', () => {
    expect(classifyStructuredCardRows([
      { row: { Word: 'apple', Translation: 'táo' }, sourceRow: 4 },
      { row: { Word: 'apple', Translation: 'trùng' }, sourceRow: 6 },
      { row: { Word: 'pear', Translation: '' }, sourceRow: 7 },
    ])).toEqual([
      expect.objectContaining({ kind: 'accepted', sourceRow: 4 }),
      { kind: 'duplicate', word: 'apple', sourceRow: 6 },
      { kind: 'invalid', word: 'pear', sourceRow: 7 },
    ]);
  });

  it('classifies flat duplicates and items beyond the unique-word cap with coordinates', () => {
    expect(Array.from(classifyFlatWords([
      { value: ' Apple ', sourceRow: 3, sourceColumn: 2 },
      { value: 'apple', sourceRow: 5, sourceColumn: 1 },
      { value: 'pear', sourceRow: 5, sourceColumn: 3 },
    ], 1))).toEqual([
      { kind: 'accepted', word: 'Apple', sourceRow: 3, sourceColumn: 2 },
      { kind: 'duplicate', word: 'apple', sourceRow: 5, sourceColumn: 1 },
      { kind: 'skipped', word: 'pear', sourceRow: 5, sourceColumn: 3 },
    ]);
  });

  it('streams flat classifications without building a candidate array', () => {
    const classifications = classifyFlatWords([
      { value: 'apple', sourceRow: 1, sourceColumn: 1 },
      { value: 'pear', sourceRow: 2, sourceColumn: 1 },
    ]);
    expect(Array.isArray(classifications)).toBe(false);
    expect(Array.from(classifications)).toHaveLength(2);
  });

  it('keeps distinct validated canonical senses of the same word', () => {
    const rows = parseStructuredCardRows([
      { Word: 'lead', Translation: 'kim loại', Language: 'en', 'Part of Speech': 'noun', 'Sense Key': 'metal', 'Lexeme ID': createLexemeId({ language: 'en', normalizedLemma: 'lead', partOfSpeech: 'noun', senseKey: 'metal' }) },
      { Word: 'lead', Translation: 'dẫn dắt', Language: 'en', 'Part of Speech': 'verb', 'Sense Key': 'guide', 'Lexeme ID': createLexemeId({ language: 'en', normalizedLemma: 'lead', partOfSpeech: 'verb', senseKey: 'guide' }) },
    ]);
    expect(rows).toHaveLength(2);
  });

  it('round-trips exported cards under Vietnamese UI with stable spreadsheet headers', () => {
    const previousLocale = getActiveUiLocale();
    setActiveUiLocale('vi');
    try {
      const exported = cardsToSpreadsheetRows([{
        id: '1', word: 'apple', translation: 'táo', explanation: 'A fruit', phonetic: '/ˈæp.əl/', emoji: '🍎',
        category: 'Food', partOfSpeech: 'noun', audioUrl: null, imageUrl: null,
      }]);
      expect(Object.keys(exported[0])).toEqual([
        'Lexeme ID', 'Language', 'Sense Key', 'Normalized Lemma', 'Word', 'Translation',
        'Explanation', 'Phonetic', 'Part of Speech', 'Category', 'Emoji', 'Date Added',
      ]);
      expect(parseStructuredCardRows(exported)).toEqual([
        expect.objectContaining({
          word: 'apple', translation: 'táo', explanation: 'A fruit', phonetic: '/ˈæp.əl/',
          partOfSpeech: 'noun', category: 'Food', emoji: '🍎',
        }),
      ]);
    } finally {
      setActiveUiLocale(previousLocale);
    }
  });
});
