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
import type {
  TextConversationMissionV1,
  TextConversationRequestV1,
} from '../features/conversation/textConversationModel';

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
        action: 'tutor',
        input: {
          word: 'lead',
          translation: 'lãnh đạo',
          partOfSpeech: 'verb',
          question: 'How is this used?',
        },
      },
      {
        action: 'mnemonic',
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
      { action: 'extract', input: expect.stringMatching(/^text text/) },
      {
        action: 'dialogue',
        input: [
          { word: 'lead', translation: 'lãnh đạo' },
          { word: 'resilient', translation: 'bền bỉ' },
        ],
      },
    ]);
    expect((runtime.callable.mock.calls[0][0] as { input: string }).input.length).toBe(2_000);
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
      action: 'conversation',
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
