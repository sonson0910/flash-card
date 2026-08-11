export const firestoreDailyReadLimitMessage =
  "Firebase's daily read limit has been reached. Changes stay safe on this device until the quota resets.";

const errorField = (error: unknown, field: 'code' | 'message'): string => {
  if (!error || typeof error !== 'object' || !(field in error)) return '';
  return String((error as Record<string, unknown>)[field] ?? '').toLocaleLowerCase();
};

export function isCloudQuotaError(error: unknown): boolean {
  const code = errorField(error, 'code');
  const message = error instanceof Error
    ? error.message.toLocaleLowerCase()
    : errorField(error, 'message') || String(error).toLocaleLowerCase();
  return code.includes('resource-exhausted')
    || code.includes('quota-exceeded')
    || message.includes('resource-exhausted')
    || message.includes('quota');
}

export function isRetryableCloudError(error: unknown): boolean {
  if (isCloudQuotaError(error)) return true;
  const code = errorField(error, 'code');
  const message = error instanceof Error
    ? error.message.toLocaleLowerCase()
    : errorField(error, 'message') || String(error).toLocaleLowerCase();
  return [
    'unavailable',
    'deadline-exceeded',
    'network-request-failed',
    'aborted',
    'internal',
    'unknown',
  ].some(value => code.includes(value))
    || [
      'network',
      'offline',
      'timeout',
      'connection',
      'failed to fetch',
    ].some(value => message.includes(value));
}
