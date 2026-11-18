import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  app: { kind: 'firebase-app' },
  auth: { currentUser: { uid: 'owner-1' } as { uid: string } | null },
  capability: { available: true } as {
    available: boolean;
    reason?: string;
  },
  getFunctions: vi.fn(),
  httpsCallable: vi.fn(),
  callable: vi.fn(),
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
};

vi.mock('./firebase', () => ({
  app: runtime.app,
  auth: runtime.auth,
  protectedFunctionsCapability: runtime.capability,
  getSonFlashFunctions: (app: unknown, region: string = 'asia-southeast1') => runtime.getFunctions(app, region),
}));

vi.mock('firebase/functions', () => ({
  getFunctions: runtime.getFunctions,
  httpsCallable: runtime.httpsCallable,
}));

import {
  askCardTutor,
  cancelWordInfoGeneration,
  askVocabularyTutor,
  extractVocabulary,
  generateDialogue,
  generateMnemonic,
  generateStoryContext,
  generateWordInfo,
  sendTextConversationTurn,
  translateText,
  withNetworkRetry,
} from './gemini';
import { ProtectedFunctionError } from './protectedFunctionsCapability';
import type {
  TextConversationMissionV1,
  TextConversationRequestV1,
} from '../features/conversation/textConversationModel';

const storyResult = {
  title: 'A short story',
  segments: [
    { english: 'A short scene begins.', vietnamese: 'Một cảnh ngắn bắt đầu.' },
    { english: 'The learner finds an opportunity.', vietnamese: 'Người học tìm thấy một cơ hội.' },
  ],
  comprehension: {
    question: 'What does the learner find?',
    options: ['An opportunity', 'A problem', 'A train'],
    correctIndex: 0 as const,
    explanationVi: 'Người học tìm thấy một cơ hội.',
  },
  grammar: {
    label: 'Past simple',
    explanationVi: 'Dùng thì quá khứ đơn.',
    sourceSentence: 'The learner finds an opportunity.',
    prompt: 'Rewrite the sentence in the past.',
    acceptedAnswer: 'The learner found an opportunity.',
  },
  retellPrompt: 'Retell the story in two sentences.',
  targetPhrases: ['opportunity'],
};

