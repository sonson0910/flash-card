import * as functionsLogger from 'firebase-functions/logger';

export type FunctionErrorClass =
  | 'type-error'
  | 'range-error'
  | 'firestore-error'
  | 'unexpected-error';

export type FunctionLogEvent =
  | {
    readonly event: 'rate-limit-storage-fallback';
    readonly outcome: 'activated';
    readonly reason: 'firestore-quota';
    readonly limit: number;
  }
  | {
    readonly event: 'legacy-library-migration';
    readonly outcome: 'failed';
    readonly reason: 'unexpected-error';
    readonly errorClass: FunctionErrorClass;
  }
  | {
    readonly event: 'legacy-library-operator';
    readonly outcome: 'failed';
    readonly reason: 'unexpected-error';
    readonly errorClass: FunctionErrorClass;
  };

const ERROR_CLASSES = new Set<FunctionErrorClass>([
  'type-error',
  'range-error',
  'firestore-error',
  'unexpected-error',
]);

const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]) => {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === [...expected].sort()[index]);
};

const isBoundedCount = (value: unknown) => Number.isSafeInteger(value)
  && Number(value) > 0
  && Number(value) <= 10_000;

const isFunctionLogEvent = (value: unknown): value is FunctionLogEvent => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  if (entry.event === 'rate-limit-storage-fallback') {
    return hasExactKeys(entry, ['event', 'outcome', 'reason', 'limit'])
      && entry.outcome === 'activated'
      && entry.reason === 'firestore-quota'
      && isBoundedCount(entry.limit);
  }
  if (entry.event === 'legacy-library-migration' || entry.event === 'legacy-library-operator') {
    return hasExactKeys(entry, ['event', 'outcome', 'reason', 'errorClass'])
      && entry.outcome === 'failed'
      && entry.reason === 'unexpected-error'
      && typeof entry.errorClass === 'string'
      && ERROR_CLASSES.has(entry.errorClass as FunctionErrorClass);
  }
  return false;
};

export const classifyFunctionError = (error: unknown): FunctionErrorClass => {
  if (error instanceof TypeError) return 'type-error';
  if (error instanceof RangeError) return 'range-error';
  if (error && typeof error === 'object' && 'code' in error) return 'firestore-error';
  return 'unexpected-error';
};

export const logFunctionEvent = (entry: unknown): void => {
  try {
    if (!isFunctionLogEvent(entry)) return;
    const payload = { schemaVersion: 1, ...entry };
    if (entry.outcome === 'failed') functionsLogger.error('function_event', payload);
    else functionsLogger.warn('function_event', payload);
  } catch {
    // Logging is best-effort and must never alter callable or operator behavior.
  }
};
