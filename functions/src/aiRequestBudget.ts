export type VocabularyAiAction = 'word' | 'story' | 'translate' | 'tutor' | 'mnemonic' | 'extract' | 'dialogue' | 'conversation';

export interface VocabularyAiBudget {
  scope: 'ai-card' | 'ai-story' | 'ai-translate' | 'ai-tutor' | 'ai-mnemonic' | 'ai-extract' | 'ai-dialogue' | 'ai-conversation';
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
  tutor: {
    scope: 'ai-tutor',
    maximum: 60,
    message: 'Tutor request limit reached. Try again later.',
  },
  mnemonic: {
    scope: 'ai-mnemonic',
    maximum: 60,
    message: 'Mnemonic request limit reached. Try again later.',
  },
  extract: {
    scope: 'ai-extract',
    maximum: 30,
    message: 'Vocabulary extraction limit reached. Try again later.',
  },
  dialogue: {
    scope: 'ai-dialogue',
    maximum: 30,
    message: 'Dialogue generation limit reached. Try again later.',
  },
  conversation: {
    scope: 'ai-conversation',
    maximum: 24,
    message: 'Conversation limit reached. Try again later.',
  },
};

const VOCABULARY_AI_SCOPES = new Set(
  Object.values(VOCABULARY_AI_BUDGETS).map(budget => budget.scope),
);

export const getVocabularyAiBudget = (action: VocabularyAiAction): VocabularyAiBudget =>
  VOCABULARY_AI_BUDGETS[action];

export const isVocabularyAiRateLimitScope = (scope: string): boolean =>
  VOCABULARY_AI_SCOPES.has(scope as VocabularyAiBudget['scope']);
