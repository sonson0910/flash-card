import { describe, expect, it } from 'vitest';
import {
  InputValidationError,
  parseCreateSharedDeckRequest,
  parseDuplicateCleanupRequest,
  parseImageRequest,
  parseRevokeSharedDeckRequest,
  parseVocabularyRequest,
} from '../src/inputValidation.js';

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

describe('shared deck validation', () => {
  it('keeps only the bounded public card projection', () => {
    expect(parseCreateSharedDeckRequest({
      category: ' Basics ',
      cards: [{
        word: ' hello ',
        translation: ' xin chào ',
        explanation: ' greeting ',
        audioUrl: null,
        imageUrl: 'https://images.pexels.com/photos/1/example.jpeg',
        privateNote: 'must never be persisted',
      }],
    })).toEqual({
      category: 'Basics',
      cards: [{
        word: 'hello',
        translation: 'xin chào',
        explanation: 'greeting',
        phonetic: '',
        category: '',
        partOfSpeech: '',
        emoji: '',
        audioUrl: null,
        imageUrl: 'https://images.pexels.com/photos/1/example.jpeg',
      }],
    });
  });

  it('rejects empty, oversized and untrusted shared-deck input', () => {
    expect(() => parseCreateSharedDeckRequest({ category: 'Basics', cards: [] }))
      .toThrowError(new InputValidationError('A shared deck must contain at least one card.'));
    expect(() => parseCreateSharedDeckRequest({
      category: 'Basics',
      cards: Array.from({ length: 101 }, () => ({ word: 'word', translation: 'nghĩa' })),
    })).toThrowError(new InputValidationError('A shared deck can contain at most 100 cards.'));
    expect(() => parseCreateSharedDeckRequest({
      category: 'Basics',
      cards: [{ word: 'word', translation: 'nghĩa', imageUrl: 'https://tracker.example/pixel.png' }],
    })).toThrowError(new InputValidationError('A shared card contains an untrusted image URL.'));
  });

  it('accepts only a bounded share id for revocation', () => {
    expect(parseRevokeSharedDeckRequest({ shareId: 'safe_share-id' }))
      .toEqual({ shareId: 'safe_share-id' });
    expect(() => parseRevokeSharedDeckRequest({ shareId: '../unsafe' }))
      .toThrowError(new InputValidationError('A valid share ID is required.'));
  });
});

describe('duplicate cleanup request validation', () => {
  it('defaults new jobs to dry-run and bounds chunk size', () => {
    expect(parseDuplicateCleanupRequest({ jobId: 'cleanup-2026' })).toEqual({
      action: 'run',
      jobId: 'cleanup-2026',
      dryRun: true,
      chunkSize: 50,
    });
    expect(parseDuplicateCleanupRequest({
      action: 'run',
      jobId: 'cleanup-2026',
      dryRun: false,
      chunkSize: 1000,
    }).chunkSize).toBe(100);
  });

  it('rejects unsafe job identifiers and actions', () => {
    expect(() => parseDuplicateCleanupRequest({ jobId: '../other-user' }))
      .toThrowError(new InputValidationError('A valid cleanup job ID is required.'));
    expect(() => parseDuplicateCleanupRequest({ action: 'delete', jobId: 'safe-job' }))
      .toThrowError(new InputValidationError('Unsupported duplicate cleanup action.'));
  });
});
