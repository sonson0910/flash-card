export type ProtectedFunctionsUnavailableReason =
  | 'firebase-unconfigured'
  | 'firebase-initialization-failed'
  | 'app-check-unconfigured'
  | 'app-check-initialization-failed';

export type ProtectedFunctionsCapability =
  | { readonly available: true }
  | {
      readonly available: false;
      readonly reason: ProtectedFunctionsUnavailableReason;
    };

export interface ProtectedFunctionsRuntimeState {
  readonly firebaseConfigured: boolean;
  readonly firebaseInitialized: boolean;
  readonly appCheckSiteKeyConfigured: boolean;
  readonly appCheckInitialized: boolean;
}

export type ProtectedFunctionFailureKind =
  | 'authentication'
  | 'permission'
  | 'configuration'
  | 'quota'
  | 'network'
  | 'unknown';

export class ProtectedFunctionError extends Error {
  readonly kind: ProtectedFunctionFailureKind;
  readonly code: string;
  readonly retryable: boolean;

  constructor({
    message,
    kind,
    code,
    retryable,
  }: {
    message: string;
    kind: ProtectedFunctionFailureKind;
    code: string;
    retryable: boolean;
  }) {
    super(message);
    this.name = 'ProtectedFunctionError';
    this.kind = kind;
    this.code = code;
    this.retryable = retryable;
  }
}

export function resolveProtectedFunctionsCapability(
  runtime: ProtectedFunctionsRuntimeState,
): ProtectedFunctionsCapability {
  if (!runtime.firebaseConfigured) {
    return { available: false, reason: 'firebase-unconfigured' };
  }
  if (!runtime.firebaseInitialized) {
    return { available: false, reason: 'firebase-initialization-failed' };
  }
  if (!runtime.appCheckSiteKeyConfigured) {
    return { available: false, reason: 'app-check-unconfigured' };
  }
  if (!runtime.appCheckInitialized) {
    return { available: false, reason: 'app-check-initialization-failed' };
  }
  return { available: true };
}

const unavailableMessage = (
  reason: ProtectedFunctionsUnavailableReason,
  operation: string,
): string => {
  if (reason === 'firebase-unconfigured') {
    return `${operation} is unavailable because protected cloud features are not configured for this build. Your local library is still available.`;
  }
  if (reason === 'firebase-initialization-failed') {
    return `${operation} is unavailable because Firebase could not start. Reload the app; if this continues, the deployment configuration needs administrator attention.`;
  }
  if (reason === 'app-check-unconfigured') {
    return `${operation} is unavailable because App Check is not configured for this build. Ask the app administrator to configure App Check, then reload.`;
  }
  return `${operation} is unavailable because the protected cloud service could not start securely. Reload the app; if this continues, the deployment configuration needs administrator attention.`;
};

export function assertProtectedFunctionsAvailable(
  capability: ProtectedFunctionsCapability,
  operation: string,
): asserts capability is { readonly available: true } {
  if (capability.available) return;
  throw new ProtectedFunctionError({
    message: unavailableMessage(capability.reason, operation),
    kind: 'configuration',
    code: capability.reason,
    retryable: false,
  });
}

const readErrorCode = (error: unknown): string => {
  if (!error || typeof error !== 'object' || !('code' in error)) return '';
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string'
    ? code.trim().toLowerCase().replace(/^firebase\//, '').replace(/^functions\//, '')
    : '';
};

export function classifyProtectedFunctionError(
  error: unknown,
  operation: string,
): ProtectedFunctionError {
  if (error instanceof ProtectedFunctionError) return error;
  const code = readErrorCode(error);

  if (code === 'unauthenticated') {
    return new ProtectedFunctionError({
      message: `${operation} needs a current sign-in. Sign in again, then retry.`,
      kind: 'authentication',
      code,
      retryable: false,
    });
  }
  if (code === 'permission-denied') {
    return new ProtectedFunctionError({
      message: `${operation} was rejected by the protected cloud service. Reload and sign in again; if it continues, App Check or access rules need administrator attention.`,
      kind: 'permission',
      code,
      retryable: false,
    });
  }
  if (code === 'failed-precondition' || code === 'not-found') {
    return new ProtectedFunctionError({
      message: `${operation} cannot run because this app and its cloud deployment are out of sync. Update the deployment configuration before retrying.`,
      kind: 'configuration',
      code,
      retryable: false,
    });
  }
  if (code === 'resource-exhausted' || code === 'quota-exceeded') {
    return new ProtectedFunctionError({
      message: `${operation} has reached its cloud usage limit. Try again later.`,
      kind: 'quota',
      code,
      retryable: false,
    });
  }
  if (
    error instanceof TypeError
    || ['cancelled', 'deadline-exceeded', 'network-request-failed', 'unavailable'].includes(code)
  ) {
    return new ProtectedFunctionError({
      message: `${operation} could not reach the protected cloud service. Check your connection and try again.`,
      kind: 'network',
      code: code || 'network-error',
      retryable: true,
    });
  }
  return new ProtectedFunctionError({
    message: `${operation} failed safely. Try again; if it continues, contact the app administrator.`,
    kind: 'unknown',
    code: code || 'unknown',
    retryable: false,
  });
}

export async function runProtectedFunction<T>(
  capability: ProtectedFunctionsCapability,
  operation: string,
  invoke: () => Promise<T>,
): Promise<T> {
  assertProtectedFunctionsAvailable(capability, operation);
  try {
    return await invoke();
  } catch (error) {
    throw classifyProtectedFunctionError(error, operation);
  }
}

export function getProtectedFunctionUserMessage(error: unknown): string | null {
  return error instanceof ProtectedFunctionError ? error.message : null;
}
