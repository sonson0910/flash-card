export type AiGenerationRuntime = 'direct-development' | 'protected-production';

export type AiGenerationAccess =
  | { readonly available: true }
  | {
      readonly available: false;
      readonly reason: 'authentication-required';
      readonly message: string;
    };

export function resolveAiGenerationAccess({
  runtime,
  isAuthenticated,
}: {
  runtime: AiGenerationRuntime;
  isAuthenticated: boolean;
}): AiGenerationAccess {
  if (runtime === 'protected-production' && !isAuthenticated) {
    return {
      available: false,
      reason: 'authentication-required',
      message: 'Sign in to generate smart cards.',
    };
  }
  return { available: true };
}
