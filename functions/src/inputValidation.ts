export class InputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputValidationError';
  }
}

type VocabularyRequest =
  | { action: 'word'; word: string }
  | { action: 'story'; words: string[] }
  | { action: 'translate'; text: string };

type ImageRequest = { word: string; query: string };

const asRecord = (value: unknown): Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
);

const boundedText = (value: unknown, maximum: number) => typeof value === 'string'
  ? value.trim().slice(0, maximum)
  : '';

export const parseVocabularyRequest = (value: unknown): VocabularyRequest => {
  const data = asRecord(value);
  const action = boundedText(data.action, 16);

  if (action === 'word') {
    const word = boundedText(data.input, 80);
    if (!word) throw new InputValidationError('A word is required.');
    return { action, word };
  }

  if (action === 'story') {
    if (!Array.isArray(data.input)) {
      throw new InputValidationError('At least one word is required.');
    }
    if (data.input.length > 5) {
      throw new InputValidationError('A story can contain at most five words.');
    }
    const words = data.input.map(item => boundedText(item, 80)).filter(Boolean);
    if (words.length === 0) throw new InputValidationError('At least one word is required.');
    return { action, words };
  }

  if (action === 'translate') {
    const text = boundedText(data.input, 2_048);
    if (!text) throw new InputValidationError('Text is required.');
    return { action, text };
  }

  throw new InputValidationError('Unsupported AI action.');
};

export const parseImageRequest = (value: unknown): ImageRequest => {
  const data = asRecord(value);
  const word = boundedText(data.word, 80);
  if (!word) throw new InputValidationError('A word is required.');
  const query = boundedText(data.query, 160) || word;
  return { word, query };
};
