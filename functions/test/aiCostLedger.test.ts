import type { DocumentData, DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import {
  AiCallTimeoutError,
  AiSpendLimitError,
  dayKey,
  estimateCostUsdMicros,
  readAiTokenUsage,
  reserveAiSpend,
  runMeteredGemini,
  worstCaseReservationMicros,
} from '../src/aiCostLedger.js';
import { PILOT_CONFIG_DEFAULTS } from '../src/pilotConfig.js';

const fixture = () => {
  const documents = new Map<string, Record<string, unknown>>();
  const ledger: Array<Record<string, unknown>> = [];
  let ledgerFails = false;
  let transactionFails = false;
  const doc = (path: string) => ({
    path,
    collection: (name: string) => ({ doc: (id: string) => doc(`${path}/${name}/${id}`) }),
  });
  const database = {
    collection: (name: string) => ({
      doc: (id: string) => doc(`${name}/${id}`),
      add: async (data: Record<string, unknown>) => {
        if (ledgerFails) throw new Error('ledger failed');
        ledger.push(data);
      },
    }),
    runTransaction: async <T>(callback: (transaction: Transaction) => Promise<T>): Promise<T> => {
      if (transactionFails) throw new Error('transaction failed');
      const transaction = {
        get: async (reference: DocumentReference) => ({ data: () => documents.get(reference.path) }),
        set: (reference: DocumentReference, data: DocumentData) => {
          documents.set(reference.path, { ...documents.get(reference.path), ...data });
        },
      } as unknown as Transaction;
      return callback(transaction);
    },
  } as unknown as Firestore;
  return { database, documents, ledger, failLedger: () => { ledgerFails = true; }, failTransactions: () => { transactionFails = true; } };
};

const time = new Date('2026-09-23T17:00:00.000Z');
const usage = { promptTokenCount: 400, candidatesTokenCount: 400, thoughtsTokenCount: 0, cachedContentTokenCount: 0, totalTokenCount: 800 };

describe('AI cost ledger and reservations', () => {
  it('prices measured tokens and bounds the call before sending it', () => {
    expect(estimateCostUsdMicros(readAiTokenUsage(usage), { ...PILOT_CONFIG_DEFAULTS })).toBe(700);
    expect(worstCaseReservationMicros('word', 'A word', { ...PILOT_CONFIG_DEFAULTS })).toBeGreaterThan(700);
    expect(readAiTokenUsage(null)).toMatchObject({ usageMissing: true, promptTokens: 0, outputTokens: 0 });
    expect(readAiTokenUsage({ promptTokenCount: 1, responseTokenCount: 2 })).toMatchObject({ outputTokens: 2, usageMissing: true });
  });

  it('changes day at midnight in the pilot timezone', () => {
    expect(dayKey(new Date('2026-09-23T16:59:59.000Z'), 'Asia/Ho_Chi_Minh')).toBe('2026-09-23');
    expect(dayKey(time, 'Asia/Ho_Chi_Minh')).toBe('2026-09-24');
  });

  it('refuses a global cap and an account share independently', async () => {
    const first = fixture();
    const globalConfig = { ...PILOT_CONFIG_DEFAULTS, dailyGeminiSpendCapUsd: 0.001, accountDailySpendShare: 1 };
    await reserveAiSpend(first.database, 'a', '2026-09-24', 600, globalConfig);
    await expect(reserveAiSpend(first.database, 'b', '2026-09-24', 500, globalConfig))
      .rejects.toMatchObject({ reason: 'service-daily-cap' } satisfies Partial<AiSpendLimitError>);

    const second = fixture();
    const accountConfig = { ...PILOT_CONFIG_DEFAULTS, dailyGeminiSpendCapUsd: 0.005, accountDailySpendShare: 0.2 };
    await reserveAiSpend(second.database, 'a', '2026-09-24', 600, accountConfig);
    await expect(reserveAiSpend(second.database, 'a', '2026-09-24', 500, accountConfig))
      .rejects.toMatchObject({ reason: 'account-daily-spend' } satisfies Partial<AiSpendLimitError>);
    await expect(reserveAiSpend(second.database, 'b', '2026-09-24', 500, accountConfig)).resolves.toBeUndefined();
  });

  it('corrects both counters after success and writes one content-free ledger entry', async () => {
    const state = fixture();
    const result = await runMeteredGemini({
      database: state.database, uid: 'learner', action: 'word', operationId: null,
      model: 'gemini-3.1-flash-lite', contents: 'A word', config: { ...PILOT_CONFIG_DEFAULTS },
      now: () => time,
      generate: async () => ({ text: 'private model output', usageMetadata: usage }),
      parse: response => response.text,
    });
    expect(result).toBe('private model output');
    expect(state.documents.get('_serviceBudgets/gemini-spend-2026-09-24')?.usdMicros).toBe(700);
    expect(state.documents.get('users/learner/ai_daily/2026-09-24')?.usdMicros).toBe(700);
    expect(state.ledger).toHaveLength(1);
    expect(state.ledger[0]).toMatchObject({ outcome: 'ok', estimatedUsdMicros: 700, promptTokens: 400, outputTokens: 400 });
    expect(JSON.stringify(state.ledger)).not.toContain('private model output');
  });

  it('keeps the full reservation when timeout or usage loss makes cost unknown', async () => {
    const state = fixture();
    const pending = runMeteredGemini({
      database: state.database, uid: 'learner', action: 'word', operationId: null,
      model: 'gemini-3.1-flash-lite', contents: 'A word', config: { ...PILOT_CONFIG_DEFAULTS },
      now: () => time, timeoutMs: 1,
      generate: () => new Promise<{ usageMetadata?: unknown }>(() => undefined),
      parse: () => 'never',
    });
    await expect(pending).rejects.toBeInstanceOf(AiCallTimeoutError);
    expect(state.ledger[0]).toMatchObject({ outcome: 'timeout' });
    expect(state.documents.get('_serviceBudgets/gemini-spend-2026-09-24')?.usdMicros)
      .toBe(state.ledger[0]?.reservedUsdMicros);
  });

  it('does not fail the learner on a ledger failure, but fails closed before a reservation', async () => {
    const state = fixture();
    state.failLedger();
    await expect(runMeteredGemini({
      database: state.database, uid: 'learner', action: 'word', operationId: null,
      model: 'gemini-3.1-flash-lite', contents: 'A word', config: { ...PILOT_CONFIG_DEFAULTS },
      now: () => time, generate: async () => ({ usageMetadata: usage }), parse: () => 'ok',
    })).resolves.toBe('ok');
    expect(state.ledger).toHaveLength(0);

    const blocked = fixture();
    blocked.failTransactions();
    const generate = vi.fn();
    await expect(runMeteredGemini({
      database: blocked.database, uid: 'learner', action: 'word', operationId: null,
      model: 'gemini-3.1-flash-lite', contents: 'A word', config: { ...PILOT_CONFIG_DEFAULTS },
      now: () => time, generate, parse: () => 'never',
    })).rejects.toThrow('transaction failed');
    expect(generate).not.toHaveBeenCalled();
  });
});
