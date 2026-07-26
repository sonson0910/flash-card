import { describe, expect, it } from 'vitest';
import { InputValidationError, parseImageRequest, parseVocabularyRequest } from '../src/inputValidation.js';

describe('parseVocabularyRequest', () => {
  it('parses and trims a supported word request', () => {
    expect(parseVocabularyRequest({ action: 'word', input: '  resilient  ' })).toEqual({
      action: 'word',
      word: 'resilient',
    });
  });

  it('rejects a story array before mapping when it exceeds five items', () => {
    const oversized = ['one', 'two', 'three', 'four', 'five', {
      toString: () => {
        throw new Error('must not inspect the sixth item');
      },
    }];

    expect(() => parseVocabularyRequest({ action: 'story', input: oversized }))
      .toThrowError(new InputValidationError('A story can contain at most five words.'));
  });

  it('normalizes no more than five non-empty story words', () => {
    expect(parseVocabularyRequest({ action: 'story', input: [' one ', '', 'two', 'three', 'four'] })).toEqual({
      action: 'story',
      words: ['one', 'two', 'three', 'four'],
    });
  });

  it('rejects an unsupported action', () => {
    expect(() => parseVocabularyRequest({ action: 'delete', input: 'anything' }))
      .toThrowError(new InputValidationError('Unsupported AI action.'));
  });

  it('bounds translated text to 2048 characters', () => {
    const parsed = parseVocabularyRequest({ action: 'translate', input: ` ${'a'.repeat(3_000)} ` });

    expect(parsed).toEqual({ action: 'translate', text: 'a'.repeat(2_048) });
  });
});

describe('parseImageRequest', () => {
  it('uses the word as a fallback when the query is empty', () => {
    expect(parseImageRequest({ word: '  river ', query: '   ' })).toEqual({ word: 'river', query: 'river' });
  });

  it('rejects a missing word', () => {
    expect(() => parseImageRequest({ query: 'nature' }))
      .toThrowError(new InputValidationError('A word is required.'));
  });
});
