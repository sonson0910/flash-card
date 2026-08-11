type AiVocabularyAction = 'word' | 'story' | 'translate';

export const MAX_AI_OUTPUT_TOKENS: Readonly<Record<AiVocabularyAction, number>> = Object.freeze({
  word: 2_048,
  story: 1_024,
  translate: 1_536,
});

export const createAiGenerationConfig = <T extends object>(
  action: AiVocabularyAction,
  baseConfig?: T,
): T & { maxOutputTokens: number } => ({
  ...(baseConfig ?? {} as T),
  maxOutputTokens: MAX_AI_OUTPUT_TOKENS[action],
});
