import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PILOT_CONFIG_DEFAULTS } from '../src/pilotConfig.js';
import { AiQuotaError } from '../src/aiQuota.js';
import { RateLimitExceededError } from '../src/rateLimiter.js';
import { TutorCardNotFoundError } from '../src/cardTutor.js';

// The real generateVocabulary handler talks to Firestore (quota, budgets, the cost
// ledger) and to Gemini. Every one of those boundaries is mocked here so the handler's
// own branching -- replay of a completed operation, a request-hash conflict, a refund
// that must not swallow the original error, and a settle race -- can be exercised
// directly without an emulator and without ever calling the real model.
const reserveWordOperation = vi.fn();
const cancelWordOperation = vi.fn();
const settleWordOperation = vi.fn();
const reserveNonCardAction = vi.fn();
const refundNonCardAction = vi.fn();
const loadTutorCard = vi.fn();
const loadPilotConfig = vi.fn(async (..._args: unknown[]) => ({ ...PILOT_CONFIG_DEFAULTS }));
const isAccountDeleting = vi.fn(async (..._args: unknown[]) => false);
const consumePersistentRateLimit = vi.fn(async (..._args: unknown[]) => undefined);
const consumePersistentRateLimits = vi.fn(async (..._args: unknown[]) => undefined);
const runMeteredGemini = vi.fn();
const generateContent = vi.fn();
const generateContentStream = vi.fn();

vi.mock('../src/aiQuota.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/aiQuota.js')>(),
  reserveWordOperation: (...args: unknown[]) => reserveWordOperation(...args),
  cancelWordOperation: (...args: unknown[]) => cancelWordOperation(...args),
  settleWordOperation: (...args: unknown[]) => settleWordOperation(...args),
  reserveNonCardAction: (...args: unknown[]) => reserveNonCardAction(...args),
  refundNonCardAction: (...args: unknown[]) => refundNonCardAction(...args),
}));
vi.mock('../src/cardTutor.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/cardTutor.js')>(),
  loadTutorCard: (...args: unknown[]) => loadTutorCard(...args),
}));
vi.mock('../src/pilotConfig.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/pilotConfig.js')>(),
  loadPilotConfig: (...args: unknown[]) => loadPilotConfig(...args),
}));
vi.mock('../src/accountData.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/accountData.js')>(),
  isAccountDeleting: (...args: unknown[]) => isAccountDeleting(...args),
}));
vi.mock('../src/rateLimiter.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/rateLimiter.js')>(),
  consumePersistentRateLimit: (...args: unknown[]) => consumePersistentRateLimit(...args),
  consumePersistentRateLimits: (...args: unknown[]) => consumePersistentRateLimits(...args),
}));
vi.mock('../src/aiCostLedger.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/aiCostLedger.js')>(),
  runMeteredGemini: (...args: unknown[]) => runMeteredGemini(...args),
}));
vi.mock('@google/genai', async importOriginal => {
  const actual = await importOriginal<typeof import('@google/genai')>();
  return {
    ...actual,
    GoogleGenAI: class {
      models = {
        generateContent: (...args: unknown[]) => generateContent(...args),
        generateContentStream: (...args: unknown[]) => generateContentStream(...args),
      };
    },
  };
});

const FAKE_WORD_RESPONSE = { text: JSON.stringify({
  translation: 'quả táo', explanation: 'a fruit', explanationTranslation: 'một loại quả',
  phonetic: '/ˈæpəl/', emoji: '🍎', category: 'food',
}) };

const previousEnv = { ...process.env };

