import { InputValidationError } from './inputValidation.js';

// The learner client parses these model answers with its own rules (src/lib/aiFeatureInfo.ts,
// src/lib/wordInfo.ts and src/features/conversation/textConversationModel.ts). The server applies the
// same shape and bound checks so an answer the client would reject fails here, where the daily
// allowance is refunded, instead of reaching the learner as a success the client then throws away.
// Keep both sides in step when a bound changes.

const CONVERSATION_REPLY_MAXIMUM = 800;
const CONVERSATION_TRANSLATION_MAXIMUM = 800;
const CONVERSATION_CORRECTION_MAXIMUM = 300;
const CONVERSATION_MESSAGE_MAXIMUM = 500;
const MAXIMUM_EXTRACTED_ITEMS = 10;
const CEFR_LEVEL = /^(A1|A2|B1|B2|C1|C2)$/;
const MAXIMUM_EXTRACT_SURFACE_LENGTH = 120;

const invalid = (label: string) => new InputValidationError(`${label} response is invalid.`);

const plainRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(label);
  return value as Record<string, unknown>;
};

// Same rule as the client's truncating reader: a non-blank string, trimmed and cut to the bound.
const trimmedText = (source: Record<string, unknown>, key: string, maximum: number, label: string): string => {
  const value = source[key];
  if (typeof value !== 'string' || !value.trim()) throw invalid(label);
  return value.trim().slice(0, maximum);
};

// Same rule as the client's strict conversation reader: normalized, and rejected when over the bound.
const strictText = (value: unknown, maximum: number, label: string): string => {
  if (typeof value !== 'string') throw invalid(label);
  const text = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!text || text.length > maximum) throw invalid(label);
  return text;
};

const assertOnlyKeys = (source: Record<string, unknown>, allowed: readonly string[], label: string) => {
  if (Object.keys(source).some(key => !allowed.includes(key))) throw invalid(label);
};

export const parsePlainStoryOutput = (value: unknown) => {
  const source = plainRecord(value, 'Story');
  return {
    story: trimmedText(source, 'story', 1_000, 'Story'),
    translation: trimmedText(source, 'translation', 1_000, 'Story'),
  };
};

export const parseExtractedWordsOutput = (value: unknown) => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAXIMUM_EXTRACTED_ITEMS) {
    throw invalid('Extracted words');
  }
  return value.map(item => {
    const source = plainRecord(item, 'Extracted words');
    const cefrLevel = trimmedText(source, 'cefrLevel', 8, 'Extracted words');
    if (!CEFR_LEVEL.test(cefrLevel)) throw invalid('Extracted words');
    const surface = typeof source.surface === 'string' ? source.surface.trim() : '';
    return {
      word: trimmedText(source, 'word', 80, 'Extracted words'),
      ...(surface && surface.length <= MAXIMUM_EXTRACT_SURFACE_LENGTH ? { surface } : {}),
      translation: trimmedText(source, 'translation', 256, 'Extracted words'),
      partOfSpeech: trimmedText(source, 'partOfSpeech', 64, 'Extracted words'),
      cefrLevel,
      example: trimmedText(source, 'example', 500, 'Extracted words'),
    };
  });
};

export const parseDialogueOutput = (value: unknown) => {
  const source = plainRecord(value, 'Dialogue');
  if (!Array.isArray(source.turns) || source.turns.length < 4 || source.turns.length > 6) {
    throw invalid('Dialogue');
  }
  return {
    title: trimmedText(source, 'title', 160, 'Dialogue'),
    context: trimmedText(source, 'context', 500, 'Dialogue'),
    turns: source.turns.map(item => {
      const turn = plainRecord(item, 'Dialogue');
      return {
        speaker: trimmedText(turn, 'speaker', 40, 'Dialogue'),
        en: trimmedText(turn, 'en', 500, 'Dialogue'),
        vi: trimmedText(turn, 'vi', 500, 'Dialogue'),
      };
    }),
  };
};

export const parseConversationOutput = (value: unknown) => {
  const label = 'Conversation';
  const source = plainRecord(value, label);
  assertOnlyKeys(source, ['reply', 'translation', 'correction', 'sessionComplete', 'nextPrompt'], label);
  const reply = strictText(source.reply, CONVERSATION_REPLY_MAXIMUM, label);
  if (typeof source.sessionComplete !== 'boolean') throw invalid(label);
  const translation = source.translation === undefined
    ? undefined : strictText(source.translation, CONVERSATION_TRANSLATION_MAXIMUM, label);
  let correction: { original: string; corrected: string; explanation: string } | null = null;
  if (source.correction !== undefined && source.correction !== null) {
    const correctionSource = plainRecord(source.correction, label);
    assertOnlyKeys(correctionSource, ['original', 'corrected', 'explanation'], label);
    correction = {
      original: strictText(correctionSource.original, CONVERSATION_CORRECTION_MAXIMUM, label),
      corrected: strictText(correctionSource.corrected, CONVERSATION_CORRECTION_MAXIMUM, label),
      explanation: strictText(correctionSource.explanation, CONVERSATION_CORRECTION_MAXIMUM, label),
    };
  }
  const nextPrompt = source.nextPrompt === undefined
    ? undefined : strictText(source.nextPrompt, CONVERSATION_MESSAGE_MAXIMUM, label);
  return {
    reply,
    ...(translation ? { translation } : {}),
    correction,
    sessionComplete: source.sessionComplete,
    ...(nextPrompt ? { nextPrompt } : {}),
  };
};
