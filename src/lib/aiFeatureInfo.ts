export interface ExtractedWordItem {
  word: string;
  translation: string;
  partOfSpeech: string;
  cefrLevel: string;
  example: string;
}

export interface DialogueTurn {
  speaker: string;
  en: string;
  vi: string;
}

export interface DialogueResult {
  title: string;
  context: string;
  turns: DialogueTurn[];
}

const record = (value: unknown): Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
);

const requiredText = (source: Record<string, unknown>, key: string, maximum: number, error: string): string => {
  const value = source[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(error);
  return value.trim().slice(0, maximum);
};

export const parseTutorAnswer = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid AI tutor response.');
  return value.trim().slice(0, 4_096);
};

export const parseMnemonic = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid AI mnemonic response.');
  return value.trim().slice(0, 2_048);
};

export const parseExtractedWords = (value: unknown): ExtractedWordItem[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10) {
    throw new Error('Invalid AI extracted words response.');
  }
  return value.map(item => {
    const source = record(item);
    const word = requiredText(source, 'word', 80, 'Invalid AI extracted word.');
    const translation = requiredText(source, 'translation', 256, 'Invalid AI extracted word.');
    const partOfSpeech = requiredText(source, 'partOfSpeech', 64, 'Invalid AI extracted word.');
    const cefrLevel = requiredText(source, 'cefrLevel', 8, 'Invalid AI extracted word.');
    if (!/^(A1|A2|B1|B2|C1|C2)$/.test(cefrLevel)) throw new Error('Invalid AI extracted word.');
    const example = requiredText(source, 'example', 500, 'Invalid AI extracted word.');
    return { word, translation, partOfSpeech, cefrLevel, example };
  });
};

export const parseDialogue = (value: unknown): DialogueResult => {
  const source = record(value);
  const title = requiredText(source, 'title', 160, 'Invalid AI dialogue response.');
  const context = requiredText(source, 'context', 500, 'Invalid AI dialogue response.');
  if (!Array.isArray(source.turns) || source.turns.length < 4 || source.turns.length > 6) {
    throw new Error('Invalid AI dialogue response.');
  }
  const turns = source.turns.map(item => {
    const turn = record(item);
    return {
      speaker: requiredText(turn, 'speaker', 40, 'Invalid AI dialogue response.'),
      en: requiredText(turn, 'en', 500, 'Invalid AI dialogue response.'),
      vi: requiredText(turn, 'vi', 500, 'Invalid AI dialogue response.'),
    };
  });
  return { title, context, turns };
};
