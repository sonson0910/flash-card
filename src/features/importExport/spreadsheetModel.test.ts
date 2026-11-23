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

  it('imports a row whose photo is another learner\'s uploaded file without the photo', () => {
    const photo = (uid: string) => `https://firebasestorage.googleapis.com/v0/b/sonflash-staging-20260906.firebasestorage.app/o/users%2F${uid}%2Ffiles%2FAbCdEfGhIjKlMnOpQrSt?alt=media&token=0b0f1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d`;
    const [foreign, stock] = classifyStructuredCardRows([
      { row: { Word: 'apple', Translation: 'quả táo', Image: photo('other-learner') }, sourceRow: 2 },
      { row: { Word: 'pear', Translation: 'quả lê', Image: 'https://images.pexels.com/photos/1/pear.jpg' }, sourceRow: 3 },
    ]);
    expect(foreign).toMatchObject({ kind: 'accepted', row: { word: 'apple', imageUrl: null } });
    expect(stock).toMatchObject({ kind: 'accepted', row: { word: 'pear', imageUrl: 'https://images.pexels.com/photos/1/pear.jpg' } });
  });

  it('gives a row without language cells the active course pair', () => {
    const japanese = { language: 'ja', translationLanguage: 'vi' };
    const [plain, explicit, suppliedPair] = classifyStructuredCardRows([
      { row: { Word: '猫', Translation: 'mèo' }, sourceRow: 2 },
      { row: { Word: 'bank', Translation: 'ngân hàng', Language: 'ko', 'Translation Language': 'en' }, sourceRow: 3 },
      { row: { Word: '犬', Translation: 'chó', 'Translation Language': 'en' }, sourceRow: 4 },
    ], japanese);
    expect(plain).toMatchObject({ kind: 'accepted', row: { word: '猫', language: 'ja', translationLanguage: 'vi' } });
    expect(explicit).toMatchObject({ kind: 'accepted', row: { language: 'ko', translationLanguage: 'en' } });
    expect(suppliedPair).toMatchObject({ kind: 'accepted', row: { language: 'ja', translationLanguage: 'en' } });
  });

  it('keeps an English row without a language so the library files it under English as before', () => {
    const [row] = classifyStructuredCardRows(
      [{ row: { Word: 'cat', Translation: 'mèo' }, sourceRow: 2 }],
      { language: 'en', translationLanguage: 'vi' },
    );
    expect(row).toMatchObject({ kind: 'accepted', row: { word: 'cat', translationLanguage: 'vi' } });
    expect(row.kind === 'accepted' && row.row.language).toBeUndefined();
  });

  it('does not lend the course language to a row that carries a canonical identity', () => {
    const lexemeId = createLexemeId({ language: 'en', normalizedLemma: 'lead', partOfSpeech: 'noun', senseKey: 'metal' });
    const [row] = classifyStructuredCardRows([
      { row: { Word: 'lead', Translation: 'chì', 'Part of Speech': 'noun', 'Sense Key': 'metal', 'Lexeme ID': lexemeId }, sourceRow: 2 },
    ], { language: 'ja', translationLanguage: 'vi' });
    expect(row).toMatchObject({ kind: 'invalid' });
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

  it('round-trips an ordinary explicit language pair without treating it as canonical identity', () => {
    const [exported] = cardsToSpreadsheetRows([{
      id: 'hello', word: '안녕', translation: 'xin chào', explanation: '', phonetic: '', emoji: '📝',
      category: 'General', partOfSpeech: 'interjection', audioUrl: null, imageUrl: null,
      language: 'ko', translationLanguage: 'vi',
      source: { url: 'https://private.example/path', title: 'Private source' },
    }]);
    expect(exported).not.toHaveProperty('Source');
    const [row] = parseStructuredCardRows([exported]);
    expect(row).toMatchObject({ word: '안녕', language: 'ko', translationLanguage: 'vi' });
  });

  it('accepts language metadata alone but rejects unsafe values and partial canonical tuples', () => {
    const classifications = classifyStructuredCardRows([
      { row: { Word: 'hello', Translation: 'xin chào', Language: 'ko' }, sourceRow: 2 },
      { row: { Word: 'unsafe', Translation: 'không an toàn', Language: 'javascript:alert(1)' }, sourceRow: 3 },
      { row: { Word: 'partial', Translation: 'một phần', Language: 'ko', 'Sense Key': 'greeting' }, sourceRow: 4 },
      { row: { Word: 'native', Translation: 'meaning', 'Translation Language': 'de' }, sourceRow: 5 },
      { row: { Word: 'lemma', Translation: 'bổ đề', 'Normalized Lemma': 'lemma' }, sourceRow: 6 },
    ]);
    expect(classifications).toEqual([
      expect.objectContaining({ kind: 'accepted', row: expect.objectContaining({ language: 'ko' }) }),
      { kind: 'invalid', word: 'unsafe', sourceRow: 3 },
      { kind: 'invalid', word: 'partial', sourceRow: 4 },
      { kind: 'invalid', word: 'native', sourceRow: 5 },
      { kind: 'invalid', word: 'lemma', sourceRow: 6 },
    ]);
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
        'Lexeme ID', 'Language', 'Translation Language', 'Sense Key', 'Normalized Lemma', 'Word', 'Translation',
        'Explanation', 'Phonetic', 'Part of Speech', 'Category', 'Emoji',
        'Deck', 'Tags', 'Starred', 'Difficulty', 'CEFR Level', 'Date Added',
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

  it('exports deck, tags, star, difficulty and CEFR level and never the translation alternatives', () => {
    const [organised, plain] = cardsToSpreadsheetRows([{
      id: '1', word: 'levee', translation: 'đê', explanation: '', phonetic: '', emoji: '🌊',
      category: 'Nature', partOfSpeech: 'noun', audioUrl: null, imageUrl: null,
      customDeck: 'IELTS Reading', tags: ['flood', 'Unit 4', 'flood'], bookmarked: true,
      learnerDifficulty: 'hard', cefrLevel: 'C1', translationAlternatives: ['bờ đê', 'con đê'],
    }, {
      id: '2', word: 'river', translation: 'sông', explanation: '', phonetic: '', emoji: '🏞️',
      category: 'Nature', partOfSpeech: 'noun', audioUrl: null, imageUrl: null,
    }]);

    expect(organised).toMatchObject({
      Deck: 'IELTS Reading', Tags: 'flood; Unit 4', Starred: 'Yes', Difficulty: 'Hard', 'CEFR Level': 'C1',
    });
    expect(plain).toMatchObject({ Deck: '', Tags: '', Starred: '', Difficulty: '', 'CEFR Level': '' });
    expect(JSON.stringify(organised)).not.toMatch(/bờ đê|con đê|alternative/i);
    expect(parseStructuredCardRows([organised, plain])).toEqual([
      expect.objectContaining({
        word: 'levee', deck: 'IELTS Reading', tags: ['flood', 'Unit 4'], bookmarked: true,
        learnerDifficulty: 'hard', cefrLevel: 'C1',
      }),
      expect.not.objectContaining({ deck: expect.anything() }),
    ]);
    const [plainRow] = parseStructuredCardRows([plain]);
    expect(plainRow).not.toHaveProperty('tags');
    expect(plainRow).not.toHaveProperty('bookmarked');
    expect(plainRow).not.toHaveProperty('learnerDifficulty');
  });

  it('reads the organising columns leniently and ignores values it does not know', () => {
    const rows = parseStructuredCardRows([
      { Word: 'one', Translation: 'một', 'Bộ thẻ': '  Daily  ', 'Nhãn': 'a, b;  c  ;;', 'Đánh dấu sao': 'Có', 'Độ khó': 'Trung bình' },
      { Word: 'two', Translation: 'hai', Deck: '', Tags: 'x'.repeat(33), Starred: 'no', Difficulty: 'constructor' },
      { Word: 'three', Translation: 'ba', Starred: 'TRUE', Difficulty: 'EASY', Tags: 'a;b;c;d;e;f;g;h;i' },
      { Word: 'four', Translation: 'bốn', Difficulty: 'toString', Starred: 'hasOwnProperty' },
    ]);

    expect(rows[0]).toMatchObject({ deck: 'Daily', tags: ['a', 'b', 'c'], bookmarked: true, learnerDifficulty: 'medium' });
    for (const row of [rows[1], rows[3]]) {
      expect(row).not.toHaveProperty('deck');
      expect(row).not.toHaveProperty('tags');
      expect(row).not.toHaveProperty('bookmarked');
      expect(row).not.toHaveProperty('learnerDifficulty');
    }
    expect(rows[2]).toMatchObject({ bookmarked: true, learnerDifficulty: 'easy', tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] });
  });

  it('ignores a translation alternatives column on import', () => {
    const [row] = parseStructuredCardRows([
      { Word: 'bank', Translation: 'ngân hàng', 'Translation Alternatives': 'bờ sông', translationAlternatives: 'bờ' },
    ]);
    expect(row).not.toHaveProperty('translationAlternatives');
    expect(JSON.stringify(row)).not.toContain('bờ');
  });
});