describe('generateVocabulary callable', () => {
  beforeEach(() => {
    process.env.ANALYTICS_PSEUDONYM_KEY = 'x'.repeat(32);
    process.env.GEMINI_API_KEY = 'test-key';
    reserveWordOperation.mockReset();
    cancelWordOperation.mockReset();
    settleWordOperation.mockReset();
    reserveNonCardAction.mockReset().mockResolvedValue('2026-09-30');
    refundNonCardAction.mockReset().mockResolvedValue(undefined);
    loadTutorCard.mockReset().mockResolvedValue({
      word: 'record', meaning: 'ghi lại', sourceLanguage: 'en', meaningLanguage: 'vi',
      partOfSpeech: 'verb', explanation: '', example: '', synonyms: [], collocations: [],
    });
    loadPilotConfig.mockReset().mockResolvedValue({ ...PILOT_CONFIG_DEFAULTS });
    isAccountDeleting.mockReset().mockResolvedValue(false);
    consumePersistentRateLimit.mockReset().mockResolvedValue(undefined);
    consumePersistentRateLimits.mockReset().mockResolvedValue(undefined);
    generateContent.mockReset();
    generateContentStream.mockReset();
    runMeteredGemini.mockReset().mockImplementation(async ({ parse }: { parse: (response: unknown) => unknown }) =>
      parse(FAKE_WORD_RESPONSE));
  });
  afterEach(() => {
    process.env = { ...previousEnv };
    vi.clearAllMocks();
  });

  const nonCardRequests = [
    { action: 'story', input: ['apple'] },
    { action: 'story', input: { schemaVersion: 2, words: ['apple'] } },
    { action: 'story', input: { words: ['안녕'], targetLanguage: 'ko', translationLanguage: 'en' } },
    { action: 'translate', input: 'apple' },
    { action: 'tutor', input: { word: 'apple', translation: 'táo', question: 'An example?' } },
    { action: 'mnemonic', input: { word: 'apple', translation: 'táo' } },
    { action: 'extract', input: 'An apple grows on a tree.' },
    { action: 'dialogue', input: [{ word: 'apple', translation: 'táo' }] },
    { action: 'conversation', input: {
      sessionId: 'session-1', turn: 1, history: [], userMessage: 'One apple, please.',
      mission: { schemaVersion: 1, id: 'market', title: 'Market', goal: 'Buy fruit',
        cards: [{ id: 'apple', word: 'apple', translation: 'táo' }] },
    } },
  ];

  it.each(nonCardRequests)('denies $action before model spend when the daily allowance is exhausted', async data => {
    loadPilotConfig.mockResolvedValue({ ...PILOT_CONFIG_DEFAULTS, analyticsEnabled: false });
    reserveNonCardAction.mockRejectedValue(new AiQuotaError('ai-daily-allowance', {}));
    const { generateVocabulary } = await import('../src/index.js');
    await expect(generateVocabulary.run({ auth: { uid: 'owner-1' }, data } as never))
      .rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(reserveNonCardAction).toHaveBeenCalledTimes(1);
    expect(runMeteredGemini).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it.each(nonCardRequests)('meters $action and refunds its allowance when generation fails', async data => {
    const failure = new Error('provider unavailable');
    runMeteredGemini.mockRejectedValue(failure);
    const { generateVocabulary } = await import('../src/index.js');
    await expect(generateVocabulary.run({ auth: { uid: 'owner-1' }, data } as never)).rejects.toBe(failure);
    expect(runMeteredGemini).toHaveBeenCalledWith(expect.objectContaining({ action: data.action, uid: 'owner-1' }));
    expect(refundNonCardAction).toHaveBeenCalledWith(expect.anything(), 'owner-1', '2026-09-30');
  });

  it('cancels only the authenticated owner operation with a validated ID', async () => {
    cancelWordOperation.mockResolvedValue(true);
    const { cancelCardGeneration } = await import('../src/index.js');
    const operationId = randomUUID();
    await expect(cancelCardGeneration.run({ auth: { uid: 'owner-1' }, data: { operationId } } as never))
      .resolves.toEqual({ cancelled: true });
    expect(cancelWordOperation).toHaveBeenCalledWith(expect.anything(), 'owner-1', operationId, expect.any(Date));
    await expect(cancelCardGeneration.run({ auth: { uid: 'owner-1' }, data: { operationId: 'bad' } } as never))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    expect(cancelWordOperation).toHaveBeenCalledTimes(1);
  });

  it('rejects AI requests captured under a different account before spending quota', async () => {
    const { generateVocabulary, cancelCardGeneration, askCardTutor } = await import('../src/index.js');
    await expect(generateVocabulary.run({ auth: { uid: 'owner-b' }, data: {
      action: 'word', input: 'apple', expectedOwnerId: 'owner-a',
    } } as never)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(cancelCardGeneration.run({ auth: { uid: 'owner-b' }, data: {
      operationId: randomUUID(), expectedOwnerId: 'owner-a',
    } } as never)).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(askCardTutor.run({ auth: { uid: 'owner-b' }, data: {
      cardId: 'word-123', question: 'Explain it', expectedOwnerId: 'owner-a',
    } } as never)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(reserveWordOperation).not.toHaveBeenCalled();
    expect(cancelWordOperation).not.toHaveBeenCalled();
    expect(loadTutorCard).not.toHaveBeenCalled();
    expect(consumePersistentRateLimit).not.toHaveBeenCalled();
  });

  it('rejects weekly email opt-in while the delivery transport is disabled', async () => {
    const { updateReminderSettings } = await import('../src/index.js');
    await expect(updateReminderSettings.run({ auth: { uid: 'owner-1' }, data: {
      expectedOwnerId: 'owner-1', locale: 'en', timezone: 'Asia/Ho_Chi_Minh',
      days: [0], sendAtLocal: '09:00', quietHours: null, onlyIfNotStudiedToday: true,
      channels: { push: false, emailDigest: true },
    } } as never)).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('uses the authenticated owner card and non-card quota for a bounded tutor turn', async () => {
    runMeteredGemini.mockImplementation(async ({ parse }: { parse: (response: unknown) => unknown }) =>
      parse({ text: 'Dùng “record” khi ghi lại thông tin.' }));
    const { askCardTutor } = await import('../src/index.js');
    await expect(askCardTutor.run({ auth: { uid: 'owner-1' }, data: {
      cardId: 'word-123', question: 'Give an example', history: [],
    } } as never)).resolves.toEqual({ answer: 'Dùng “record” khi ghi lại thông tin.' });
    expect(loadTutorCard).toHaveBeenCalledWith(expect.anything(), 'owner-1', 'word-123');
    expect(reserveNonCardAction).toHaveBeenCalledWith(expect.anything(), 'owner-1', expect.any(Date), expect.anything());
    expect(reserveWordOperation).not.toHaveBeenCalled();
    expect(refundNonCardAction).not.toHaveBeenCalled();
    expect(runMeteredGemini).toHaveBeenCalledWith(expect.objectContaining({ action: 'tutor' }));
    const request = JSON.parse(runMeteredGemini.mock.calls[0][0].contents);
    expect(request.contents).toContain('Give an example');
    expect(request.contents).toContain('"meaningLanguage":"vi"');
  });

  it('blocks emulator AI network access before constructing a model request', async () => {
    process.env.GEMINI_API_KEY = 'disabled-in-e2e-emulator';
    const { askCardTutor } = await import('../src/index.js');
    await expect(askCardTutor.run({ auth: { uid: 'owner-1' }, data: {
      cardId: 'word-123', question: 'Give an example', history: [],
    } } as never)).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(runMeteredGemini).not.toHaveBeenCalled();
    expect(refundNonCardAction).toHaveBeenCalledWith(expect.anything(), 'owner-1', '2026-09-30');
  });

  it('rejects oversized tutor input before card access or model spend', async () => {
    const { askCardTutor } = await import('../src/index.js');
    await expect(askCardTutor.run({ auth: { uid: 'owner-1' }, data: {
      cardId: 'word-123', question: 'x'.repeat(301),
    } } as never)).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(loadTutorCard).not.toHaveBeenCalled();
    expect(reserveNonCardAction).not.toHaveBeenCalled();
    expect(runMeteredGemini).not.toHaveBeenCalled();
  });

  it('does not spend the shared Gemini budget for a missing tutor card', async () => {
    loadTutorCard.mockRejectedValue(new TutorCardNotFoundError());
    const { askCardTutor } = await import('../src/index.js');
    await expect(askCardTutor.run({ auth: { uid: 'owner-1' }, data: {
      cardId: 'missing-card', question: 'Explain it',
    } } as never)).rejects.toMatchObject({ code: 'not-found' });
    expect(reserveNonCardAction).not.toHaveBeenCalled();
    expect(consumePersistentRateLimits).not.toHaveBeenCalled();
    expect(runMeteredGemini).not.toHaveBeenCalled();
  });

  it('does not spend the shared Gemini budget after daily quota rejection', async () => {
    loadPilotConfig.mockResolvedValue({ ...PILOT_CONFIG_DEFAULTS, analyticsEnabled: false });
    reserveNonCardAction.mockRejectedValue(new AiQuotaError('ai-daily-allowance', {}));
    const { askCardTutor } = await import('../src/index.js');
    await expect(askCardTutor.run({ auth: { uid: 'owner-1' }, data: {
      cardId: 'word-123', question: 'Explain it',
    } } as never)).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(consumePersistentRateLimits).not.toHaveBeenCalled();
    expect(runMeteredGemini).not.toHaveBeenCalled();
  });

  it('refunds daily quota when the shared Gemini budget rejects a tutor turn', async () => {
    consumePersistentRateLimits.mockRejectedValue(new RateLimitExceededError(1_000));
    const { askCardTutor } = await import('../src/index.js');
    await expect(askCardTutor.run({ auth: { uid: 'owner-1' }, data: {
      cardId: 'word-123', question: 'Explain it',
    } } as never)).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(refundNonCardAction).toHaveBeenCalledWith(expect.anything(), 'owner-1', '2026-09-30');
    expect(runMeteredGemini).not.toHaveBeenCalled();
  });

  it('refunds the tutor allowance if model generation fails', async () => {
    runMeteredGemini.mockRejectedValue(new Error('provider failed'));
    const { askCardTutor } = await import('../src/index.js');
    await expect(askCardTutor.run({ auth: { uid: 'owner-1' }, data: {
      cardId: 'word-123', question: 'Explain it',
    } } as never)).rejects.toThrow('provider failed');
    expect(refundNonCardAction).toHaveBeenCalledWith(expect.anything(), 'owner-1', '2026-09-30');
  });

  it('aborts the tutor provider request and refunds when the client disconnects', async () => {
    let providerSignal: AbortSignal | undefined;
    let providerStarted!: () => void;
    const started = new Promise<void>(resolve => { providerStarted = resolve; });
    generateContent.mockImplementation(({ config }: { config: { abortSignal: AbortSignal } }) => {
      providerSignal = config.abortSignal;
      providerStarted();
      return new Promise((_, reject) => config.abortSignal.addEventListener('abort', () => reject(config.abortSignal.reason), { once: true }));
    });
    runMeteredGemini.mockImplementation(async (options: {
      generate: (signal: AbortSignal) => Promise<unknown>;
      parse: (response: unknown) => unknown;
    }) => options.parse(await options.generate(new AbortController().signal)));
    const { askCardTutor } = await import('../src/index.js');
    const client = new AbortController();
    const pending = (askCardTutor.run as unknown as (request: unknown, response: unknown) => Promise<unknown>)({
      auth: { uid: 'owner-1' }, data: { cardId: 'word-123', question: 'Explain it' },
    }, { signal: client.signal });
    await started;
    client.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(providerSignal?.aborted).toBe(true);
    expect(refundNonCardAction).toHaveBeenCalledWith(expect.anything(), 'owner-1', '2026-09-30');
  });

  it('replays a completed operation without spending the Gemini budget or calling the model again', async () => {
    reserveWordOperation.mockResolvedValue({ kind: 'completed', result: { translation: 'cached' } });
    const { generateVocabulary } = await import('../src/index.js');
    const response = await generateVocabulary.run({
      auth: { uid: 'owner-1' }, data: { action: 'word', input: 'apple', operationId: randomUUID() },
    } as never);
    expect(response).toEqual({ result: { translation: 'cached' } });
    expect(consumePersistentRateLimit).not.toHaveBeenCalled();
    expect(consumePersistentRateLimits).not.toHaveBeenCalled();
    expect(runMeteredGemini).not.toHaveBeenCalled();
    expect(settleWordOperation).not.toHaveBeenCalled();
  });

  it('uses the structured story languages in the Gemini prompt', async () => {
    const { generateVocabulary } = await import('../src/index.js');
    await expect(generateVocabulary.run({ auth: { uid: 'owner-1' }, data: {
      action: 'story', input: { words: ['안녕'], targetLanguage: 'ko', translationLanguage: 'en' },
    } } as never)).resolves.toEqual({ result: expect.any(Object) });
    const request = JSON.parse(runMeteredGemini.mock.calls[0][0].contents);
    expect(request.contents).toContain('Korean story');
    expect(request.contents).toContain('English translation');
  });

  it('sends a completion event when a streaming client replays a finished operation', async () => {
    reserveWordOperation.mockResolvedValue({ kind: 'completed', result: { translation: 'cached' } });
    const sendChunk = vi.fn(async () => true);
    const { generateVocabulary } = await import('../src/index.js');
    const runWithStream = generateVocabulary.run as unknown as
      (request: unknown, response: unknown) => Promise<unknown>;
    const operationId = randomUUID();
    await expect(runWithStream({
      auth: { uid: 'owner-1' }, acceptsStreaming: true,
      data: { action: 'word', input: 'apple', operationId },
    }, { sendChunk, signal: new AbortController().signal }))
      .resolves.toEqual({ result: { translation: 'cached' } });
    expect(sendChunk).toHaveBeenCalledWith({ operationId, stage: 'done', result: { translation: 'cached' } });
    expect(runMeteredGemini).not.toHaveBeenCalled();
  });

  it('refunds a reservation if the streaming client disconnects before Gemini starts', async () => {
    reserveWordOperation.mockResolvedValue({ kind: 'reserved', attemptId: 'attempt-1', periodKey: 'free-2026-09' });
    settleWordOperation.mockResolvedValue(true);
    const sendChunk = vi.fn().mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('disconnected'));
    const { generateVocabulary } = await import('../src/index.js');
    const runWithStream = generateVocabulary.run as unknown as
      (request: unknown, response: unknown) => Promise<unknown>;
    const operationId = randomUUID();
    await expect(runWithStream({
      auth: { uid: 'owner-1' }, acceptsStreaming: true,
      data: { action: 'word', input: 'apple', operationId },
    }, { sendChunk, signal: new AbortController().signal })).rejects.toThrow('disconnected');
    expect(settleWordOperation).toHaveBeenCalledWith(
      expect.anything(), 'owner-1', operationId, 'attempt-1', null, expect.any(Date),
    );
    expect(runMeteredGemini).not.toHaveBeenCalled();
  });

  it('aborts the word-stream provider and refunds when the client disconnects after it starts', async () => {
    reserveWordOperation.mockResolvedValue({ kind: 'reserved', attemptId: 'attempt-1', periodKey: 'free-2026-09' });
    settleWordOperation.mockResolvedValue(true);
    let providerSignal: AbortSignal | undefined;
    let providerStarted!: () => void;
    const started = new Promise<void>(resolve => { providerStarted = resolve; });
    generateContentStream.mockImplementation(({ config }: { config: { abortSignal: AbortSignal } }) => {
      providerSignal = config.abortSignal;
      providerStarted();
      return {
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise((_, reject) => {
            if (config.abortSignal.aborted) {
              reject(config.abortSignal.reason);
              return;
            }
            config.abortSignal.addEventListener('abort', () => reject(config.abortSignal.reason), { once: true });
          }),
        }),
      };
    });
    runMeteredGemini.mockImplementation(async (options: {
      generate: (signal: AbortSignal) => Promise<unknown>;
      parse: (response: unknown) => unknown;
    }) => options.parse(await options.generate(new AbortController().signal)));
    const { generateVocabulary } = await import('../src/index.js');
    const client = new AbortController();
    const operationId = randomUUID();
    const pending = (generateVocabulary.run as unknown as (request: unknown, response: unknown) => Promise<unknown>)({
      auth: { uid: 'owner-1' }, acceptsStreaming: true,
      data: { action: 'word', input: 'apple', operationId },
    }, { sendChunk: vi.fn(), signal: client.signal });
    await started;
    client.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(providerSignal?.aborted).toBe(true);
    expect(settleWordOperation).toHaveBeenCalledWith(
      expect.anything(), 'owner-1', operationId, 'attempt-1', null, expect.any(Date),
    );
  });

  it('maps a request-hash conflict to failed-precondition instead of an internal error', async () => {
    reserveWordOperation.mockRejectedValue(
      new AiQuotaError('operation-request-mismatch', { reason: 'operation-request-mismatch' }),
    );
    const { generateVocabulary } = await import('../src/index.js');
    await expect(generateVocabulary.run({
      auth: { uid: 'owner-1' }, data: { action: 'word', input: 'apple', operationId: randomUUID() },
    } as never)).rejects.toMatchObject({
      code: 'failed-precondition', details: { reason: 'operation-request-mismatch' },
    });
    expect(runMeteredGemini).not.toHaveBeenCalled();
  });

  it('binds part of speech to the operation fingerprint and generation prompt', async () => {
    reserveWordOperation.mockResolvedValue({ kind: 'reserved', attemptId: 'attempt-1', periodKey: 'free-2026-09' });
    // Avoid analytics here; the settle conflict returns only after prompt creation.
    settleWordOperation.mockResolvedValue(false);
    const { generateVocabulary } = await import('../src/index.js');
    const operationId = randomUUID();
    for (const partOfSpeech of ['noun', 'verb']) {
      await expect(generateVocabulary.run({
        auth: { uid: 'owner-1' },
        data: { action: 'word', input: { term: 'record', partOfSpeech }, operationId },
      } as never)).rejects.toMatchObject({ code: 'unavailable' });
    }
    expect(reserveWordOperation.mock.calls[0][2]).toBe(operationId);
    expect(reserveWordOperation.mock.calls[1][2]).toBe(operationId);
    expect(reserveWordOperation.mock.calls[0][3]).not.toBe(reserveWordOperation.mock.calls[1][3]);
    const request = JSON.parse(runMeteredGemini.mock.calls[1][0].contents);
    expect(request.contents).toContain('requested part of speech "verb"');
    expect(request.config.responseSchema.properties.wordFamily.properties).toHaveProperty('noun');
    expect(request.config.responseSchema.properties).toHaveProperty('mnemonic');
  });

  it('preserves the fingerprint of requests without a part-of-speech hint', async () => {
    reserveWordOperation.mockResolvedValue({ kind: 'completed', result: { translation: 'cached' } });
    const { generateVocabulary } = await import('../src/index.js');
    await generateVocabulary.run({
      auth: { uid: 'owner-1' }, data: { action: 'word', input: 'apple', operationId: randomUUID() },
    } as never);
    expect(reserveWordOperation.mock.calls[0][3]).toBe(
      createHash('sha256').update(JSON.stringify({ word: 'apple' })).digest('hex'),
    );
  });

  it('refunds the reservation but rethrows the original error when the budget check fails', async () => {
    reserveWordOperation.mockResolvedValue({ kind: 'reserved', attemptId: 'attempt-1', periodKey: 'free-2026-09' });
    settleWordOperation.mockResolvedValue(true);
    consumePersistentRateLimit.mockRejectedValue(new RateLimitExceededError(5_000));
    const { generateVocabulary } = await import('../src/index.js');
    await expect(generateVocabulary.run({
      auth: { uid: 'owner-1' }, data: { action: 'word', input: 'apple', operationId: randomUUID() },
    } as never)).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(runMeteredGemini).not.toHaveBeenCalled();
    expect(settleWordOperation).toHaveBeenCalledWith(
      expect.anything(), 'owner-1', expect.any(String), 'attempt-1', null, expect.any(Date),
    );
  });

  it('still rethrows the original error when the refund itself fails', async () => {
    reserveWordOperation.mockResolvedValue({ kind: 'reserved', attemptId: 'attempt-1', periodKey: 'free-2026-09' });
    consumePersistentRateLimit.mockRejectedValue(new RateLimitExceededError(5_000));
    settleWordOperation.mockRejectedValue(new Error('refund transaction failed'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { generateVocabulary } = await import('../src/index.js');
    await expect(generateVocabulary.run({
      auth: { uid: 'owner-1' }, data: { action: 'word', input: 'apple', operationId: randomUUID() },
    } as never)).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(consoleError).toHaveBeenCalledWith('ai-word-refund-failed', expect.objectContaining({ errorName: 'Error' }));
    consoleError.mockRestore();
  });

  it('reports settle-race as unavailable so the caller retries with the same operation id', async () => {
    reserveWordOperation.mockResolvedValue({ kind: 'reserved', attemptId: 'attempt-1', periodKey: 'free-2026-09' });
    settleWordOperation.mockResolvedValue(false);
    const { generateVocabulary } = await import('../src/index.js');
    await expect(generateVocabulary.run({
      auth: { uid: 'owner-1' }, data: { action: 'word', input: 'apple', operationId: randomUUID() },
    } as never)).rejects.toMatchObject({ code: 'unavailable' });
    expect(runMeteredGemini).toHaveBeenCalledTimes(1);
  });
});
