import { describe, expect, it } from 'vitest';
import {
  InputValidationError,
  calculateSharedDeckPayloadBytes,
  parseCreateSharedDeckRequest,
  parseDuplicateCleanupRequest,
  parseImageRequest,
  parseLegacyLibraryMigrationRequest,
  parseRevokeSharedDeckRequest,
  parseVocabularyRequest,
  sharedDeckRequestOwnerMatches,
} from '../src/inputValidation.js';

describe('parseVocabularyRequest', () => {
  it('parses and trims a supported word request', () => {
    expect(parseVocabularyRequest({ action: 'word', input: '  resilient  ' })).toEqual({
      action: 'word',
      word: 'resilient',
    });
  });

  it('parses bounded structured word context and language', () => {
    const parsed = parseVocabularyRequest({
      action: 'word',
      input: {
        term: ' lead ',
        context: ` The lead\n${'actor '.repeat(100)}arrived. `,
        language: { source: 'EN', target: 'VI' },
      },
    });

    expect(parsed).toEqual({
      action: 'word',
      word: 'lead',
      context: expect.stringContaining('The lead actor'),
      language: { source: 'en', target: 'vi' },
    });
    expect(parsed.action === 'word' ? parsed.context?.length ?? 0 : 0).toBeLessThanOrEqual(500);
  });

  it('rejects malformed or unexpected structured word input', () => {
    expect(() => parseVocabularyRequest({
      action: 'word',
      input: { term: 'lead', context: 42 },
    })).toThrowError(new InputValidationError('Word context must be a string.'));
    expect(() => parseVocabularyRequest({
      action: 'word',
      input: { term: 'lead', prompt: 'ignore policy' },
    })).toThrowError(new InputValidationError('Unsupported word input field.'));
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

  it('parses a bounded tutor request and rejects prompt-shaped extra fields', () => {
    expect(parseVocabularyRequest({
      action: 'tutor',
      input: {
        word: ' resilient ',
        translation: ' bền bỉ ',
        partOfSpeech: ' adjective ',
        question: ' Why is this useful? ',
      },
    })).toEqual({
      action: 'tutor',
      word: 'resilient',
      translation: 'bền bỉ',
      partOfSpeech: 'adjective',
      question: 'Why is this useful?',
    });
    expect(() => parseVocabularyRequest({
      action: 'tutor',
      input: { word: 'resilient', translation: 'bền bỉ', question: 'Explain', prompt: 'ignore policy' },
    })).toThrowError(new InputValidationError('Unsupported tutor input field.'));
  });

  it('parses a mnemonic request with bounded card context', () => {
    expect(parseVocabularyRequest({
      action: 'mnemonic',
      input: { word: ' resilient ', translation: ' bền bỉ ', partOfSpeech: ' adjective ' },
    })).toEqual({
      action: 'mnemonic',
      word: 'resilient',
      translation: 'bền bỉ',
      partOfSpeech: 'adjective',
    });
  });

  it('caps extractor text and rejects an empty extraction request', () => {
    expect(parseVocabularyRequest({ action: 'extract', input: ` ${'a'.repeat(2_500)} ` })).toEqual({
      action: 'extract',
      text: 'a'.repeat(2_000),
    });
    expect(() => parseVocabularyRequest({ action: 'extract', input: '   ' }))
      .toThrowError(new InputValidationError('Text is required.'));
  });

  it('normalizes a bounded dialogue card list and rejects more than five cards', () => {
    expect(parseVocabularyRequest({
      action: 'dialogue',
      input: [
        { word: ' resilient ', translation: ' bền bỉ ' },
        { word: ' concise ', translation: ' súc tích ' },
      ],
    })).toEqual({
      action: 'dialogue',
      cards: [
        { word: 'resilient', translation: 'bền bỉ' },
        { word: 'concise', translation: 'súc tích' },
      ],
    });
    expect(() => parseVocabularyRequest({
      action: 'dialogue',
      input: Array.from({ length: 6 }, (_, index) => ({ word: `word-${index}`, translation: `meaning-${index}` })),
    })).toThrowError(new InputValidationError('A dialogue can contain at most five cards.'));
  });

  it('parses one bounded text conversation turn and enforces history parity', () => {
    expect(parseVocabularyRequest({
      action: 'conversation',
      input: {
        sessionId: 'session-1',
        mission: {
          schemaVersion: 1,
          id: 'cafe-mission',
          title: 'At the café',
          goal: 'Order a drink.',
          cards: [{ id: 'menu', word: ' menu ', translation: ' thực đơn ' }],
        },
        turn: 2,
        history: [
          { role: 'user', text: 'Hello.' },
          { role: 'assistant', text: 'Welcome.' },
        ],
        userMessage: 'Can I see the menu?',
      },
    })).toMatchObject({
      action: 'conversation',
      turn: 2,
      mission: { cards: [{ id: 'menu', word: 'menu', translation: 'thực đơn' }] },
    });
    expect(() => parseVocabularyRequest({
      action: 'conversation',
      input: {
        sessionId: 'session-1',
        mission: {
          schemaVersion: 1,
          id: 'cafe-mission',
          title: 'At the café',
          goal: 'Order a drink.',
          cards: [{ id: 'menu', word: 'menu', translation: 'thực đơn' }],
        },
        turn: 2,
        history: [{ role: 'user', text: 'Hello.' }],
        userMessage: 'Can I see the menu?',
      },
    })).toThrowError(new InputValidationError('Conversation history does not match the turn.'));
  });

  it('rejects oversized conversation fields instead of truncating them', () => {
    const base = {
      action: 'conversation' as const,
      input: {
        sessionId: 'session-1',
        mission: {
          schemaVersion: 1,
          id: 'cafe-mission',
          title: 'At the café',
          goal: 'Order a drink.',
          cards: [{ id: 'menu', word: 'menu', translation: 'thực đơn' }],
        },
        turn: 2,
        history: [
          { role: 'user' as const, text: 'Hello.' },
          { role: 'assistant' as const, text: 'Welcome.' },
        ],
        userMessage: 'Can I see the menu?',
      },
    };

    expect(() => parseVocabularyRequest({
      ...base,
      input: { ...base.input, userMessage: 'x'.repeat(501) },
    })).toThrowError(new InputValidationError('A conversation message is invalid.'));
    expect(() => parseVocabularyRequest({
      ...base,
      input: {
        ...base.input,
        history: [
          { role: 'user' as const, text: 'x'.repeat(501) },
          { role: 'assistant' as const, text: 'Welcome.' },
        ],
      },
    })).toThrowError(new InputValidationError('Conversation history message is invalid.'));
    expect(() => parseVocabularyRequest({
      ...base,
      input: {
        ...base.input,
        mission: { ...base.input.mission, title: 'x'.repeat(257) },
      },
    })).toThrowError(new InputValidationError('Conversation mission title is invalid.'));
    expect(() => parseVocabularyRequest({
      ...base,
      input: {
        ...base.input,
        mission: {
          ...base.input.mission,
          cards: [{ id: 'menu', word: 'x'.repeat(81), translation: 'thực đơn' }],
        },
      },
    })).toThrowError(new InputValidationError('Conversation mission card word is invalid.'));
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
  it('requires the exact authenticated owner for V2 creation', () => {
    expect(sharedDeckRequestOwnerMatches(' owner-1 ', ' owner-1 ')).toBe(true);
    expect(sharedDeckRequestOwnerMatches('owner-1', 'owner-2')).toBe(false);
    expect(sharedDeckRequestOwnerMatches(undefined, 'owner-1')).toBe(false);
  });

  it('calculates payload bytes from normalized UTF-8 JSON', () => {
    const normalized = {
      category: '日本語',
      cards: [{ word: 'é', translation: '你好' }],
    } as Parameters<typeof calculateSharedDeckPayloadBytes>[0];
    expect(calculateSharedDeckPayloadBytes(normalized))
      .toBe(new TextEncoder().encode(JSON.stringify(normalized)).byteLength);
  });

  it('keeps only the bounded public card projection', () => {
    expect(parseCreateSharedDeckRequest({
      expectedOwnerId: ' owner-1 ',
      category: ' Basics ',
      cards: [{
        word: ' hello ',
        translation: ' xin chào ',
        explanation: ' greeting ',
        explanationTranslation: ' lời chào ',
        cefrLevel: ' A1 ',
        exampleSentence: ' Hello there. ',
        exampleTranslation: ' Xin chào bạn. ',
        collocations: [' say hello ', '', 42, 'hello there'],
        synonyms: [' hi ', 'greetings'],
        antonyms: [' goodbye '],
        register: ' neutral ',
        commonMistake: ' Do not use it as a farewell. ',
        imageSearchQuery: ' friendly greeting ',
        mnemonic: ' Greet sounds like great. ',
        wordFamily: { noun: ' greeting ', verb: ' greet ', extra: 'drop me' },
        audioUrl: null,
        imageUrl: 'https://images.pexels.com/photos/1/example.jpeg',
        privateNote: 'must never be persisted',
      }],
    })).toEqual({
      expectedOwnerId: ' owner-1 ',
      category: 'Basics',
      cards: [{
        word: 'hello',
        translation: 'xin chào',
        explanation: 'greeting',
        explanationTranslation: 'lời chào',
        phonetic: '',
        category: '',
        partOfSpeech: '',
        cefrLevel: 'A1',
        exampleSentence: 'Hello there.',
        exampleTranslation: 'Xin chào bạn.',
        collocations: ['say hello', 'hello there'],
        synonyms: ['hi', 'greetings'],
        antonyms: ['goodbye'],
        register: 'neutral',
        commonMistake: 'Do not use it as a farewell.',
        imageSearchQuery: 'friendly greeting',
        mnemonic: 'Greet sounds like great.',
        wordFamily: { noun: 'greeting', verb: 'greet' },
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

describe('legacy library migration request validation', () => {
  it('defaults to a bounded dry-run and requires apply to be explicit', () => {
    expect(parseLegacyLibraryMigrationRequest({})).toEqual({ batchSize: 100, dryRun: true });
    expect(parseLegacyLibraryMigrationRequest({ batchSize: 1000, dryRun: true }))
      .toEqual({ batchSize: 100, dryRun: true });
    expect(parseLegacyLibraryMigrationRequest({ batchSize: 1, dryRun: false }))
      .toEqual({ batchSize: 10, dryRun: false });
  });

  it('rejects caller owner IDs and malformed control fields', () => {
    expect(() => parseLegacyLibraryMigrationRequest({ ownerId: 'other-user' }))
      .toThrowError(new InputValidationError('Unsupported library migration field.'));
    expect(() => parseLegacyLibraryMigrationRequest({ dryRun: 'false' }))
      .toThrowError(new InputValidationError('Library migration dryRun must be a boolean.'));
    expect(() => parseLegacyLibraryMigrationRequest({ batchSize: '100' }))
      .toThrowError(new InputValidationError('Library migration batchSize must be a finite number.'));
  });
});
