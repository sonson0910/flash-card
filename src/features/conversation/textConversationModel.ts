import { SCHEMA_V3_LIMITS } from '../multilingual/schemaV3';

export const TEXT_CONVERSATION_LIMITS = Object.freeze({
  maximumCards: 5,
  maximumTurns: 6,
  maximumRequestHistoryMessages: 10,
  maximumSessionMessages: 12,
  maximumMessageCharacters: 500,
  maximumReplyCharacters: 800,
  maximumTranslationCharacters: 800,
  maximumCorrectionCharacters: 300,
} as const);

export interface TextConversationTargetV1 {
  readonly id: string;
  readonly word: string;
  readonly translation: string;
}

export interface TextConversationMissionV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly title: string;
  readonly goal: string;
  readonly cards: readonly TextConversationTargetV1[];
}

export interface TextConversationCorrectionV1 {
  readonly original: string;
  readonly corrected: string;
  readonly explanation: string;
}

export interface TextConversationResponseV1 {
  readonly reply: string;
  readonly translation?: string;
  readonly correction: TextConversationCorrectionV1 | null;
  readonly sessionComplete: boolean;
  readonly nextPrompt?: string;
}

export type TextConversationRoleV1 = 'user' | 'assistant';

export interface TextConversationMessageV1 {
  readonly role: TextConversationRoleV1;
  readonly text: string;
  readonly translation?: string;
  readonly correction?: TextConversationCorrectionV1 | null;
  readonly nextPrompt?: string;
}

export interface TextConversationRequestV1 {
  readonly sessionId: string;
  readonly mission: TextConversationMissionV1;
  readonly turn: number;
  readonly history: readonly Pick<TextConversationMessageV1, 'role' | 'text'>[];
  readonly userMessage: string;
}

export type TextConversationSessionStatusV1 = 'active' | 'completed' | 'failed';

export type TextConversationFailureCodeV1 =
  | 'offline-unavailable'
  | 'authentication-required'
  | 'quota-exceeded'
  | 'network-error'
  | 'provider-failure'
  | 'invalid-response'
  | 'session-complete';

export interface TextConversationSessionV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly mission: TextConversationMissionV1;
  readonly status: TextConversationSessionStatusV1;
  /** The next learner turn number; starts at one and ends at seven. */
  readonly turn: number;
  readonly messages: readonly TextConversationMessageV1[];
  readonly lastError: TextConversationFailureCodeV1 | null;
}

// ponytail: keep session state local and bounded; add a signed server session token only if cross-device enforcement is required.

export interface TextProductionEvidenceCandidateV1 {
  readonly target: { readonly kind: 'lexeme'; readonly id: string };
  readonly skill: 'production';
  readonly source: 'text-production';
  readonly activityId: string;
  readonly score: 1;
}

export class TextConversationStateError extends Error {
  constructor(readonly code: TextConversationFailureCodeV1) {
    super(code);
    this.name = 'TextConversationStateError';
  }
}

export const classifyTextConversationError = (error: unknown): TextConversationFailureCodeV1 => {
  if (error instanceof TextConversationStateError) return error.code;
  const source = error && typeof error === 'object'
    ? error as { code?: unknown; kind?: unknown; retryable?: unknown; message?: unknown }
    : {};
  const code = String(source.code ?? '').toLocaleLowerCase().replace(/^firebase\//, '').replace(/^functions\//, '');
  const kind = String(source.kind ?? '').toLocaleLowerCase();
  const message = String(source.message ?? error ?? '').toLocaleLowerCase();
  if (code === 'unauthenticated' || kind === 'authentication') return 'authentication-required';
  if (code === 'resource-exhausted' || code === 'quota-exceeded' || kind === 'quota') return 'quota-exceeded';
  if (source.retryable === true || kind === 'network'
    || ['cancelled', 'deadline-exceeded', 'network-request-failed', 'unavailable'].includes(code)) {
    return 'network-error';
  }
  if (message.includes('invalid ai text conversation') || message.includes('invalid-response')) {
    return 'invalid-response';
  }
  return 'provider-failure';
};

const normalizeText = (value: string, maximum: number): string => (
  value.normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, maximum)
);

