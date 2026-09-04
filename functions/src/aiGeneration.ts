type AiVocabularyAction = 'word' | 'story' | 'translate' | 'tutor' | 'mnemonic' | 'extract' | 'dialogue';

export const MAX_AI_OUTPUT_TOKENS: Readonly<Record<AiVocabularyAction, number>> = Object.freeze({
  word: 2_048,
  story: 1_024,
  translate: 1_536,
  tutor: 1_024,
  mnemonic: 512,
  extract: 1_536,
  dialogue: 2_048,
});

export const createAiGenerationConfig = <T extends object>(
  action: AiVocabularyAction,
  baseConfig?: T,
): T & { maxOutputTokens: number } => ({
  ...(baseConfig ?? {} as T),
  maxOutputTokens: MAX_AI_OUTPUT_TOKENS[action],
});
