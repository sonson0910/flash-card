import {
  TEXT_CONVERSATION_LIMITS,
  type TextConversationCorrectionV1,
  type TextConversationResponseV1,
} from '../features/conversation/textConversationModel';

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

const assertExactFields = (
  source: Record<string, unknown>,
  allowed: readonly string[],
  error: string,
): void => {
  if (Object.keys(source).some(key => !allowed.includes(key))) throw new Error(error);
};

const conversationText = (value: unknown, maximum: number, error: string): string => {
  if (typeof value !== 'string') throw new Error(error);
  const text = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!text || text.length > maximum) throw new Error(error);
  return text;
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

export const parseTextConversationResponse = (value: unknown): TextConversationResponseV1 => {
  const source = record(value);
  assertExactFields(
    source,
    ['reply', 'translation', 'correction', 'sessionComplete', 'nextPrompt'],
    'Unsupported AI text conversation response field.',
  );
  const reply = conversationText(
    source.reply,
    TEXT_CONVERSATION_LIMITS.maximumReplyCharacters,
    'Invalid AI text conversation response.',
  );
  if (typeof source.sessionComplete !== 'boolean') {
    throw new Error('Invalid AI text conversation response.');
  }
  const translation = source.translation === undefined
    ? undefined
    : conversationText(
      source.translation,
      TEXT_CONVERSATION_LIMITS.maximumTranslationCharacters,
      'Invalid AI text conversation response.',
    );
  let correction: TextConversationCorrectionV1 | null = null;
  if (source.correction !== undefined && source.correction !== null) {
    const correctionSource = record(source.correction);
    assertExactFields(
      correctionSource,
      ['original', 'corrected', 'explanation'],
      'Unsupported AI text conversation correction field.',
    );
    correction = {
      original: conversationText(
        correctionSource.original,
        TEXT_CONVERSATION_LIMITS.maximumCorrectionCharacters,
        'Invalid AI text conversation correction.',
      ),
      corrected: conversationText(
        correctionSource.corrected,
        TEXT_CONVERSATION_LIMITS.maximumCorrectionCharacters,
        'Invalid AI text conversation correction.',
      ),
      explanation: conversationText(
        correctionSource.explanation,
        TEXT_CONVERSATION_LIMITS.maximumCorrectionCharacters,
        'Invalid AI text conversation correction.',
      ),
    };
  }
  const nextPrompt = source.nextPrompt === undefined
    ? undefined
    : conversationText(
      source.nextPrompt,
      TEXT_CONVERSATION_LIMITS.maximumMessageCharacters,
      'Invalid AI text conversation response.',
    );
  return {
    reply,
    ...(translation ? { translation } : {}),
    correction,
    sessionComplete: source.sessionComplete,
    ...(nextPrompt ? { nextPrompt } : {}),
  };
};
