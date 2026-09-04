export class InputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputValidationError';
  }
}

export type VocabularyRequest =
  | { action: 'word'; word: string; context?: string; language?: { source: string; target: string } }
  | { action: 'story'; words: string[] }
  | { action: 'translate'; text: string }
  | { action: 'tutor'; word: string; translation: string; partOfSpeech?: string; question: string }
  | { action: 'mnemonic'; word: string; translation: string; partOfSpeech?: string }
  | { action: 'extract'; text: string }
  | { action: 'dialogue'; cards: Array<{ word: string; translation: string }> }
  | {
    action: 'conversation';
    sessionId: string;
    mission: {
      schemaVersion: 1;
      id: string;
      title: string;
      goal: string;
      cards: Array<{ id: string; word: string; translation: string }>;
    };
    turn: number;
    history: Array<{ role: 'user' | 'assistant'; text: string }>;
    userMessage: string;
  };

type ImageRequest = { word: string; query: string };

export type SharedCardInput = {
  word: string;
  translation: string;
  explanation: string;
  explanationTranslation: string;
  phonetic: string;
  category: string;
  partOfSpeech: string;
  cefrLevel: string;
  exampleSentence: string;
  exampleTranslation: string;
  collocations: string[];
  synonyms: string[];
  antonyms: string[];
  register: string;
  commonMistake: string;
  imageSearchQuery: string;
  emoji: string;
  audioUrl: string | null;
  imageUrl: string | null;
  mnemonic?: string;
  wordFamily?: SharedCardWordFamily;
};

export type SharedCardWordFamily = Partial<Record<'noun' | 'verb' | 'adj' | 'adv', string>>;

export type CreateSharedDeckRequest = {
  expectedOwnerId?: string;
  category: string;
  cards: SharedCardInput[];
};

export const sharedDeckRequestOwnerMatches = (
  expectedOwnerId: string | undefined,
  authenticatedOwnerId: string,
): boolean => expectedOwnerId !== undefined && expectedOwnerId === authenticatedOwnerId;

export const calculateSharedDeckPayloadBytes = (input: CreateSharedDeckRequest): number =>
  new TextEncoder().encode(JSON.stringify({ category: input.category, cards: input.cards })).byteLength;

export type DuplicateCleanupRequest = {
  action: 'run' | 'status';
  jobId: string;
  dryRun: boolean;
  chunkSize: number;
};

export type LegacyLibraryMigrationRequest = {
  batchSize: number;
  dryRun: boolean;
};

const asRecord = (value: unknown): Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
);

const boundedText = (value: unknown, maximum: number) => typeof value === 'string'
  ? value.trim().slice(0, maximum)
  : '';

const boundedConversationId = (value: unknown, label: string): string => {
  if (typeof value !== 'string') throw new InputValidationError(`${label} is invalid.`);
  const id = value.normalize('NFKC').trim();
  if (!id || id.length > 128 || id.includes('/') || /[\u0000-\u001F\u007F]/.test(id)) {
    throw new InputValidationError(`${label} is invalid.`);
  }
  return id;
};

const strictConversationText = (value: unknown, maximum: number, label: string): string => {
  if (typeof value !== 'string') throw new InputValidationError(`${label} is invalid.`);
  const text = value.normalize('NFKC').trim();
  if (!text || text.length > maximum) throw new InputValidationError(`${label} is invalid.`);
  return text;
};

const assertAllowedFields = (
  source: Record<string, unknown>,
  allowed: readonly string[],
  message: string,
): void => {
  if (Object.keys(source).some(key => !allowed.includes(key))) throw new InputValidationError(message);
};

const parseWordLanguage = (value: unknown): { source: string; target: string } | undefined => {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputValidationError('Word language must be an object.');
  }
  const language = value as Record<string, unknown>;
  assertAllowedFields(language, ['source', 'target'], 'Unsupported word language field.');
  const source = boundedText(language.source, 16).toLowerCase();
  const target = boundedText(language.target, 16).toLowerCase();
  if (!/^[a-z]{2,8}(?:-[a-z]{2,8})?$/.test(source)
    || !/^[a-z]{2,8}(?:-[a-z]{2,8})?$/.test(target)) {
    throw new InputValidationError('Word language codes are invalid.');
  }
  return { source, target };
};

const boundedTextList = (value: unknown): string[] => Array.isArray(value)
  ? value.slice(0, 4).flatMap(item => {
      const text = boundedText(item, 100);
      return text ? [text] : [];
    })
  : [];