beforeEach(() => {
  vi.clearAllMocks();
  runtime.auth.currentUser = { uid: 'owner-1' };
  runtime.capability.available = true;
  delete runtime.capability.reason;
  runtime.getFunctions.mockReturnValue({ region: 'asia-southeast1' });
  runtime.httpsCallable.mockReturnValue(runtime.callable);
  Reflect.deleteProperty(runtime.callable, 'stream');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('Gemini retry budget', () => {
  it('does not retry a cancelled generation', async () => {
    const controller = new AbortController();
    const operation = vi.fn(async () => {
      controller.abort();
      throw new ProtectedFunctionError({
        message: 'cancelled', kind: 'network', code: 'cancelled', retryable: true,
      });
    });
    await expect(withNetworkRetry(operation, controller.signal)).rejects.toThrow('cancelled');
    expect(operation).toHaveBeenCalledOnce();
  });

  it('waits for one slow callable without duplicating the request', async () => {
    vi.useFakeTimers();
    const operation = vi.fn(() => new Promise<string>(resolve => {
      setTimeout(() => resolve('ready'), 25_000);
    }));
    const result = withNetworkRetry(operation);
    const settlement = expect(result).resolves.toBe('ready');

    await vi.runAllTimersAsync();

    await settlement;
    expect(operation).toHaveBeenCalledOnce();
  });

  it('stops retrying when the AI request never settles', async () => {
    vi.useFakeTimers();
    const operation = vi.fn(() => new Promise<string>(() => undefined));
    const result = withNetworkRetry(operation);
    const rejection = expect(result).rejects.toThrow('The AI service took too long to respond');

    await vi.runAllTimersAsync();

    await rejection;
    expect(operation).toHaveBeenCalledOnce();
  });

  it('stops polling in-flight work before the extension bridge deadline', async () => {
    vi.useFakeTimers();
    const operation = vi.fn(() => new Promise<string>((_, reject) => {
      setTimeout(() => reject(new ProtectedFunctionError({
        message: 'Still running', kind: 'network', code: 'unavailable',
        retryable: true, retryAfterMs: 5_000,
      })), 20_000);
    }));
    const result = withNetworkRetry(operation);
    const rejection = expect(result).rejects.toThrow('The AI service took too long to respond');

    await vi.advanceTimersByTimeAsync(130_500);
    await rejection;
    const callsAtDeadline = operation.mock.calls.length;
    await vi.runAllTimersAsync();
    expect(callsAtDeadline).toBeGreaterThan(1);
    expect(operation).toHaveBeenCalledTimes(callsAtDeadline);
  });
});

describe('production AI protected-service capability', () => {
  it('sends a bounded tutor conversation to its own callable once', async () => {
    const streamCall = vi.fn(async () => ({
      stream: (async function* () {})(),
      data: Promise.resolve({ answer: 'Một ví dụ ngắn.' }),
    }));
    Object.assign(runtime.callable, { stream: streamCall });
    const history = Array.from({ length: 5 }, (_, index) => ({ question: `q${index}`, answer: `a${index}` }));
    await expect(askCardTutor('word-123', 'Give an example', history)).resolves.toBe('Một ví dụ ngắn.');
    expect(runtime.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'askCardTutor');
    expect(streamCall).toHaveBeenCalledExactlyOnceWith({
      cardId: 'word-123', question: 'Give an example', history: history.slice(-3), expectedOwnerId: 'owner-1',
    });
    expect(runtime.callable).not.toHaveBeenCalled();
  });

  it('passes a cancellation signal to the tutor transport', async () => {
    const controller = new AbortController();
    const streamCall = vi.fn(async (_request: unknown, options?: { signal?: AbortSignal }) => ({
      stream: (async function* () {})(),
      data: new Promise<never>((_, reject) => options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })),
    }));
    Object.assign(runtime.callable, { stream: streamCall });

    const pending = askCardTutor('word-123', 'Give an example', [], controller.signal);
    await vi.waitFor(() => expect(streamCall).toHaveBeenCalledOnce());
    controller.abort(Object.assign(new Error('Request was cancelled.'), { code: 'cancelled' }));

    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    expect(streamCall).toHaveBeenCalledWith(expect.anything(), { signal: controller.signal });
  });

  it('rejects a missing or blank tutor answer instead of completing an empty turn', async () => {
    for (const answer of [undefined, null, 12, '  ']) {
      Object.assign(runtime.callable, {
        stream: vi.fn(async () => ({ stream: (async function* () {})(), data: Promise.resolve({ answer }) })),
      });
      await expect(askCardTutor('word-123', 'Give an example', []))
        .rejects.toThrow('AI tutor failed safely.');
    }
  });

  it('calls the owner-scoped cancellation endpoint', async () => {
    runtime.callable.mockResolvedValue({ data: { cancelled: true } });
    const operationId = '123e4567-e89b-42d3-a456-426614174000';
    await expect(cancelWordInfoGeneration(operationId, 'owner-1')).resolves.toBe(true);
    expect(runtime.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'cancelCardGeneration');
    expect(runtime.callable).toHaveBeenCalledWith({ operationId, expectedOwnerId: 'owner-1' });
  });

  it('does not cancel under a replacement account after its functions import resolves', async () => {
    const functions = deferred<unknown>();
    runtime.getFunctions.mockReturnValueOnce(functions.promise);
    const operationId = '123e4567-e89b-42d3-a456-426614174000';
    const pending = cancelWordInfoGeneration(operationId, 'owner-1');

    await vi.waitFor(() => expect(runtime.getFunctions).toHaveBeenCalledOnce());
    runtime.auth.currentUser = { uid: 'owner-2' };
    functions.resolve({ region: 'asia-southeast1' });

    await expect(pending).rejects.toThrow('AI generation failed safely.');
    expect(runtime.callable).not.toHaveBeenCalled();
  });

  it('forwards real callable stream fields for the current operation before the final card', async () => {
    const operationId = '123e4567-e89b-42d3-a456-426614174000';
    const streamCall = vi.fn(async () => ({
      stream: (async function* () {
        yield { operationId, stage: 'drafting' };
        yield { operationId: 'another-operation', stage: 'field', field: 'translation', value: 'wrong' };
        yield { operationId, stage: 'field', field: 'translation', value: 'táo' };
      })(),
      data: Promise.resolve({ result: {
        translation: 'táo', explanation: 'A fruit.', explanationTranslation: 'Một loại quả.',
        phonetic: '/ˈæpəl/', emoji: '🍎', category: 'Food',
      } }),
    }));
    Object.assign(runtime.callable, { stream: streamCall });
    const progress: unknown[] = [];
    const controller = new AbortController();

    await expect(generateWordInfo('apple', { operationId, signal: controller.signal, onProgress: value => progress.push(value) }))
      .resolves.toMatchObject({ translation: 'táo' });
    expect(progress).toEqual([
      { operationId, stage: 'drafting' },
      { operationId, stage: 'field', field: 'translation', value: 'táo' },
    ]);
    expect(streamCall).toHaveBeenCalledWith({
      action: 'word', input: 'apple', operationId, expectedOwnerId: 'owner-1',
    }, { signal: controller.signal });
    expect(runtime.callable).not.toHaveBeenCalled();
  });

  it('does not start a progressive request after its account changes during setup', async () => {
    const functions = deferred<unknown>();
    const streamCall = vi.fn(async () => ({
      stream: (async function* () {})(),
      data: Promise.resolve({ result: {
        translation: 'táo', explanation: 'A fruit.', explanationTranslation: 'Một loại quả.',
        phonetic: '/ˈæpəl/', emoji: '🍎', category: 'Food',
      } }),
    }));
    runtime.getFunctions.mockReturnValueOnce(functions.promise);
    Object.assign(runtime.callable, { stream: streamCall });

    const pending = generateWordInfo('apple', {
      operationId: '123e4567-e89b-42d3-a456-426614174000', onProgress: () => undefined,
    });
    await vi.waitFor(() => expect(runtime.getFunctions).toHaveBeenCalledOnce());
    runtime.auth.currentUser = { uid: 'owner-2' };
    functions.resolve({ region: 'asia-southeast1' });

    await expect(pending).rejects.toMatchObject({ kind: 'authentication', code: 'owner-mismatch' });
    expect(streamCall).not.toHaveBeenCalled();
  });

  it('reuses the operation ID when an in-flight word request is retried', async () => {
    const inFlight = Object.assign(new Error('still running'), {
      code: 'functions/unavailable', details: { reason: 'operation-in-flight', retryAfterMs: 100 },
    });
    runtime.callable.mockRejectedValueOnce(inFlight).mockRejectedValueOnce(inFlight).mockResolvedValueOnce({ data: { result: {
      translation: 'táo', explanation: 'A fruit.', explanationTranslation: 'Một loại quả.',
      phonetic: '/ˈæp.əl/', emoji: '🍎', category: 'Food', partOfSpeech: 'noun', cefrLevel: 'A1',
      exampleSentence: 'An apple.', exampleTranslation: 'Một quả táo.', collocations: [], synonyms: [],
      antonyms: [], register: '', commonMistake: '', imageSearchQuery: 'red apple fruit',
    } } });
    const pending = generateWordInfo('apple', { operationId: '123e4567-e89b-42d3-a456-426614174000' });
    await expect(pending).resolves.toMatchObject({ translation: 'táo' });
    expect(runtime.callable.mock.calls.map(([payload]) => payload.operationId)).toEqual([
      '123e4567-e89b-42d3-a456-426614174000', '123e4567-e89b-42d3-a456-426614174000',
      '123e4567-e89b-42d3-a456-426614174000',
    ]);
    expect(runtime.callable.mock.calls[0]?.[0].input).toBe('apple');
  });

  it('keeps legacy string requests bare and adds a POS hint only to structured input', async () => {
    runtime.callable.mockResolvedValue({ data: { result: {
      translation: 'dẫn đầu', explanation: 'To guide.', explanationTranslation: 'Dẫn dắt.', phonetic: '/liːd/',
      emoji: '🎭', category: 'General', partOfSpeech: 'verb', cefrLevel: 'B1',
      exampleSentence: 'She leads the team.', exampleTranslation: 'Cô ấy dẫn dắt đội.',
      collocations: [], synonyms: [], antonyms: [], register: 'neutral', commonMistake: '', imageSearchQuery: 'lead actor',
    } } });

    await generateWordInfo('lead', { operationId: '123e4567-e89b-42d3-a456-426614174000' });
    await generateWordInfo('lead', {
      operationId: '123e4567-e89b-42d3-a456-426614174001',
      partOfSpeech: 'verb',
    });
    await generateWordInfo('lead', {
      operationId: '123e4567-e89b-42d3-a456-426614174002',
      partOfSpeech: 'noun',
    });

    expect(runtime.callable.mock.calls[0]?.[0].input).toBe('lead');
    expect(runtime.callable.mock.calls[1]?.[0].input).toEqual({
      term: 'lead',
      language: { source: 'en', target: 'vi' },
      partOfSpeech: 'verb',
    });
    expect(runtime.callable.mock.calls[2]?.[0].input).toEqual({
      term: 'lead',
      language: { source: 'en', target: 'vi' },
      partOfSpeech: 'noun',
    });
    expect(runtime.callable.mock.calls[0]?.[0].input)
      .not.toEqual(runtime.callable.mock.calls[1]?.[0].input);
    expect(runtime.callable.mock.calls[1]?.[0].input)
      .not.toEqual(runtime.callable.mock.calls[2]?.[0].input);
  });

  it('sends bounded structured word context to the protected callable', async () => {
    runtime.callable.mockResolvedValue({ data: { result: {
      translation: 'dẫn đầu', explanation: 'To guide.', explanationTranslation: 'Dẫn dắt.', phonetic: '/liːd/',
      emoji: '🎭', category: 'General', partOfSpeech: 'verb', cefrLevel: 'B1',
      exampleSentence: 'She leads the team.', exampleTranslation: 'Cô ấy dẫn dắt đội.',
      collocations: [], synonyms: [], antonyms: [], register: 'neutral', commonMistake: '',
      imageSearchQuery: 'lead actor',
    } } });

    await generateWordInfo(' lead ', {
      context: ` The lead\n${'actor '.repeat(100)}arrived. `,
      sourceLanguage: 'EN',
      targetLanguage: 'VI',
    });

    expect(runtime.callable).toHaveBeenCalledWith({
      action: 'word',
      expectedOwnerId: 'owner-1',
      operationId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      input: {
        term: 'lead',
        language: { source: 'en', target: 'vi' },
        context: expect.stringContaining('The lead actor'),
      },
    });
  });

  it.each([true, false])('uses the protected callable for every action in %s builds', async isDev => {
    vi.stubEnv('DEV', isDev);
    const wordInfo = {
      translation: 'cơ hội',
      explanation: 'A favorable situation.',
      explanationTranslation: 'Một tình huống thuận lợi.',
      phonetic: '/ˌɑː.pəˈtʃuː.nə.ti/',
      emoji: '🌟',
      category: 'Opportunity',
      partOfSpeech: 'noun',
      cefrLevel: 'B1',
      exampleSentence: 'This is a good opportunity.',
      exampleTranslation: 'Đây là một cơ hội tốt.',
      collocations: ['great opportunity'],
      synonyms: ['chance'],
      antonyms: [],
      register: 'neutral',
      commonMistake: '',
      imageSearchQuery: 'open door opportunity',
    };
    runtime.callable.mockImplementation(async ({ action }: { action: string }) => ({
      data: {
        result: action === 'word'
          ? wordInfo
          : action === 'story'
            ? storyResult
            : 'Một tình huống thuận lợi.',
      },
    }));

    await expect(generateWordInfo('opportunity')).resolves.toMatchObject({ translation: 'cơ hội' });
    await expect(generateStoryContext(['opportunity'])).resolves.toEqual(storyResult);
    await expect(translateText('A favorable situation.')).resolves.toBe('Một tình huống thuận lợi.');

    expect(runtime.callable).toHaveBeenCalledWith(expect.objectContaining({
      action: 'story',
      input: { schemaVersion: 2, words: ['opportunity'] },
    }));

    expect(runtime.httpsCallable).toHaveBeenCalledTimes(3);
    expect(runtime.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'generateVocabulary');
    expect(runtime.callable).toHaveBeenCalledTimes(3);
    expect(runtime.callable.mock.calls.map(([payload]) => payload.action)).toEqual([
      'word',
      'story',
      'translate',
    ]);
  });

  it('sends the selected target and translation languages for structured story generation', async () => {
    runtime.callable.mockResolvedValue({
      data: { result: { story: '안녕하세요.', translation: 'Xin chào.' } },
    });

    await expect(generateStoryContext(['안녕'], { targetLanguage: 'ko', translationLanguage: 'vi' }))
      .resolves.toEqual({ story: '안녕하세요.', translation: 'Xin chào.' });

    expect(runtime.callable).toHaveBeenCalledWith({
      action: 'story',
      expectedOwnerId: 'owner-1',
      input: { words: ['안녕'], targetLanguage: 'ko', translationLanguage: 'vi' },
    });
  });
  it('uses dedicated bounded tutor and mnemonic actions', async () => {
    runtime.callable.mockImplementation(async ({ action }: { action: string }) => ({
      data: { result: action === 'tutor' ? '  Ask a question.  ' : '  Greet sounds like great.  ' },
    }));

    await expect(
      askVocabularyTutor({
        word: ' lead ',
        translation: ' lãnh đạo ',
        partOfSpeech: ' verb ',
        question: ' How is this used? ',
      }),
    ).resolves.toBe('Ask a question.');
    await expect(
      generateMnemonic({ word: 'greet', translation: 'chào', partOfSpeech: 'verb' }),
    ).resolves.toBe('Greet sounds like great.');

    expect(runtime.callable.mock.calls.map(([payload]) => payload)).toEqual([
      {
        action: 'tutor', expectedOwnerId: 'owner-1',
        input: {
          word: 'lead',
          translation: 'lãnh đạo',
          partOfSpeech: 'verb',
          question: 'How is this used?',
        },
      },
      {
        action: 'mnemonic', expectedOwnerId: 'owner-1',
        input: { word: 'greet', translation: 'chào', partOfSpeech: 'verb' },
      },
    ]);
  });

  it('uses dedicated extractor and dialogue actions with validated results', async () => {
    runtime.callable.mockImplementation(async ({ action }: { action: string }) => ({
      data: {
        result:
          action === 'extract'
            ? [
                {
                  word: 'resilient',
                  translation: 'bền bỉ',
                  partOfSpeech: 'adjective',
                  cefrLevel: 'B1',
                  example: 'She is resilient.',
                },
              ]
            : {
                title: 'At café',
                context: 'Two friends meet.',
                turns: [
                  { speaker: 'Alex', en: 'Hello.', vi: 'Xin chào.' },
                  { speaker: 'Sarah', en: 'Hi.', vi: 'Chào.' },
                  { speaker: 'Alex', en: 'Ready?', vi: 'Sẵn sàng?' },
                  { speaker: 'Sarah', en: 'Yes.', vi: 'Có.' },
                ],
              },
      },
    }));

    await expect(extractVocabulary(` ${'text '.repeat(600)} `)).resolves.toEqual([
      {
        word: 'resilient',
        translation: 'bền bỉ',
        partOfSpeech: 'adjective',
        cefrLevel: 'B1',
        example: 'She is resilient.',
      },
    ]);
    await expect(
      generateDialogue([
        { word: 'lead', translation: 'lãnh đạo' },
        { word: 'resilient', translation: 'bền bỉ' },
      ]),
    ).resolves.toMatchObject({ title: 'At café', turns: expect.any(Array) });

    expect(runtime.callable.mock.calls.map(([payload]) => payload)).toEqual([
      { action: 'extract', expectedOwnerId: 'owner-1', input: expect.stringMatching(/^text text/) },
      {
        action: 'dialogue', expectedOwnerId: 'owner-1',
        input: [
          { word: 'lead', translation: 'lãnh đạo' },
          { word: 'resilient', translation: 'bền bỉ' },
        ],
      },
    ]);
    expect((runtime.callable.mock.calls[0][0] as { input: string }).input.length).toBe(2_000);
  });

  it('bounds multilingual extraction and fences its captured owner', async () => {
    const extracted = [{ word: '문장', translation: 'câu', partOfSpeech: 'noun', cefrLevel: 'A1', example: '문장을 읽어요.' }];
    runtime.callable.mockResolvedValue({ data: { result: extracted } });
    const text = ' 문장 '.repeat(1000);
    await expect(extractVocabulary(text, { targetLanguage: 'ko', translationLanguage: 'vi' }, 'owner-1')).resolves.toEqual(extracted);
    expect(runtime.callable).toHaveBeenCalledWith({
      action: 'extract', expectedOwnerId: 'owner-1',
      input: { text: text.trim().slice(0, 2000), targetLanguage: 'ko', translationLanguage: 'vi' },
    });
    runtime.auth.currentUser = { uid: 'owner-2' };
    await expect(extractVocabulary(text, { targetLanguage: 'ko', translationLanguage: 'vi' }, 'owner-1'))
      .rejects.toMatchObject({ kind: 'authentication', code: 'owner-mismatch' });
    expect(runtime.callable).toHaveBeenCalledOnce();
  });

  it('rejects malformed structured AI responses', async () => {
    runtime.callable.mockResolvedValue({
      data: {
        result: { title: 'Too short', context: 'No turns', turns: [] },
      },
    });

    await expect(generateDialogue([{ word: 'lead', translation: 'lãnh đạo' }])).rejects.toThrow(
      'Invalid AI dialogue response',
    );
  });

  it('sends one bounded text conversation turn through the existing callable', async () => {
    runtime.callable.mockResolvedValue({ data: { result: {
      reply: 'The menu is right here.',
      translation: 'Thực đơn ở ngay đây.',
      correction: null,
      sessionComplete: false,
      nextPrompt: 'Ask for a recommendation.',
    } } });
    const mission: TextConversationMissionV1 = {
      schemaVersion: 1,
      id: 'cafe-mission',
      title: 'At the café',
      goal: 'Order a drink.',
      cards: [{ id: 'menu', word: 'menu', translation: 'thực đơn' }],
    };
    const request: TextConversationRequestV1 = {
      sessionId: 'session-1',
      mission,
      turn: 1,
      history: [],
      userMessage: 'Can I see the menu?',
    };

    await expect(sendTextConversationTurn(request)).resolves.toMatchObject({
      reply: 'The menu is right here.',
      sessionComplete: false,
    });
    expect(runtime.callable).toHaveBeenCalledWith({
      action: 'conversation', expectedOwnerId: 'owner-1',
      input: request,
    });
  });

  it('forces the transport completion flag on the sixth learner turn', async () => {
    runtime.callable.mockResolvedValue({ data: { result: {
      reply: 'That completes the mission.',
      correction: null,
      sessionComplete: false,
    } } });
    const request: TextConversationRequestV1 = {
      sessionId: 'session-1',
      mission: {
        schemaVersion: 1,
        id: 'cafe-mission',
        title: 'At the café',
        goal: 'Order a drink.',
        cards: [{ id: 'menu', word: 'menu', translation: 'thực đơn' }],
      },
      turn: 6,
      history: Array.from({ length: 10 }, (_, index) => ({
        role: (index % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
        text: `message-${index}`,
      })),
      userMessage: 'I will order the menu item now.',
    };

    await expect(sendTextConversationTurn(request)).resolves.toMatchObject({
      sessionComplete: true,
    });
  });

  it('rejects an oversized provider reply instead of truncating it', async () => {
    runtime.callable.mockResolvedValue({ data: { result: {
      reply: 'x'.repeat(801),
      sessionComplete: false,
    } } });
    const request: TextConversationRequestV1 = {
      sessionId: 'session-1',
      mission: {
        schemaVersion: 1,
        id: 'cafe-mission',
        title: 'At the café',
        goal: 'Order a drink.',
        cards: [{ id: 'menu', word: 'menu', translation: 'thực đơn' }],
      },
      turn: 1,
      history: [],
      userMessage: 'Can I see the menu?',
    };

    await expect(sendTextConversationTurn(request)).rejects.toThrow(
      'Invalid AI text conversation response',
    );
  });

  it('stops a conversation retry when the authenticated owner changes', async () => {
    runtime.callable.mockImplementationOnce(async () => {
      runtime.auth.currentUser = { uid: 'owner-2' };
      throw Object.assign(new Error('temporarily unavailable'), { code: 'functions/unavailable' });
    });
    const request: TextConversationRequestV1 = {
      sessionId: 'session-1',
      mission: {
        schemaVersion: 1,
        id: 'cafe-mission',
        title: 'At the café',
        goal: 'Order a drink.',
        cards: [{ id: 'menu', word: 'menu', translation: 'thực đơn' }],
      },
      turn: 1,
      history: [],
      userMessage: 'Can I see the menu?',
    };

    const result = sendTextConversationTurn(request, 'owner-1');
    await expect(result).rejects.toMatchObject({
      kind: 'authentication',
      code: 'owner-mismatch',
      retryable: false,
    });
    expect(runtime.callable).toHaveBeenCalledOnce();
  });

  it('rejects malformed plain-text AI responses', async () => {
    runtime.callable.mockResolvedValue({ data: { result: null } });

    await expect(
      askVocabularyTutor({ word: 'lead', translation: 'lãnh đạo', question: 'How?' }),
    ).rejects.toThrow('Invalid AI tutor response');
  });

  it('rejects empty extractor input before making a request', async () => {
    await expect(extractVocabulary('   ')).rejects.toThrow('Vocabulary text is required');
    expect(runtime.callable).not.toHaveBeenCalled();
  });

  it('rejects invalid dialogue cards before making a request', async () => {
    await expect(generateDialogue([{ word: 'lead', translation: '' }])).rejects.toThrow(
      'A vocabulary card requires word and translation',
    );
    expect(runtime.callable).not.toHaveBeenCalled();
  });

  it('rejects signed-out generation with a typed non-retryable authentication error', async () => {
    vi.stubEnv('DEV', false);
    runtime.auth.currentUser = null;

    await expect(generateWordInfo('opportunity')).rejects.toMatchObject({
      name: 'ProtectedFunctionError',
      kind: 'authentication',
      code: 'unauthenticated',
      retryable: false,
      message: 'AI generation needs a current sign-in. Sign in again, then retry.',
    });
    expect(runtime.getFunctions).not.toHaveBeenCalled();
    expect(runtime.httpsCallable).not.toHaveBeenCalled();
    expect(runtime.callable).not.toHaveBeenCalled();
  });

  it('fails before creating a callable when App Check is not configured', async () => {
    vi.stubEnv('DEV', false);
    runtime.capability.available = false;
    runtime.capability.reason = 'app-check-unconfigured';

    await expect(generateWordInfo('opportunity')).rejects.toThrow(
      'AI generation is unavailable because App Check is not configured for this build.',
    );
    expect(runtime.getFunctions).not.toHaveBeenCalled();
    expect(runtime.httpsCallable).not.toHaveBeenCalled();
  });

  it.each([
    ['Story generation', () => generateStoryContext(['opportunity'])],
    ['Translation', () => translateText('A favorable situation.')],
  ] as const)('guards %s with the same protected runtime capability', async (operation, invoke) => {
    vi.stubEnv('DEV', false);
    runtime.capability.available = false;
    runtime.capability.reason = 'app-check-unconfigured';

    await expect(invoke()).rejects.toThrow(
      `${operation} is unavailable because App Check is not configured for this build.`,
    );
    expect(runtime.getFunctions).not.toHaveBeenCalled();
  });

  it('returns a safe actionable message for a protected-service rejection', async () => {
    vi.stubEnv('DEV', false);
    runtime.callable.mockRejectedValue(Object.assign(
      new Error('backend secret: rules implementation detail'),
      { code: 'functions/permission-denied' },
    ));

    const rejection = expect(generateWordInfo('opportunity')).rejects;
    await rejection.toThrow('App Check or access rules need administrator attention.');
    await rejection.not.toThrow('backend secret');
    expect(runtime.callable).toHaveBeenCalledTimes(1);
  });
});
