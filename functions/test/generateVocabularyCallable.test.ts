import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PILOT_CONFIG_DEFAULTS } from '../src/pilotConfig.js';
import { AiQuotaError } from '../src/aiQuota.js';
import { RateLimitExceededError } from '../src/rateLimiter.js';

// The real generateVocabulary handler talks to Firestore (quota, budgets, the cost
// ledger) and to Gemini. Every one of those boundaries is mocked here so the handler's
// own branching -- replay of a completed operation, a request-hash conflict, a refund
// that must not swallow the original error, and a settle race -- can be exercised
// directly without an emulator and without ever calling the real model.
const reserveWordOperation = vi.fn();
const settleWordOperation = vi.fn();
const loadPilotConfig = vi.fn(async (..._args: unknown[]) => ({ ...PILOT_CONFIG_DEFAULTS }));
const isAccountDeleting = vi.fn(async (..._args: unknown[]) => false);
const consumePersistentRateLimit = vi.fn(async (..._args: unknown[]) => undefined);
const consumePersistentRateLimits = vi.fn(async (..._args: unknown[]) => undefined);
const runMeteredGemini = vi.fn();

vi.mock('../src/aiQuota.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/aiQuota.js')>(),
  reserveWordOperation: (...args: unknown[]) => reserveWordOperation(...args),
  settleWordOperation: (...args: unknown[]) => settleWordOperation(...args),
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
    settleWordOperation.mockReset();
    loadPilotConfig.mockReset().mockResolvedValue({ ...PILOT_CONFIG_DEFAULTS });
    isAccountDeleting.mockReset().mockResolvedValue(false);
    consumePersistentRateLimit.mockReset().mockResolvedValue(undefined);
    consumePersistentRateLimits.mockReset().mockResolvedValue(undefined);
    runMeteredGemini.mockReset().mockImplementation(async ({ parse }: { parse: (response: unknown) => unknown }) =>
      parse(FAKE_WORD_RESPONSE));
  });
  afterEach(() => {
    process.env = { ...previousEnv };
    vi.clearAllMocks();
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