const boundedWordFamily = (value: unknown): SharedCardWordFamily | undefined => {
  const source = asRecord(value);
  const family: SharedCardWordFamily = {};
  for (const key of ['noun', 'verb', 'adj', 'adv'] as const) {
    const text = boundedText(source[key], 100);
    if (text) family[key] = text;
  }
  return Object.keys(family).length > 0 ? family : undefined;
};

const trustedHttpsUrl = (
  value: unknown,
  allowedHosts: ReadonlySet<string>,
  label: string,
): string | null => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2_048) {
    throw new InputValidationError(`A shared card contains an invalid ${label} URL.`);
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) {
      throw new Error('untrusted');
    }
    return url.toString();
  } catch {
    throw new InputValidationError(`A shared card contains an untrusted ${label} URL.`);
  }
};

const SHARED_IMAGE_HOSTS = new Set([
  'images.pexels.com',
  'images.unsplash.com',
  'upload.wikimedia.org',
]);
const SHARED_AUDIO_HOSTS = new Set([
  'api.dictionaryapi.dev',
  'ssl.gstatic.com',
]);

const parseVocabularyCardInput = (
  value: unknown,
  action: 'tutor' | 'mnemonic',
): { word: string; translation: string; partOfSpeech?: string } => {
  const input = asRecord(value);
  assertAllowedFields(input, ['word', 'translation', 'partOfSpeech', ...(action === 'tutor' ? ['question'] : [])],
    `Unsupported ${action} input field.`);
  const word = boundedText(input.word, 80);
  const translation = boundedText(input.translation, 256);
  if (!word || !translation) throw new InputValidationError(`${action} requires a word and translation.`);
  const partOfSpeech = boundedText(input.partOfSpeech, 64);
  return { word, translation, ...(partOfSpeech ? { partOfSpeech } : {}) };
};

const parseDialogueCards = (value: unknown): Array<{ word: string; translation: string }> => {
  if (!Array.isArray(value)) throw new InputValidationError('A dialogue requires vocabulary cards.');
  if (value.length === 0) throw new InputValidationError('A dialogue requires at least one card.');
  if (value.length > 5) throw new InputValidationError('A dialogue can contain at most five cards.');
  return value.map(rawCard => {
    const card = asRecord(rawCard);
    assertAllowedFields(card, ['word', 'translation'], 'Unsupported dialogue card field.');
    const word = boundedText(card.word, 80);
    const translation = boundedText(card.translation, 256);
    if (!word || !translation) throw new InputValidationError('Every dialogue card requires word and translation.');
    return { word, translation };
  });
};

const parseConversationMission = (value: unknown): {
  schemaVersion: 1;
  id: string;
  title: string;
  goal: string;
  cards: Array<{ id: string; word: string; translation: string }>;
} => {
  const mission = asRecord(value);
  assertAllowedFields(mission, ['schemaVersion', 'id', 'title', 'goal', 'cards'], 'Unsupported conversation mission field.');
  if (mission.schemaVersion !== 1) throw new InputValidationError('Conversation mission schema is unsupported.');
  const id = boundedConversationId(mission.id, 'Conversation mission id');
  const title = strictConversationText(mission.title, 256, 'Conversation mission title');
  const goal = strictConversationText(mission.goal, 256, 'Conversation mission goal');
  if (!Array.isArray(mission.cards) || mission.cards.length === 0) {
    throw new InputValidationError('A conversation mission requires at least one card.');
  }
  if (mission.cards.length > 5) throw new InputValidationError('A conversation mission can contain at most five cards.');
  const ids = new Set<string>();
  const cards = mission.cards.map(rawCard => {
    const card = asRecord(rawCard);
    assertAllowedFields(card, ['id', 'word', 'translation'], 'Unsupported conversation mission card field.');
    const cardId = boundedConversationId(card.id, 'Conversation mission card id');
    const word = strictConversationText(card.word, 80, 'Conversation mission card word');
    const translation = strictConversationText(card.translation, 256, 'Conversation mission card translation');
    if (!word || !translation) throw new InputValidationError('Every conversation mission card requires a word and translation.');
    if (ids.has(cardId)) throw new InputValidationError('Conversation mission card ids must be unique.');
    ids.add(cardId);
    return { id: cardId, word, translation };
  });
  return { schemaVersion: 1, id, title, goal, cards };
};

