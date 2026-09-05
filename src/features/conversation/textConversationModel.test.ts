import { describe, expect, it } from 'vitest';
import {
  TextConversationStateError,
  applyTextConversationTurn,
  buildTextConversationRequest,
  classifyTextConversationError,
  createTextConversationSession,
  createTextProductionEvidence,
  type TextConversationMissionV1,
  type TextConversationResponseV1,
} from './textConversationModel';

const mission: TextConversationMissionV1 = {
  schemaVersion: 1,
  id: 'cafe-mission',
  title: 'At the café',
  goal: 'Order a drink and ask one follow-up question.',
  cards: [
    { id: 'lexeme-coffee', word: 'coffee', translation: 'cà phê' },
    { id: 'lexeme-menu', word: 'menu', translation: 'thực đơn' },
  ],
};

const response: TextConversationResponseV1 = {
  reply: 'Great choice. Would you like to see the menu?',
  translation: 'Lựa chọn tuyệt vời. Bạn có muốn xem thực đơn không?',
  correction: null,
  sessionComplete: false,
  nextPrompt: 'Ask for the menu.',
};

describe('bounded text conversation model', () => {
  it('advances exactly six learner turns and then stops', () => {
    let session = createTextConversationSession(mission, 'session-1');

    for (let turn = 1; turn <= 6; turn += 1) {
      const request = buildTextConversationRequest(session, `I want coffee ${turn}.`);
      expect(request).toMatchObject({
        sessionId: 'session-1',
        turn,
        userMessage: `I want coffee ${turn}.`,
      });
      const applied = applyTextConversationTurn(session, request.userMessage, {
        ...response,
        sessionComplete: turn === 6,
      });
      session = applied.state;
      expect(session.turn).toBe(turn + 1);
      expect(session.status).toBe(turn === 6 ? 'completed' : 'active');
      expect(session.messages.at(-1)?.nextPrompt).toBe('Ask for the menu.');
    }

    expect(() => buildTextConversationRequest(session, 'One more turn.'))
      .toThrowError(new TextConversationStateError('session-complete'));
    expect(session.messages).toHaveLength(12);
  });

  it('fails deterministically offline without constructing a network request', () => {
    const session = createTextConversationSession(mission, 'session-1');
    expect(() => buildTextConversationRequest(session, 'Hello.', { isOffline: true }))
      .toThrowError(new TextConversationStateError('offline-unavailable'));
  });

  it('derives only exact target usage as text-production evidence', () => {
    const session = createTextConversationSession(mission, 'session-1');
    const observations = createTextProductionEvidence(session, 'Please show me the menu, thanks.');

    expect(observations).toEqual([{
      target: { kind: 'lexeme', id: 'lexeme-menu' },
      skill: 'production',
      source: 'text-production',
      activityId: 'session-1',
      score: 1,
    }]);
    expect(createTextProductionEvidence(session, 'I need a coffeehouse.')).toEqual([]);
    expect(observations[0]).not.toHaveProperty('rating');
    expect(observations[0]).not.toHaveProperty('fsrs');
  });

  it('rejects a malformed response before it can be appended', () => {
    const session = createTextConversationSession(mission, 'session-1');
    expect(() => applyTextConversationTurn(session, 'Hello.', {
      ...response,
      reply: 'x'.repeat(801),
    })).toThrowError(new TextConversationStateError('invalid-response'));
  });

  it('keeps a provider reply up to 800 characters in the next request history', () => {
    const session = createTextConversationSession(mission, 'session-1');
    const reply = 'x'.repeat(800);
    const applied = applyTextConversationTurn(session, 'Hello.', {
      ...response,
      reply,
    });

    expect(buildTextConversationRequest(applied.state, 'Can I see the menu?').history).toEqual([
      { role: 'user', text: 'Hello.' },
      { role: 'assistant', text: reply },
    ]);
  });

  it('classifies unsupported conversation response fields as invalid responses', () => {
    expect(classifyTextConversationError(new Error('Unsupported AI text conversation response field.')))
      .toBe('invalid-response');
  });
});
