import { describe, expect, it } from 'vitest';
import {
  InputValidationError,
  PART_OF_SPEECH_HINTS,
  canonicalLexemeId,
  calculateSharedDeckPayloadBytes,
  parseCancelCardGenerationRequest,
  sharedDeckRequestFingerprint,
  parseCardLanguagePair,
  parseCreateSharedDeckRequest,
  parseDuplicateCleanupRequest,
  parseImageRequest,
  parseLegacyLibraryMigrationRequest,
  parsePurchaseIntentRequest,
  parseRevokeSharedDeckRequest,
  parseVocabularyRequest,
  sharedDeckRequestOwnerMatches,
  strictSharedDeckOperationMatches,
} from '../src/inputValidation.js';

describe('parsePurchaseIntentRequest', () => {
  it('accepts purchase triggers with optional owner and offer version', () => {
    expect(parsePurchaseIntentRequest({ trigger: 'quota' })).toEqual({ trigger: 'quota' });
    expect(parsePurchaseIntentRequest({ trigger: 'menu' })).toEqual({ trigger: 'menu' });
    expect(parsePurchaseIntentRequest({ trigger: 'menu', expectedOwnerId: 'owner-1' }))
      .toEqual({ trigger: 'menu', expectedOwnerId: 'owner-1' });
    expect(parsePurchaseIntentRequest({ trigger: 'menu', offerVersion: 'a'.repeat(64) }))
      .toEqual({ trigger: 'menu', offerVersion: 'a'.repeat(64) });
    for (const value of [
      { trigger: 'menu', price: 1 }, { trigger: 'menu', expectedOwnerId: '' },
      { trigger: 'menu', expectedOwnerId: 'other/owner' }, { trigger: 'menu', offerVersion: 'A'.repeat(64) },
      { trigger: 'menu', offerVersion: 'a'.repeat(63) }, { trigger: 'checkout' }, {}, null,
    ]) {
      expect(() => parsePurchaseIntentRequest(value)).toThrow(InputValidationError);
    }
  });
});