const parseConversationHistory = (value: unknown): Array<{ role: 'user' | 'assistant'; text: string }> => {
  if (!Array.isArray(value)) throw new InputValidationError('Conversation history must be an array.');
  if (value.length > 10) throw new InputValidationError('Conversation history is too long.');
  return value.map((rawMessage, index) => {
    const message = asRecord(rawMessage);
    assertAllowedFields(message, ['role', 'text'], 'Unsupported conversation history field.');
    const role = strictConversationText(message.role, 9, 'Conversation history role');
    if (role !== (index % 2 === 0 ? 'user' : 'assistant')) {
      throw new InputValidationError('Conversation history must alternate user and assistant turns.');
    }
    const text = strictConversationText(message.text, 500, 'Conversation history message');
    return { role, text } as { role: 'user' | 'assistant'; text: string };
  });
};

const parseConversationInput = (value: unknown): {
  sessionId: string;
  mission: {
    schemaVersion: 1;
    id: string;
    title: string;
    goal: string;
    cards: Array<{ id: string; word: string; translation: string }>;
  };
  turn: number;
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  userMessage: string;
} => {
  const input = asRecord(value);
  assertAllowedFields(input, ['sessionId', 'mission', 'turn', 'history', 'userMessage'], 'Unsupported conversation input field.');
  const sessionId = boundedConversationId(input.sessionId, 'Conversation session id');
  const turn = input.turn;
  if (typeof turn !== 'number' || !Number.isSafeInteger(turn) || turn < 1 || turn > 6) {
    throw new InputValidationError('Conversation turn must be between 1 and 6.');
  }
  const history = parseConversationHistory(input.history);
  if (history.length !== (turn - 1) * 2) {
    throw new InputValidationError('Conversation history does not match the turn.');
  }
  const userMessage = strictConversationText(input.userMessage, 500, 'A conversation message');
  return { sessionId, mission: parseConversationMission(input.mission), turn, history, userMessage };
};