const strictText = (value: unknown, maximum: number): string => {
  if (typeof value !== 'string') throw new TextConversationStateError('invalid-response');
  const text = value.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!text || text.length > maximum) throw new TextConversationStateError('invalid-response');
  return text;
};

const normalizeForMatch = (value: string): string => normalizeText(value, TEXT_CONVERSATION_LIMITS.maximumMessageCharacters)
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();

const assertId = (value: string): string => {
  if (typeof value !== 'string') throw new TextConversationStateError('invalid-response');
  const id = value.normalize('NFKC').trim();
  if (!id || id.length > SCHEMA_V3_LIMITS.id || id.includes('/') || /[\u0000-\u001F\u007F]/.test(id)) {
    throw new TextConversationStateError('invalid-response');
  }
  return id;
};

const assertMission = (mission: TextConversationMissionV1): TextConversationMissionV1 => {
  if (mission.schemaVersion !== 1) throw new TextConversationStateError('invalid-response');
  const id = assertId(mission.id);
  const title = normalizeText(mission.title, SCHEMA_V3_LIMITS.shortText);
  const goal = normalizeText(mission.goal, SCHEMA_V3_LIMITS.shortText);
  if (!title || !goal || !Array.isArray(mission.cards)
    || mission.cards.length === 0
    || mission.cards.length > TEXT_CONVERSATION_LIMITS.maximumCards) {
    throw new TextConversationStateError('invalid-response');
  }
  const ids = new Set<string>();
  const cards = mission.cards.map(card => {
    const cardId = assertId(card.id);
    const word = normalizeText(card.word, 80);
    const translation = normalizeText(card.translation, 256);
    if (!word || !translation || ids.has(cardId)) {
      throw new TextConversationStateError('invalid-response');
    }
    ids.add(cardId);
    return { id: cardId, word, translation };
  });
  return { schemaVersion: 1, id, title, goal, cards };
};

export const createTextConversationMission = (
  cards: readonly TextConversationTargetV1[],
  options: { readonly id?: string; readonly title?: string; readonly goal?: string } = {},
): TextConversationMissionV1 => assertMission({
  schemaVersion: 1,
  id: options.id ?? 'vocabulary-mission',
  title: options.title ?? 'Vocabulary mission',
  goal: options.goal ?? 'Use the target words in a natural conversation.',
  cards: cards.slice(0, TEXT_CONVERSATION_LIMITS.maximumCards),
});

export const createTextConversationSession = (
  mission: TextConversationMissionV1,
  sessionId = mission.id,
): TextConversationSessionV1 => ({
  schemaVersion: 1,
  id: assertId(sessionId),
  mission: assertMission(mission),
  status: 'active',
  turn: 1,
  messages: [],
  lastError: null,
});

const assertUserMessage = (value: string): string => {
  const message = normalizeText(value, TEXT_CONVERSATION_LIMITS.maximumMessageCharacters);
  if (!message) throw new TextConversationStateError('invalid-response');
  return message;
};

export const buildTextConversationRequest = (
  session: TextConversationSessionV1,
  userMessage: string,
  options: { readonly isOffline?: boolean } = {},
): TextConversationRequestV1 => {
  if (options.isOffline) throw new TextConversationStateError('offline-unavailable');
  if (session.status === 'completed' || session.turn > TEXT_CONVERSATION_LIMITS.maximumTurns) {
    throw new TextConversationStateError('session-complete');
  }
  if (session.status !== 'active') {
    throw new TextConversationStateError(session.lastError ?? 'provider-failure');
  }
  if (session.messages.length > TEXT_CONVERSATION_LIMITS.maximumSessionMessages
    || session.messages.length !== (session.turn - 1) * 2
    || session.messages.length > TEXT_CONVERSATION_LIMITS.maximumRequestHistoryMessages) {
    throw new TextConversationStateError('invalid-response');
  }
  if (session.messages.some((message, index) => message.role !== (index % 2 === 0 ? 'user' : 'assistant'))) {
    throw new TextConversationStateError('invalid-response');
  }
  return {
    sessionId: assertId(session.id),
    mission: assertMission(session.mission),
    turn: session.turn,
    history: session.messages.map(({ role, text }) => ({ role, text })),
    userMessage: assertUserMessage(userMessage),
  };
};

