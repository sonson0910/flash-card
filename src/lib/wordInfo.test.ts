import { describe, expect, it } from 'vitest';
import { parseStoryInfo, parseWordInfo } from './wordInfo';

describe('parseWordInfo', () => {
  it('validates required AI fields and bounds enrichment arrays', () => {
    const result = parseWordInfo({
      translation: 'chạy',
      explanation: 'Move quickly on foot.',
      explanationTranslation: 'Di chuyển nhanh bằng chân.',
      phonetic: '/rʌn/',
      emoji: '🏃',
      category: 'Action',
      partOfSpeech: 'verb',
      cefrLevel: 'A1',
      exampleSentence: 'I run every morning.',
      exampleTranslation: 'Tôi chạy mỗi sáng.',
      collocations: ['run fast', 'run daily', 'run a business', 'run late', 'ignored'],
      synonyms: ['sprint'],
      antonyms: ['walk'],
      register: 'neutral',
      commonMistake: '',
      imageSearchQuery: 'person sprinting outdoors running shoes',
    });

    expect(result.collocations).toHaveLength(4);
    expect(result.cefrLevel).toBe('A1');
    expect(result.imageSearchQuery).toBe('person sprinting outdoors running shoes');
  });

  it('rejects malformed required AI output', () => {
    expect(() => parseWordInfo({ translation: 42 })).toThrow('Invalid AI word data');
  });
});

describe('parseStoryInfo', () => {
  it('validates generated story output before rendering', () => {
    expect(parseStoryInfo({ story: 'A short story.', translation: 'Một câu chuyện ngắn.' })).toEqual({
      story: 'A short story.',
      translation: 'Một câu chuyện ngắn.',
    });
    expect(() => parseStoryInfo({ story: [], translation: 'invalid' })).toThrow('Invalid AI word data');
  });
});
