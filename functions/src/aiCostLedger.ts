import type { Firestore } from 'firebase-admin/firestore';
import { MAX_AI_OUTPUT_TOKENS } from './aiGeneration.js';
import type { VocabularyAiAction } from './aiRequestBudget.js';
import type { PilotConfig } from './pilotConfig.js';

export type AiCallOutcome = 'ok' | 'provider-error' | 'parse-error' | 'timeout';

export class AiSpendLimitError extends Error {
  constructor(readonly reason: 'service-daily-cap' | 'account-daily-spend') {
    super(reason);
    this.name = 'AiSpendLimitError';
  }
}

export class AiCallTimeoutError extends Error {
  constructor() {
    super('AI request timed out.');
    this.name = 'AiCallTimeoutError';
  }
}

export interface AiTokenUsage {
  promptTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cachedTokens: number;
  totalTokens: number;
  usageMissing: boolean;
}

const tokenCount = (value: unknown): number => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
const validTokenCount = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

export function readAiTokenUsage(value: unknown): AiTokenUsage {
  const usage = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const promptTokens = tokenCount(usage?.promptTokenCount);
  const outputValue = usage?.candidatesTokenCount ?? usage?.responseTokenCount;
  const outputTokens = tokenCount(outputValue);
  const thinkingTokens = tokenCount(usage?.thoughtsTokenCount);
  const cachedTokens = tokenCount(usage?.cachedContentTokenCount);
  const totalTokens = tokenCount(usage?.totalTokenCount);
  return {
    promptTokens, outputTokens, thinkingTokens, cachedTokens, totalTokens,
    usageMissing: !validTokenCount(usage?.promptTokenCount)
      || !validTokenCount(usage?.totalTokenCount)
      || (outputValue !== undefined && !validTokenCount(outputValue))
      || (usage?.thoughtsTokenCount !== undefined && !validTokenCount(usage.thoughtsTokenCount))
      || (usage?.cachedContentTokenCount !== undefined && !validTokenCount(usage.cachedContentTokenCount))
      || cachedTokens > promptTokens
      || totalTokens !== promptTokens + outputTokens + thinkingTokens,
  };
}

export function estimateCostUsdMicros(usage: AiTokenUsage, config: PilotConfig): number {
  const cached = Math.min(usage.promptTokens, usage.cachedTokens);
  return Math.ceil(
    (usage.promptTokens - cached) * config.geminiInputUsdPerMillion
    + cached * config.geminiInputUsdPerMillion
    + (usage.outputTokens + usage.thinkingTokens) * config.geminiOutputUsdPerMillion,
  );
}

export function worstCaseReservationMicros(action: VocabularyAiAction, contents: string, config: PilotConfig): number {
  const promptTokensUpperBound = Buffer.byteLength(contents, 'utf8') + 256;
  return Math.ceil(promptTokensUpperBound * config.geminiInputUsdPerMillion
    + MAX_AI_OUTPUT_TOKENS[action] * config.geminiOutputUsdPerMillion);
}

export function dayKey(now: Date, timezone: PilotConfig['pilotTimezone']): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

const storedMicros = (value: unknown): number => {
  if (value === undefined) return 0;
  if (Number.isSafeInteger(value) && Number(value) >= 0) return Number(value);
  throw new Error('AI spend counter is invalid.');
};

export async function reserveAiSpend(
  database: Firestore, uid: string, day: string, amount: number, config: PilotConfig,
): Promise<void> {
  const global = database.collection('_serviceBudgets').doc(`gemini-spend-${day}`);
  const account = database.collection('users').doc(uid).collection('ai_daily').doc(day);
  const globalCap = Math.floor(config.dailyGeminiSpendCapUsd * 1_000_000);
  const accountCap = Math.floor(globalCap * config.accountDailySpendShare);
  await database.runTransaction(async transaction => {
    const [globalSnapshot, accountSnapshot] = await Promise.all([transaction.get(global), transaction.get(account)]);
    const globalSpend = storedMicros(globalSnapshot.data()?.usdMicros);
    const accountSpend = storedMicros(accountSnapshot.data()?.usdMicros);
    if (globalSpend + amount > globalCap) throw new AiSpendLimitError('service-daily-cap');
    if (accountSpend + amount > accountCap) throw new AiSpendLimitError('account-daily-spend');
    transaction.set(global, { usdMicros: globalSpend + amount, day }, { merge: true });
    transaction.set(account, { usdMicros: accountSpend + amount, day }, { merge: true });
  });
}