const assertResponse = (response: TextConversationResponseV1): TextConversationResponseV1 => {
  if (!response || typeof response !== 'object') {
    throw new TextConversationStateError('invalid-response');
  }
  const reply = strictText(response.reply, TEXT_CONVERSATION_LIMITS.maximumReplyCharacters);
  if (typeof response.sessionComplete !== 'boolean') {
    throw new TextConversationStateError('invalid-response');
  }
  const translation = response.translation === undefined
    ? undefined
    : strictText(response.translation, TEXT_CONVERSATION_LIMITS.maximumTranslationCharacters);
  const nextPrompt = response.nextPrompt === undefined
    ? undefined
    : strictText(response.nextPrompt, TEXT_CONVERSATION_LIMITS.maximumMessageCharacters);
  let correction: TextConversationCorrectionV1 | null = null;
  if (response.correction !== null && response.correction !== undefined) {
    if (typeof response.correction !== 'object' || Array.isArray(response.correction)) {
      throw new TextConversationStateError('invalid-response');
    }
    correction = {
      original: strictText(response.correction.original, TEXT_CONVERSATION_LIMITS.maximumCorrectionCharacters),
      corrected: strictText(response.correction.corrected, TEXT_CONVERSATION_LIMITS.maximumCorrectionCharacters),
      explanation: strictText(response.correction.explanation, TEXT_CONVERSATION_LIMITS.maximumCorrectionCharacters),
    };
  }
  return {
    reply,
    ...(translation ? { translation } : {}),
    correction,
    sessionComplete: response.sessionComplete,
    ...(nextPrompt ? { nextPrompt } : {}),
  };
};

export const applyTextConversationTurn = (
  session: TextConversationSessionV1,
  userMessage: string,
  response: TextConversationResponseV1,
): { readonly state: TextConversationSessionV1; readonly evidence: readonly TextProductionEvidenceCandidateV1[] } => {
  const requestMessage = assertUserMessage(userMessage);
  const parsedResponse = assertResponse(response);
  if (session.status !== 'active' || session.turn > TEXT_CONVERSATION_LIMITS.maximumTurns) {
    throw new TextConversationStateError('session-complete');
  }
  const messages: readonly TextConversationMessageV1[] = [
    ...session.messages,
    { role: 'user', text: requestMessage },
    {
      role: 'assistant',
      text: parsedResponse.reply,
      ...(parsedResponse.translation ? { translation: parsedResponse.translation } : {}),
      correction: parsedResponse.correction,
      ...(parsedResponse.nextPrompt ? { nextPrompt: parsedResponse.nextPrompt } : {}),
    },
  ];
  if (messages.length > TEXT_CONVERSATION_LIMITS.maximumSessionMessages) {
    throw new TextConversationStateError('session-complete');
  }
  const completed = parsedResponse.sessionComplete || session.turn >= TEXT_CONVERSATION_LIMITS.maximumTurns;
  return {
    state: {
      ...session,
      status: completed ? 'completed' : 'active',
      turn: session.turn + 1,
      messages,
      lastError: null,
    },
    evidence: createTextProductionEvidence(session, requestMessage),
  };
};

export const failTextConversationTurn = (
  session: TextConversationSessionV1,
  code: Exclude<TextConversationFailureCodeV1, 'session-complete'>,
): TextConversationSessionV1 => ({ ...session, status: 'failed', lastError: code });

export const retryTextConversation = (
  session: TextConversationSessionV1,
): TextConversationSessionV1 => ({ ...session, status: 'active', lastError: null });

export const createTextProductionEvidence = (
  session: TextConversationSessionV1,
  userMessage: string,
): readonly TextProductionEvidenceCandidateV1[] => {
  const message = ` ${normalizeForMatch(userMessage)} `;
  return session.mission.cards
    .filter(card => {
      const word = normalizeForMatch(card.word);
      return word.length > 0 && message.includes(` ${word} `);
    })
    .map(card => ({
      target: { kind: 'lexeme' as const, id: card.id },
      skill: 'production' as const,
      source: 'text-production' as const,
      activityId: session.id,
      score: 1 as const,
    }));
};