export const parseVocabularyRequest = (value: unknown): VocabularyRequest => {
  const data = asRecord(value);
  assertAllowedFields(data, ['action', 'input'], 'Unsupported vocabulary request field.');
  const action = boundedText(data.action, 16);

  if (action === 'word') {
    if (typeof data.input === 'string') {
      const word = boundedText(data.input, 80);
      if (!word) throw new InputValidationError('A word is required.');
      return { action, word };
    }
    if (!data.input || typeof data.input !== 'object' || Array.isArray(data.input)) {
      throw new InputValidationError('A word is required.');
    }
    const input = data.input as Record<string, unknown>;
    assertAllowedFields(input, ['term', 'context', 'language'], 'Unsupported word input field.');
    const word = boundedText(input.term, 80);
    if (!word) throw new InputValidationError('A word is required.');
    if (input.context !== undefined && typeof input.context !== 'string') {
      throw new InputValidationError('Word context must be a string.');
    }
    const context = boundedText(input.context, 500).replace(/\s+/g, ' ');
    const language = parseWordLanguage(input.language);
    return {
      action,
      word,
      ...(context ? { context } : {}),
      ...(language ? { language } : {}),
    };
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

  if (action === 'tutor') {
    const input = asRecord(data.input);
    const card = parseVocabularyCardInput(input, action);
    const question = boundedText(input.question, 500);
    if (!question) throw new InputValidationError('A tutor question is required.');
    return { action, ...card, question };
  }

  if (action === 'mnemonic') {
    return { action, ...parseVocabularyCardInput(data.input, action) };
  }

  if (action === 'extract') {
    const text = boundedText(data.input, 2_000);
    if (!text) throw new InputValidationError('Text is required.');
    return { action, text };
  }

  if (action === 'dialogue') {
    return { action, cards: parseDialogueCards(data.input) };
  }

  if (action === 'conversation') {
    return { action, ...parseConversationInput(data.input) };
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

export const parseCreateSharedDeckRequest = (value: unknown): CreateSharedDeckRequest => {
  const data = asRecord(value);
  if (!Array.isArray(data.cards) || data.cards.length === 0) {
    throw new InputValidationError('A shared deck must contain at least one card.');
  }
  if (data.cards.length > 100) {
    throw new InputValidationError('A shared deck can contain at most 100 cards.');
  }

  const cards = data.cards.map((rawCard): SharedCardInput => {
    const card = asRecord(rawCard);
    const word = boundedText(card.word, 256);
    const translation = boundedText(card.translation, 256);
    if (!word || !translation) {
      throw new InputValidationError('Every shared card requires a word and translation.');
    }
    const mnemonic = boundedText(card.mnemonic, 2_048);
    const wordFamily = boundedWordFamily(card.wordFamily);
    return {
      word,
      translation,
      explanation: boundedText(card.explanation, 2_048),
      explanationTranslation: boundedText(card.explanationTranslation, 2_048),
      phonetic: boundedText(card.phonetic, 256),
      category: boundedText(card.category, 128),
      partOfSpeech: boundedText(card.partOfSpeech, 64),
      cefrLevel: boundedText(card.cefrLevel, 8),
      exampleSentence: boundedText(card.exampleSentence, 2_048),
      exampleTranslation: boundedText(card.exampleTranslation, 2_048),
      collocations: boundedTextList(card.collocations),
      synonyms: boundedTextList(card.synonyms),
      antonyms: boundedTextList(card.antonyms),
      register: boundedText(card.register, 64),
      commonMistake: boundedText(card.commonMistake, 2_048),
      imageSearchQuery: boundedText(card.imageSearchQuery, 120),
      emoji: boundedText(card.emoji, 64),
      audioUrl: trustedHttpsUrl(card.audioUrl, SHARED_AUDIO_HOSTS, 'audio'),
      imageUrl: trustedHttpsUrl(card.imageUrl, SHARED_IMAGE_HOSTS, 'image'),
      ...(mnemonic ? { mnemonic } : {}),
      ...(wordFamily ? { wordFamily } : {}),
    };
  });
  const category = boundedText(data.category, 128) || 'Shared';
  const expectedOwnerId = typeof data.expectedOwnerId === 'string'
    && data.expectedOwnerId.length > 0
    && data.expectedOwnerId.length <= 128
    ? data.expectedOwnerId
    : '';
  const normalized = {
    ...(expectedOwnerId ? { expectedOwnerId } : {}),
    category,
    cards,
  };
  if (calculateSharedDeckPayloadBytes(normalized) > 750_000) {
    throw new InputValidationError('The shared deck is too large.');
  }
  return normalized;
};

export const parseRevokeSharedDeckRequest = (value: unknown): { shareId: string } => {
  const shareId = boundedText(asRecord(value).shareId, 128);
  if (!shareId || !/^[a-zA-Z0-9_-]+$/.test(shareId)) {
    throw new InputValidationError('A valid share ID is required.');
  }
  return { shareId };
};

export const parseDuplicateCleanupRequest = (value: unknown): DuplicateCleanupRequest => {
  const data = asRecord(value);
  const action = boundedText(data.action, 16) || 'run';
  if (action !== 'run' && action !== 'status') {
    throw new InputValidationError('Unsupported duplicate cleanup action.');
  }
  const jobId = boundedText(data.jobId, 48);
  if (!jobId || !/^[a-zA-Z0-9_-]+$/.test(jobId)) {
    throw new InputValidationError('A valid cleanup job ID is required.');
  }
  const requestedChunkSize = typeof data.chunkSize === 'number' && Number.isFinite(data.chunkSize)
    ? Math.floor(data.chunkSize)
    : 50;
  return {
    action,
    jobId,
    dryRun: data.dryRun === false ? false : true,
    chunkSize: Math.max(10, Math.min(100, requestedChunkSize)),
  };
};

export const parseLegacyLibraryMigrationRequest = (
  value: unknown,
): LegacyLibraryMigrationRequest => {
  const data = asRecord(value);
  const allowed = new Set(['batchSize', 'dryRun']);
  if (Object.keys(data).some(key => !allowed.has(key))) {
    throw new InputValidationError('Unsupported library migration field.');
  }
  if (data.batchSize !== undefined && (
    typeof data.batchSize !== 'number' || !Number.isFinite(data.batchSize)
  )) {
    throw new InputValidationError('Library migration batchSize must be a finite number.');
  }
  if (data.dryRun !== undefined && typeof data.dryRun !== 'boolean') {
    throw new InputValidationError('Library migration dryRun must be a boolean.');
  }
  const requestedBatchSize = data.batchSize === undefined ? 100 : Math.floor(data.batchSize);
  return {
    batchSize: Math.max(10, Math.min(100, requestedBatchSize)),
    dryRun: data.dryRun === undefined ? true : data.dryRun,
  };
};
