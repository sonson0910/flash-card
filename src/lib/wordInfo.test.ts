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
  const story = {
    title: 'A small opportunity',
    segments: [
      { english: 'Mina noticed an opportunity.', vietnamese: 'Mina nhận ra một cơ hội.' },
      { english: 'She took it and learned quickly.', vietnamese: 'Cô ấy nắm lấy và học nhanh chóng.' },
    ],
    comprehension: {
      question: 'What did Mina notice?',
      options: ['An opportunity', 'A storm', 'A train'],
      correctIndex: 0,
      explanationVi: 'Mina nhận ra một cơ hội.',
    },
    grammar: {
      label: 'Past simple transformation',
      explanationVi: 'Dùng dạng quá khứ đơn cho hành động đã hoàn tất.',
      sourceSentence: 'Mina notices an opportunity.',
      prompt: 'Rewrite the sentence in the past simple.',
      acceptedAnswer: 'Mina noticed an opportunity.',
    },
    retellPrompt: 'Retell the scene in two short English sentences.',
    targetPhrases: ['opportunity'],
  } as const;

  it('validates generated story output before rendering', () => {
    expect(parseStoryInfo(story, ['opportunity'])).toEqual(story);
  });

  it('rejects unknown keys, invalid question shape, and oversize values instead of truncating', () => {
    expect(() => parseStoryInfo({ ...story, extra: true }, ['opportunity'])).toThrow('Invalid AI story data');
    expect(() => parseStoryInfo({
      ...story,
      segments: [{ ...story.segments[0], english: 'x'.repeat(281) }, story.segments[1]],
    }, ['opportunity'])).toThrow('Invalid AI story data');
    expect(() => parseStoryInfo({
      ...story,
      comprehension: { ...story.comprehension, options: ['one', 'two'] },
    }, ['opportunity'])).toThrow('Invalid AI story data');
  });

  it('requires targets to be derived from requested words', () => {
    expect(() => parseStoryInfo({ ...story, targetPhrases: ['unrelated'] }, ['opportunity']))
      .toThrow('Invalid AI story data');
  });

  it('rejects duplicate normalized comprehension options and target phrases', () => {
    expect(() => parseStoryInfo({
      ...story,
      comprehension: { ...story.comprehension, options: ['An opportunity', ' an  OPPORTUNITY ', 'A train'] },
    }, ['opportunity'])).toThrow('Invalid AI story data');
    expect(() => parseStoryInfo({ ...story, targetPhrases: ['opportunity', ' OPPORTUNITY '] }, ['opportunity']))
      .toThrow('Invalid AI story data');
  });
});
