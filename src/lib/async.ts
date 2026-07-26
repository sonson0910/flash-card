export class OperationTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperationTimeoutError';
  }
}

export function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message = 'The operation took too long. Please try again.',
  onTimeout?: () => void,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return operation;

  return new Promise<T>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      try {
        onTimeout?.();
      } finally {
        reject(new OperationTimeoutError(message));
      }
    }, timeoutMs);

    operation.then(
      value => {
        globalThis.clearTimeout(timeoutId);
        resolve(value);
      },
      error => {
        globalThis.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}
