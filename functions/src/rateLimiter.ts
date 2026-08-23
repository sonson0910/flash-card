import { createHash } from 'node:crypto';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';

export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1_000;
export const RATE_LIMIT_STORAGE_DEADLINE_MS = 2_000;
const RATE_LIMIT_COLLECTION = '_functionRateLimitBudgets';
const RATE_LIMIT_RETENTION_WINDOWS = 2;

export type RateLimitState = { windowStartedAt: number; calls: number };
type RateLimitDecision = {
  allowed: boolean;
  state: RateLimitState;
  retryAfterMs: number;
};

export class RateLimitExceededError extends Error {
  constructor(readonly retryAfterMs: number) {
    super('Rate limit exceeded.');
    this.name = 'RateLimitExceededError';
  }
}

export interface MemoryRateLimitStore {
  consume(userId: string, scope: string, maximum: number, now?: number): void;
}

class RateLimitStorageTimeoutError extends Error {
  constructor() {
    super('Persistent rate-limit storage did not respond in time.');
    this.name = 'RateLimitStorageTimeoutError';
  }
}

const isValidState = (value: RateLimitState | null): value is RateLimitState => Boolean(
  value
  && Number.isSafeInteger(value.windowStartedAt)
  && value.windowStartedAt >= 0
  && Number.isSafeInteger(value.calls)
  && value.calls >= 0,
);

export const evaluateRateLimit = (
  current: RateLimitState | null,
  now: number,
  maximum: number,
): RateLimitDecision => {
  if (!Number.isSafeInteger(maximum) || maximum <= 0) {
    throw new Error('Rate limit maximum must be a positive integer.');
  }
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error('Rate limit time must be a non-negative integer.');
  }

  if (!isValidState(current) || now < current.windowStartedAt
    || now - current.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    return {
      allowed: true,
      state: { windowStartedAt: now, calls: 1 },
      retryAfterMs: 0,
    };
  }

  if (current.calls >= maximum) {
    return {
      allowed: false,
      state: current,
      retryAfterMs: Math.max(1, current.windowStartedAt + RATE_LIMIT_WINDOW_MS - now),
    };
  }

  return {
    allowed: true,
    state: { windowStartedAt: current.windowStartedAt, calls: current.calls + 1 },
    retryAfterMs: 0,
  };
};

const budgetDocumentId = (userId: string, scope: string) => createHash('sha256')
  .update(userId)
  .update('\0')
  .update(scope)
  .digest('hex');

export const createMemoryRateLimitStore = (maximumEntries = 1_024): MemoryRateLimitStore => {
  if (!Number.isSafeInteger(maximumEntries) || maximumEntries <= 0) {
    throw new Error('Memory rate-limit capacity must be a positive integer.');
  }
  const states = new Map<string, RateLimitState>();

  return {
    consume(userId, scope, maximum, now = Date.now()) {
      const key = budgetDocumentId(userId, scope);
      if (!states.has(key) && states.size >= maximumEntries) {
        for (const [candidateKey, state] of states) {
          if (now < state.windowStartedAt || now - state.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
            states.delete(candidateKey);
          }
        }
      }
      if (!states.has(key) && states.size >= maximumEntries) {
        throw new RateLimitExceededError(RATE_LIMIT_WINDOW_MS);
      }

      const decision = evaluateRateLimit(states.get(key) ?? null, now, maximum);
      if (!decision.allowed) throw new RateLimitExceededError(decision.retryAfterMs);
      states.set(key, decision.state);
    },
  };
};

export const isFirestoreQuotaError = (error: unknown): boolean => {
  if (error instanceof RateLimitExceededError) return false;
  const source = error && typeof error === 'object'
    ? error as { code?: unknown; details?: unknown; message?: unknown }
    : null;
  const code = String(source?.code ?? '').toLocaleLowerCase();
  const message = `${String(source?.details ?? '')} ${String(source?.message ?? error)}`
    .toLocaleLowerCase();
  return code === '8'
    || code.includes('resource-exhausted')
    || message.includes('resource_exhausted')
    || message.includes('resource-exhausted')
    || message.includes('quota');
};

const withRateLimitStorageDeadline = <T>(operation: Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new RateLimitStorageTimeoutError()),
      RATE_LIMIT_STORAGE_DEADLINE_MS,
    );
    operation.then(
      value => {
        clearTimeout(timeout);
        resolve(value);
      },
      error => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });

export const consumeRateLimitWithMemoryFallback = async (
  consumePersistent: () => Promise<void>,
  consumeMemory: () => void,
): Promise<'firestore' | 'memory'> => {
  try {
    await withRateLimitStorageDeadline(consumePersistent());
    return 'firestore';
  } catch (error) {
    if (!(error instanceof RateLimitStorageTimeoutError) && !isFirestoreQuotaError(error)) {
      throw error;
    }
    consumeMemory();
    return 'memory';
  }
};

export const consumeRateLimitFailClosed = async (
  consumePersistent: () => Promise<void>,
): Promise<'firestore'> => {
  await withRateLimitStorageDeadline(consumePersistent());
  return 'firestore';
};

const persistedState = (data: FirebaseFirestore.DocumentData | undefined): RateLimitState | null => {
  const windowStartedAt = data?.windowStartedAtMs;
  const calls = data?.calls;
  return typeof windowStartedAt === 'number' && typeof calls === 'number'
    ? { windowStartedAt, calls }
    : null;
};

export const consumePersistentRateLimit = async (
  database: Firestore,
  userId: string,
  scope: string,
  maximum: number,
  now = Date.now(),
) => {
  const document = database.collection(RATE_LIMIT_COLLECTION).doc(budgetDocumentId(userId, scope));

  await database.runTransaction(async transaction => {
    const snapshot = await transaction.get(document);
    const decision = evaluateRateLimit(persistedState(snapshot.data()), now, maximum);
    if (!decision.allowed) throw new RateLimitExceededError(decision.retryAfterMs);

    transaction.set(document, {
      scope,
      windowStartedAtMs: decision.state.windowStartedAt,
      calls: decision.state.calls,
      expireAt: Timestamp.fromMillis(
        decision.state.windowStartedAt + RATE_LIMIT_WINDOW_MS * RATE_LIMIT_RETENTION_WINDOWS,
      ),
    });
  });
};