export async function correctAiSpend(
  database: Firestore, uid: string, day: string, reserved: number, actual: number,
): Promise<void> {
  const global = database.collection('_serviceBudgets').doc(`gemini-spend-${day}`);
  const account = database.collection('users').doc(uid).collection('ai_daily').doc(day);
  await database.runTransaction(async transaction => {
    const [globalSnapshot, accountSnapshot] = await Promise.all([transaction.get(global), transaction.get(account)]);
    const difference = actual - reserved;
    transaction.set(global, { usdMicros: Math.max(0, storedMicros(globalSnapshot.data()?.usdMicros) + difference) }, { merge: true });
    transaction.set(account, { usdMicros: Math.max(0, storedMicros(accountSnapshot.data()?.usdMicros) + difference) }, { merge: true });
  });
}

export async function writeAiCostLedger(database: Firestore, entry: {
  uid: string;
  action: VocabularyAiAction;
  operationId: string | null;
  model: string;
  usage: AiTokenUsage;
  estimatedUsdMicros: number;
  reservedUsdMicros: number;
  latencyMs: number;
  outcome: AiCallOutcome;
  day: string;
  createdAt: Date;
}): Promise<void> {
  const { usage, createdAt, ...rest } = entry;
  await database.collection('ai_cost_ledger').add({
    ...rest,
    ...usage,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 400 * 24 * 60 * 60 * 1_000),
  });
}

export async function runMeteredGemini<T, Response extends { usageMetadata?: unknown }>(options: {
  database: Firestore;
  uid: string;
  action: VocabularyAiAction;
  operationId: string | null;
  model: string;
  contents: string;
  config: PilotConfig;
  generate(signal: AbortSignal): Promise<Response>;
  parse(response: Response): T;
  now?: () => Date;
  timeoutMs?: number;
}): Promise<T> {
  const { database, uid, action, operationId, model, contents, config, generate, parse } = options;
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const day = dayKey(startedAt, config.pilotTimezone);
  const reservedUsdMicros = worstCaseReservationMicros(action, contents, config);
  await reserveAiSpend(database, uid, day, reservedUsdMicros, config);

  let usage = readAiTokenUsage(null);
  let outcome: AiCallOutcome = 'provider-error';
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      generate(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new AiCallTimeoutError());
        }, options.timeoutMs ?? 45_000);
      }),
    ]);
    usage = readAiTokenUsage(response.usageMetadata);
    outcome = 'parse-error';
    const result = parse(response);
    outcome = 'ok';
    return result;
  } catch (error) {
    if (error instanceof AiCallTimeoutError || controller.signal.aborted) {
      outcome = 'timeout';
      throw new AiCallTimeoutError();
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    // Unknown usage may still be billed; preserve the worst-case reservation.
    const estimatedUsdMicros = usage.usageMissing || outcome === 'timeout' || outcome === 'provider-error'
      ? reservedUsdMicros : estimateCostUsdMicros(usage, config);
    if (estimatedUsdMicros !== reservedUsdMicros) {
      try {
        await correctAiSpend(database, uid, day, reservedUsdMicros, estimatedUsdMicros);
      } catch (error) {
        console.error('AI spend correction failed; full reservation retained.', {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      }
    }
    try {
      await writeAiCostLedger(database, {
        uid, action, operationId, model, usage, estimatedUsdMicros, reservedUsdMicros,
        latencyMs: Math.max(0, now().getTime() - startedAt.getTime()), outcome, day, createdAt: startedAt,
      });
    } catch (error) {
      console.error('ledger-write-failed', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }
}
