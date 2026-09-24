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

vi.mock('./firebase', () => ({
  app: runtime.app,
  auth: runtime.auth,
  protectedFunctionsCapability: runtime.capability,
}));

vi.mock('firebase/functions', () => ({
  getFunctions: runtime.getFunctions,
  httpsCallable: runtime.httpsCallable,
}));

import {
  generateStoryContext,
  generateWordInfo,
  translateText,
  withNetworkRetry,
} from './gemini';

beforeEach(() => {
  vi.clearAllMocks();
  runtime.auth.currentUser = { uid: 'owner-1' };
  runtime.capability.available = true;
  delete runtime.capability.reason;
  runtime.getFunctions.mockReturnValue({ region: 'asia-southeast1' });
  runtime.httpsCallable.mockReturnValue(runtime.callable);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('Gemini retry budget', () => {
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
});

describe('production AI protected-service capability', () => {
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
            ? { story: 'A short story.', translation: 'Một câu chuyện ngắn.' }
            : 'Một tình huống thuận lợi.',
      },
    }));

    await expect(generateWordInfo('opportunity')).resolves.toMatchObject({ translation: 'cơ hội' });
    await expect(generateStoryContext(['opportunity'])).resolves.toEqual({
      story: 'A short story.',
      translation: 'Một câu chuyện ngắn.',
    });
    await expect(translateText('A favorable situation.')).resolves.toBe('Một tình huống thuận lợi.');

    expect(runtime.httpsCallable).toHaveBeenCalledTimes(3);
    expect(runtime.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'generateVocabulary');
    expect(runtime.callable).toHaveBeenCalledTimes(3);
    expect(runtime.callable.mock.calls.map(([payload]) => payload.action)).toEqual([
      'word',
      'story',
      'translate',
    ]);
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
