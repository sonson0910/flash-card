export type VocabularyAiAction = 'word' | 'story' | 'translate';

export interface VocabularyAiBudget {
  scope: 'ai-card' | 'ai-story' | 'ai-translate';
  maximum: number;
  message: string;
}

const VOCABULARY_AI_BUDGETS: Record<VocabularyAiAction, VocabularyAiBudget> = {
  word: {
    scope: 'ai-card',
    maximum: 120,
    message: 'Card generation limit reached. Try again later.',
  },
  story: {
    scope: 'ai-story',
    maximum: 30,
    message: 'Story generation limit reached. Try again later.',
  },
  translate: {
    scope: 'ai-translate',
    maximum: 120,
    message: 'Translation limit reached. Try again later.',
  },
};

const VOCABULARY_AI_SCOPES = new Set(
  Object.values(VOCABULARY_AI_BUDGETS).map(budget => budget.scope),
);

export const getVocabularyAiBudget = (action: VocabularyAiAction): VocabularyAiBudget =>
  VOCABULARY_AI_BUDGETS[action];

export const isVocabularyAiRateLimitScope = (scope: string): boolean =>
  VOCABULARY_AI_SCOPES.has(scope as VocabularyAiBudget['scope']);
