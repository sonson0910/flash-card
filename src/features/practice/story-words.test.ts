import { describe, expect, it } from 'vitest';
import type { CardData } from '../../types/card';
import { cardDueInDays, storyReadMinutes, storyTextParts } from './story-words';

const card = (id: string, word: string, extra: Partial<CardData> = {}): CardData => ({
  id, word, translation: `${word} meaning`, explanation: '', phonetic: '', emoji: '', category: '', audioUrl: null, imageUrl: null, ...extra,
});

const marked = (parts: ReturnType<typeof storyTextParts>) => parts.map(part => (part.cardId ? `[${part.text}]` : part.text)).join('');

describe('story words', () => {
  it('marks every occurrence of a card word, keeping the rest of the text intact', () => {
    const parts = storyTextParts('Context helps. Read in context, then adapt.', [card('a', 'context'), card('b', 'adapt')], 'en');
    expect(marked(parts)).toBe('[Context] helps. Read in [context], then [adapt].');
    expect(parts.filter(part => part.cardId === 'a')).toHaveLength(2);
  });

  it('includes a regular ending but not a longer word that only starts or ends the same', () => {
    expect(marked(storyTextParts('She adapted fast, adapts often, and the adaptation was no readapt.', [card('a', 'adapt')], 'en')))
      .toBe('She [adapted] fast, [adapts] often, and the adaptation was no readapt.');
    expect(marked(storyTextParts('The cat’s cats sat on the category list.', [card('c', 'cat')], 'en'))).toBe('The [cat]’s [cats] sat on the category list.');
  });

  it('matches a phrase across any spacing and prefers the longer of two overlapping words', () => {
    const parts = storyTextParts('She took  part in it.', [card('p', 'part'), card('t', 'take part'), card('k', 'took part')], 'en');
    expect(marked(parts)).toBe('She [took  part] in it.');
    expect(parts.find(part => part.cardId)?.cardId).toBe('k');
  });

  it('finds Korean words with their particles and conjugated dictionary forms, but not a one-syllable stem', () => {
    expect(marked(storyTextParts('학교에서 친구와 책을 읽어요.', [card('s', '학교'), card('f', '친구'), card('r', '읽다')], 'ko')))
      .toBe('[학교]에서 [친구]와 책을 읽어요.');
    expect(marked(storyTextParts('시험을 위해 결심했어요. 친구를 기다리고 있어요.', [card('d', '결심하다'), card('w', '기다리다')], 'ko')))
      .toBe('시험을 위해 [결심]했어요. 친구를 [기다리]고 있어요.');
  });

  it('finds words in scripts written without spaces', () => {
    expect(marked(storyTextParts('我今天去学校。', [card('x', '学校')], 'zh'))).toBe('我今天去[学校]。');
  });

  it('returns the text unchanged when no card word appears or a card word is blank', () => {
    expect(storyTextParts('Nothing here.', [card('a', 'adapt'), card('b', '  ')], 'en')).toEqual([{ text: 'Nothing here.' }]);
  });

  it('treats regular-expression characters in a card word literally', () => {
    expect(marked(storyTextParts('Use C++ (often) daily.', [card('c', 'C++'), card('o', '(often)')], 'en'))).toBe('Use [C++] [(often)] daily.');
  });

  it('estimates whole reading minutes, never less than one', () => {
    expect(storyReadMinutes('A short story.', 'en')).toBe(1);
    expect(storyReadMinutes(Array.from({ length: 540 }, () => 'word').join(' '), 'en')).toBe(3);
    expect(storyReadMinutes('学'.repeat(900), 'zh')).toBe(3);
  });

  it('counts the days until a card is due from its schedule', () => {
    const now = Date.parse('2026-09-25T09:00:00.000Z');
    expect(cardDueInDays(card('a', 'a', { nextReviewDate: '2026-09-27T09:00:00.000Z' }), now)).toBe(2);
    expect(cardDueInDays(card('b', 'b', { nextReviewDate: '2026-09-20T09:00:00.000Z' }), now)).toBe(0);
    expect(cardDueInDays(card('c', 'c'), now)).toBeNull();
    expect(cardDueInDays(card('d', 'd', { nextReviewDate: 'not a date' }), now)).toBeNull();
  });
});
