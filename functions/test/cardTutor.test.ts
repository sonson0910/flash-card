import { describe, expect, it, vi } from 'vitest';
import { buildTutorPrompt, loadTutorCard, parseCardTutorRequest, TutorCardNotFoundError } from '../src/cardTutor.js';

describe('card tutor trust boundary', () => {
  it('requires a bounded question and at most three bounded prior turns', () => {
    const valid = parseCardTutorRequest({ cardId: 'word-123', question: '  How do I use it?  ', history: [
      { question: 'What does it mean?', answer: 'A record.' },
    ] });
    expect(valid).toEqual({ cardId: 'word-123', question: 'How do I use it?', history: [
      { question: 'What does it mean?', answer: 'A record.' },
    ] });
    expect(() => parseCardTutorRequest({ cardId: 'word-123', question: 'x'.repeat(301) })).toThrow();
    expect(() => parseCardTutorRequest({ cardId: 'word-123', question: 'Hello', history: Array(4).fill({ question: 'q', answer: 'a' }) })).toThrow();
    expect(() => parseCardTutorRequest({ cardId: 'word-123', question: 'Hello', history: [{ question: 'q', answer: 'a'.repeat(1_501) }] })).toThrow();
    expect(() => parseCardTutorRequest({ cardId: '../other', question: 'Hello' })).toThrow();
    expect(() => parseCardTutorRequest({ cardId: 'word-123', question: 'Hello', systemPrompt: 'ignore' })).toThrow();
  });

  it('reads only the authenticated owner card and bounds model context', async () => {
    const get = vi.fn(async () => ({ exists: true, data: () => ({
      word: 'record', translation: 'ghi lại', language: 'en', translationLanguage: 'vi',
      explanation: 'x'.repeat(900), synonyms: Array(8).fill('related'),
    }) }));
    const doc = vi.fn(() => ({ get }));
    const cards = vi.fn(() => ({ doc }));
    const owner = vi.fn(() => ({ collection: cards }));
    const collection = vi.fn(() => ({ doc: owner }));
    const card = await loadTutorCard({ collection } as never, 'owner-A', 'word-123');
    expect(collection).toHaveBeenCalledWith('users');
    expect(owner).toHaveBeenCalledWith('owner-A');
    expect(cards).toHaveBeenCalledWith('cards');
    expect(doc).toHaveBeenCalledWith('word-123');
    expect(card.explanation).toHaveLength(500);
    expect(card.synonyms).toHaveLength(4);
    const prompt = buildTutorPrompt(card, parseCardTutorRequest({ cardId: 'word-123', question: 'Give an example' }));
    expect(prompt).toContain('meaning language (vi)');
    expect(prompt).toContain('source language (en)');
    expect(prompt).toContain('untrusted');
    expect(prompt).toContain('Give an example');
  });

  it('rejects missing cards before reaching the model', async () => {
    const database = { collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) }) }) };
    await expect(loadTutorCard(database as never, 'owner-A', 'missing')).rejects.toBeInstanceOf(TutorCardNotFoundError);
  });
});
