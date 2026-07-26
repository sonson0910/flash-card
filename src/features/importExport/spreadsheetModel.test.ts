import { describe, expect, it } from 'vitest';
import { cardsToSpreadsheetRows, extractFlatWords, parseStructuredCardRows } from './spreadsheetModel';

describe('spreadsheet import/export model', () => {
  it('normalizes aliases, bounds text, rejects unsafe media and removes duplicates', () => {
    const rows = parseStructuredCardRows([
      { 'Từ vựng': '  Hello  ', Nghĩa: 'Xin chào', 'Từ loại': 'Modal-Verb', Image: 'javascript:alert(1)' },
      { Word: 'hello', Translation: 'duplicate' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ word: 'hello', translation: 'Xin chào', partOfSpeech: 'modal verb', imageUrl: null });
  });

  it('extracts a bounded unique flat word list and maps export rows', () => {
    expect(extractFlatWords([[' Apple ', 'apple'], ['Pear', 42]])).toEqual(['Apple', 'Pear']);
    expect(cardsToSpreadsheetRows([{
      id: '1', word: 'apple', translation: 'táo', explanation: '', phonetic: '', emoji: '🍎',
      category: 'Food', partOfSpeech: 'Noun', audioUrl: null, imageUrl: null,
    }])[0]).toMatchObject({ Word: 'apple', Translation: 'táo', 'Part of Speech': 'noun' });
  });
});
