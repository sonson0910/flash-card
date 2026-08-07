export type ScriptScoringPolicy = 'latin' | 'han' | 'kana' | 'hangul' | 'fallback';

export interface ScriptScore {
  readonly correct: boolean;
  readonly policy: ScriptScoringPolicy;
  readonly normalizedExpected: string;
  readonly normalizedAnswer: string;
  readonly wrongScript: boolean;
}

export function inferScriptScoringPolicy(expected: unknown): ScriptScoringPolicy {
  if (typeof expected !== 'string') return 'fallback';
  const normalized = expected.normalize('NFKC');
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(normalized)) return 'kana';
  if (/\p{Script=Hangul}/u.test(normalized)) return 'hangul';
  if (/\p{Script=Han}/u.test(normalized)) return 'han';
  if (/\p{Script=Latin}/u.test(normalized)) return 'latin';
  return 'fallback';
}

const normalizeSpacing = (value: string): string => value.replace(/\s+/gu, ' ').trim();
const removePunctuation = (value: string): string => value.replace(/[\p{P}\p{S}]+/gu, ' ');

export function normalizeScriptAnswer(value: unknown, policy: ScriptScoringPolicy): string {
  if (typeof value !== 'string') return '';
  const normalized = value.normalize('NFKC');
  if (policy === 'fallback') return normalizeSpacing(normalized);
  if (policy === 'han' || policy === 'kana') {
    return removePunctuation(normalized).replace(/\s+/gu, '');
  }
  return normalizeSpacing(removePunctuation(normalized).toLocaleLowerCase());
}

const containsExpectedScript = (value: string, policy: ScriptScoringPolicy): boolean => {
  if (policy === 'han') return /\p{Script=Han}/u.test(value);
  if (policy === 'kana') return /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value);
  if (policy === 'hangul') return /\p{Script=Hangul}/u.test(value);
  if (policy === 'latin') return /\p{Script=Latin}/u.test(value);
  return true;
};

export function scoreScriptAnswer(
  expected: unknown,
  answer: unknown,
  policy: ScriptScoringPolicy,
): ScriptScore {
  const normalizedExpected = normalizeScriptAnswer(expected, policy);
  const normalizedAnswer = normalizeScriptAnswer(answer, policy);
  const expectedUsesPolicy = containsExpectedScript(normalizedExpected, policy);
  const answerUsesPolicy = containsExpectedScript(normalizedAnswer, policy);
  return {
    correct: normalizedExpected.length > 0 && normalizedExpected === normalizedAnswer,
    policy,
    normalizedExpected,
    normalizedAnswer,
    wrongScript: expectedUsesPolicy && normalizedAnswer.length > 0 && !answerUsesPolicy,
  };
}