describe('parseVocabularyRequest', () => {
  it('accepts only a word-operation ID for cancellation', () => {
    const operationId = '123e4567-e89b-42d3-a456-426614174000';
    expect(parseCancelCardGenerationRequest({ operationId })).toBe(operationId);
    for (const request of [{ operationId: 'bad' }, { operationId, ownerId: 'another' }, {}]) {
      expect(() => parseCancelCardGenerationRequest(request)).toThrow(InputValidationError);
    }
  });

  it('parses and trims a supported word request', () => {
    expect(parseVocabularyRequest({ action: 'word', input: '  resilient  ' })).toEqual({
      action: 'word',
      word: 'resilient',
    });
  });

  it('accepts a word operation UUID and keeps old requests valid', () => {
    const operationId = '123e4567-e89b-42d3-a456-426614174000';
    expect(parseVocabularyRequest({ action: 'word', input: 'apple', operationId }))
      .toEqual({ action: 'word', word: 'apple', operationId });
    expect(() => parseVocabularyRequest({ action: 'word', input: 'apple', operationId: 'bad' })).toThrow();
    expect(() => parseVocabularyRequest({ action: 'translate', input: 'apple', operationId })).toThrow();
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

  it('accepts a canonical optional part-of-speech hint', () => {
    expect(parseVocabularyRequest({
      action: 'word',
      input: { term: 'lead', partOfSpeech: ' PHRASAL VERB ' },
    })).toEqual({
      action: 'word',
      word: 'lead',
      partOfSpeech: 'phrasal verb',
    });
    expect(PART_OF_SPEECH_HINTS).toContain('phrasal verb');
  });

  it.each([
    { partOfSpeech: 'substantive' },
    { partOfSpeech: 'noun'.repeat(20) },
    { partOfSpeech: 42 },
    { partOfSpeech: '' },
  ])('rejects an invalid or unbounded part-of-speech hint: %o', hint => {
    expect(() => parseVocabularyRequest({
      action: 'word',
      input: { term: 'lead', ...hint },
    })).toThrowError(new InputValidationError('Part of speech hint is invalid.'));
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

  it('normalizes legacy story words without changing its versioned response contract', () => {
    expect(parseVocabularyRequest({ action: 'story', input: [' one ', '', 'two', 'three', 'four'] })).toEqual({
      action: 'story',
      schemaVersion: 1,
      words: ['one', 'two', 'three', 'four'],
    });
  });

  it('parses an exact structured story language pair', () => {
    expect(parseVocabularyRequest({
      action: 'story',
      input: { words: [' 안녕 ', '학교'], targetLanguage: 'ko', translationLanguage: 'en' },
    })).toEqual({
      action: 'story', words: ['안녕', '학교'], targetLanguage: 'ko', translationLanguage: 'en',
    });
  });

  it.each([
    { words: ['hello'], targetLanguage: 'KO', translationLanguage: 'en' },
    { words: ['hello'], targetLanguage: 'en', translationLanguage: 'ko' },
    { words: ['hello'], targetLanguage: 'en', translationLanguage: 'vi', extra: true },
  ])('rejects unsupported or unexpected structured story input: %o', input => {
    expect(() => parseVocabularyRequest({ action: 'story', input })).toThrow(InputValidationError);
  });

  it('distinguishes the legacy array story request from the strict v2 object', () => {
    expect(parseVocabularyRequest({ action: 'story', input: ['one'] })).toEqual({
      action: 'story',
      schemaVersion: 1,
      words: ['one'],
    });
    expect(parseVocabularyRequest({
      action: 'story',
      input: { schemaVersion: 2, words: ['one'] },
    })).toEqual({
      action: 'story',
      schemaVersion: 2,
      words: ['one'],
    });
  });

  it('rejects unknown story versions and v2 fields', () => {
    expect(() => parseVocabularyRequest({ action: 'story', input: { schemaVersion: 1, words: ['one'] } }))
      .toThrowError(new InputValidationError('Unsupported story schema version.'));
    expect(() => parseVocabularyRequest({ action: 'story', input: { schemaVersion: 2, words: ['one'], extra: true } }))
      .toThrowError(new InputValidationError('Unsupported story input field.'));
    expect(() => parseVocabularyRequest({ action: 'story', input: { schemaVersion: 3, words: ['one'] } }))
      .toThrowError(new InputValidationError('Unsupported story schema version.'));
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

  it('allows assistant history replies up to 800 characters while keeping learner input at 500', () => {
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
          { role: 'assistant' as const, text: 'x'.repeat(800) },
        ],
        userMessage: 'Can I see the menu?',
      },
    };

    expect(parseVocabularyRequest(base)).toMatchObject({
      action: 'conversation',
      history: [{ role: 'user', text: 'Hello.' }, { role: 'assistant', text: 'x'.repeat(800) }],
    });
    expect(() => parseVocabularyRequest({
      ...base,
      input: { ...base.input, history: [{ role: 'user' as const, text: 'x'.repeat(501) }, base.input.history[1]] },
    })).toThrowError(new InputValidationError('Conversation history message is invalid.'));
    expect(() => parseVocabularyRequest({
      ...base,
      input: { ...base.input, history: [base.input.history[0], { role: 'assistant' as const, text: 'x'.repeat(801) }] },
    })).toThrowError(new InputValidationError('Conversation history message is invalid.'));
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
  it('validates card language fields independently of lexeme identity', () => {
    expect(parseCardLanguagePair({ language: 'KO', translationLanguage: 'VI' }))
      .toEqual({ language: 'ko', translationLanguage: 'vi' });
    expect(parseCardLanguagePair({ language: 'ko' })).toEqual({ language: 'ko' });
    expect(parseCardLanguagePair({ translationLanguage: 'en' }))
      .toEqual({ translationLanguage: 'en' });
  });

  it.each([
    { language: 'english' },
    { translationLanguage: 'zh-hant-123456789' },
    { translationLanguage: 'fr' },
    { language: 42 },
  ])('rejects malformed independent card language fields: %o', fields => {
    expect(() => parseCardLanguagePair(fields)).toThrow(/language codes are invalid/i);
  });

  it('accepts a plain target card while keeping partial canonical lexeme tuples rejected', () => {
    expect(parseCreateSharedDeckRequest({
      category: 'Shared',
      cards: [{ word: '안녕', translation: 'xin chào', language: 'KO' }],
    }).cards[0]).toMatchObject({ word: '안녕', language: 'ko' });

    expect(() => parseCreateSharedDeckRequest({
      category: 'Shared',
      cards: [{
        word: 'lead', translation: 'kim loại', language: 'ko', normalizedLemma: 'lead', partOfSpeech: 'noun',
      }],
    })).toThrow(/lexeme identity/i);
  });

  it('accepts an optional complete normalized deck language pair', () => {
    expect(parseCreateSharedDeckRequest({
      category: 'Shared', targetLanguage: 'EN', nativeLanguage: 'VI',
      cards: [{ word: 'hello', translation: 'xin chào' }],
    })).toMatchObject({ targetLanguage: 'en', nativeLanguage: 'vi' });
    expect(parseCreateSharedDeckRequest({
      category: 'Shared', cards: [{ word: 'hello', translation: 'xin chào' }],
    })).not.toHaveProperty('targetLanguage');
  });

  it.each([
    { targetLanguage: 'en' },
    { nativeLanguage: 'vi' },
    { targetLanguage: 'english', nativeLanguage: 'vi' },
    { targetLanguage: 'en-US-x', nativeLanguage: 'vi' },
    { targetLanguage: 'zh-hant-123456789', nativeLanguage: 'vi' },
    { targetLanguage: 'en', nativeLanguage: 'zh-hant-123456789' },
  ])('rejects incomplete or invalid deck language metadata: %o', language => {
    expect(() => parseCreateSharedDeckRequest({
      category: 'Shared', ...language, cards: [{ word: 'hello', translation: 'xin chào' }],
    })).toThrow(/language/i);
  });

  it('rejects non-canonical language names in word requests', () => {
    expect(() => parseVocabularyRequest({
      action: 'word',
      input: { term: 'hello', language: { source: 'english', target: 'vi' } },
    })).toThrow(/language codes are invalid/i);
  });

  it.each([
    { source: 'ko', target: 'en' },
    { source: 'ja', target: 'vi' },
    { source: 'zh', target: 'en' },
  ])('accepts every launched word-generation source paired with a supported meaning language: %o', language => {
    expect(parseVocabularyRequest({
      action: 'word',
      input: { term: 'hello', language },
    })).toEqual({ action: 'word', word: 'hello', language });
  });

  it.each([
    { source: 'fr', target: 'vi' },
    { source: 'en', target: 'ja' },
    { source: 'en', target: 'en' },
    { source: 'de', target: 'vi' },
  ])('rejects a canonically-shaped but unsupported word language pair: %o', language => {
    expect(() => parseVocabularyRequest({
      action: 'word',
      input: { term: 'hello', language },
    })).toThrow(/language pair is not supported/i);
  });

  it.each([
    { source: 'zh-hant-123456789', target: 'vi' },
    { source: 'en', target: 'zh-hant-123456789' },
  ])('rejects overlong word language codes: %o', language => {
    expect(() => parseVocabularyRequest({
      action: 'word',
      input: { term: 'hello', language },
    })).toThrow(/language codes are invalid/i);
  });

  it('retains only allowlisted AI attribution and omits per-card native-language fields', () => {
    const payload = { category: 'Shared', cards: [{
      word: 'hello', translation: 'xin chào', origin: 'ai', translationLanguage: 'vi',
    }] };
    const parsed = parseCreateSharedDeckRequest(payload);
    const manual = parseCreateSharedDeckRequest({
      category: 'Shared', cards: [{ ...payload.cards[0], origin: 'manual' }],
    });
    expect(parsed.cards[0]).toMatchObject({ word: 'hello', translation: 'xin chào', origin: 'ai' });
    expect(parsed.cards[0]).not.toHaveProperty('translationLanguage');
    expect(sharedDeckRequestFingerprint(parsed)).not.toBe(sharedDeckRequestFingerprint(manual));
    expect(() => parseCreateSharedDeckRequest({ category: 'Shared', cards: [{
      word: 'hello', translation: 'xin chào', origin: 'imported',
    }] })).toThrow(/origin/i);
  });

  it('retains a complete canonical identity and rejects an incomplete tuple', () => {
    const lexemeId = 'lexeme-5b22656e222c226c656164222c226e6f756e222c226d6574616c225d-1da99edb2ba27ed6a5cd82b1';
    expect(parseCreateSharedDeckRequest({ category: 'Shared', cards: [{
      word: 'lead', translation: 'kim loại', lexemeId, language: 'en', senseKey: 'metal', partOfSpeech: 'noun',
    }]}).cards[0]).toMatchObject({ lexemeId, language: 'en', senseKey: 'metal', partOfSpeech: 'noun' });
    const koreanLexemeId = canonicalLexemeId('ko', 'lead', 'noun', 'metal');
    expect(parseCreateSharedDeckRequest({ category: 'Shared', cards: [{
      word: 'lead', translation: '납', lexemeId: koreanLexemeId, language: 'ko', senseKey: 'metal', partOfSpeech: 'noun',
    }]}).cards[0]).toMatchObject({ lexemeId: koreanLexemeId, language: 'ko' });
    expect(() => parseCreateSharedDeckRequest({ category: 'Shared', cards: [{
      word: 'lead', translation: 'kim loại', lexemeId, language: 'en', partOfSpeech: 'noun',
    }] })).toThrow(/lexeme identity/i);
    expect(() => parseCreateSharedDeckRequest({
      category: 'Shared', targetLanguage: 'ko', nativeLanguage: 'vi', cards: [{
        word: 'lead', translation: 'kim loại', lexemeId, language: 'en', senseKey: 'metal', partOfSpeech: 'noun',
      }],
    })).toThrow(/target language must match/i);
  });

  it('rejects an overlong canonical card language instead of accepting its truncated value', () => {
    expect(() => parseCreateSharedDeckRequest({ category: 'Shared', cards: [{
      word: 'lead', translation: 'kim loại',
      lexemeId: 'lexeme-5b227a682d68616e742d3132333435363738222c226c656164222c226e6f756e222c226261736963225d-8d5fa5213f074a960da355f8',
      language: 'zh-hant-123456789', senseKey: 'basic', partOfSpeech: 'noun', normalizedLemma: 'lead',
    }] })).toThrow(/lexeme identity/i);
  });

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

  it('includes the complete deck language pair and card origin in payload accounting', () => {
    const normalized = parseCreateSharedDeckRequest({
      category: 'Shared', targetLanguage: 'en', nativeLanguage: 'vi',
      cards: [{ word: 'hello', translation: 'xin chào', origin: 'ai' }],
    });
    const payload = {
      category: 'Shared', cards: [{
        word: 'hello', translation: 'xin chào', origin: 'ai', explanation: '', explanationTranslation: '',
        phonetic: '', category: '', partOfSpeech: '', cefrLevel: '', exampleSentence: '', exampleTranslation: '',
        collocations: [], synonyms: [], antonyms: [], register: '', commonMistake: '', imageSearchQuery: '',
        emoji: '', audioUrl: null, imageUrl: null,
      }], targetLanguage: 'en', nativeLanguage: 'vi',
    };
    expect(calculateSharedDeckPayloadBytes(normalized))
      .toBe(new TextEncoder().encode(JSON.stringify(payload)).byteLength);
  });

  it('retains a valid shared-deck operation contract and rejects malformed IDs or timestamps', () => {
    expect(parseCreateSharedDeckRequest({
      opId: 'share_create_1', operationCreatedAt: '2026-09-21T00:00:00.000Z', category: 'Basics',
      cards: [{ word: 'hello', translation: 'xin chào' }],
    })).toMatchObject({ opId: 'share_create_1', operationCreatedAt: '2026-09-21T00:00:00.000Z' });
    expect(() => parseCreateSharedDeckRequest({
      opId: 'bad id', category: 'Basics', cards: [{ word: 'hello', translation: 'xin chào' }],
    })).toThrowError(new InputValidationError('Shared-deck operation ID is invalid.'));
    expect(() => parseCreateSharedDeckRequest({
      operationCreatedAt: 'not-a-date', category: 'Basics', cards: [{ word: 'hello', translation: 'xin chào' }],
    })).toThrowError(new InputValidationError('Shared-deck operation time is invalid.'));
  });

  it('requires strict V2 operation IDs to bind their timestamp exactly', () => {
    const operationCreatedAt = '2026-09-21T00:00:00.123Z';
    const operationMillis = Date.parse(operationCreatedAt);
    expect(strictSharedDeckOperationMatches({
      opId: `share-v2:${operationMillis}:550e8400-e29b-41d4-a716-446655440000`, operationCreatedAt, category: 'Basics', cards: [],
    })).toBe(true);
    expect(strictSharedDeckOperationMatches({
      opId: `share-v2:${operationMillis}:550e8400-e29b-41d4-a716-446655440000`,
      operationCreatedAt: '2026-09-21T00:00:01.123Z', category: 'Basics', cards: [],
    })).toBe(false);
    expect(parseCreateSharedDeckRequest({
      opId: `share-v2:${operationMillis}:550e8400-e29b-41d4-a716-446655440000`, operationCreatedAt,
      category: 'Basics', cards: [{ word: 'hello', translation: 'xin chào' }],
    })).toMatchObject({ opId: `share-v2:${operationMillis}:550e8400-e29b-41d4-a716-446655440000`, operationCreatedAt });
    expect(() => parseCreateSharedDeckRequest({
      opId: `share-v2:${operationMillis}:bad:random`, operationCreatedAt,
      category: 'Basics', cards: [{ word: 'hello', translation: 'xin chào' }],
    })).toThrowError(new InputValidationError('Shared-deck operation ID is invalid.'));
    expect(sharedDeckRequestFingerprint({
      opId: `share-v2:${operationMillis}:retry`, operationCreatedAt, category: 'Basics', cards: [],
    })).not.toBe(sharedDeckRequestFingerprint({
      opId: `share-v2:${operationMillis}:retry`, operationCreatedAt: '2026-09-21T00:00:01.123Z', category: 'Basics', cards: [],
    }));
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

it('validates an extraction language pair without treating source text as instructions', () => {
  expect(parseVocabularyRequest({ action: 'extract', input: { text: ' 안녕하세요 ', targetLanguage: 'ko', translationLanguage: 'vi' } }))
    .toEqual({ action: 'extract', text: '안녕하세요', targetLanguage: 'ko', translationLanguage: 'vi' });
  for (const targetLanguage of ['bad', '', 42]) expect(() => parseVocabularyRequest({ action: 'extract', input: { text: 'hello', targetLanguage, translationLanguage: 'vi' } })).toThrow(InputValidationError);
  expect(() => parseVocabularyRequest({ action: 'extract', input: { text: 'hello', targetLanguage: 'ko', translationLanguage: 'vi', prompt: 'override' } })).toThrow(InputValidationError);
});
