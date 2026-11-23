import { describe, expect, it } from 'vitest';
import {
  normalizeTranslationAlternatives,
  normalizeWordInfoField,
  parseStoryInfo,
  parseWordInfo,
  type WordInfoField,
} from './wordInfo';

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
      wordFamily: { noun: 'runner', verb: 'run', adj: '', adv: '  ' },
    });

    expect(result.collocations).toHaveLength(4);
    expect(result.cefrLevel).toBe('A1');
    expect(result.imageSearchQuery).toBe('person sprinting outdoors running shoes');
    expect(result.wordFamily).toEqual({ noun: 'runner', verb: 'run' });
  });

  it('rejects malformed required AI output', () => {
    expect(() => parseWordInfo({ translation: 42 })).toThrow('Invalid AI word data');
  });
});

describe('normalizeWordInfoField', () => {
  const raw = {
    translation: '  kiên cường  ',
    explanation: ` ${'Able to recover quickly. '.repeat(60)}`,
    explanationTranslation: 'Có khả năng hồi phục nhanh.',
    phonetic: ' /rɪˈzɪliənt/ ',
    emoji: '💪🏽💪🏽💪🏽💪🏽💪🏽',
    category: 'Personality traits and emotional qualities of people in hard times',
    partOfSpeech: ' adjective ',
    cefrLevel: ' b2 ',
    exampleSentence: 'Small businesses proved surprisingly resilient.',
    exampleTranslation: 'Các doanh nghiệp nhỏ tỏ ra kiên cường.',
    collocations: ['resilient economy', '', 'resilient people', 'highly resilient', 'resilient to', 'extra'],
    synonyms: ['tough', 7, 'hardy'],
    antonyms: [],
    mnemonic: '  re-silly-ent  ',
    wordFamily: { noun: 'resilience', adv: 'resiliently', adj: '  ' },
    register: 'neutral',
    commonMistake: 'Do not confuse with resistant.',
    imageSearchQuery: 'tree bending in storm',
    translationAlternatives: ['mau phục hồi', 'Kiên Cường', 'dẻo dai', 'mau phục hồi', 'bền bỉ', 'đàn hồi'],
  };

  it('gives every streamed field the value the final card check gives it', () => {
    const parsed = parseWordInfo(raw) as unknown as Record<string, unknown>;
    const fields: WordInfoField[] = [
      'translation', 'explanation', 'explanationTranslation', 'phonetic', 'emoji', 'category',
      'partOfSpeech', 'cefrLevel', 'exampleSentence', 'exampleTranslation', 'collocations', 'synonyms',
      'antonyms', 'wordFamily', 'register', 'commonMistake', 'imageSearchQuery', 'translationAlternatives',
    ];
    for (const field of fields) {
      expect(normalizeWordInfoField(field, raw[field], { translation: parsed.translation as string }), field)
        .toEqual(parsed[field]);
    }
    expect(normalizeWordInfoField('mnemonic', raw.mnemonic)).toBe(parsed.mnemonic);
    expect(parsed.cefrLevel).toBe('B2');
    expect(parsed.translationAlternatives).toEqual(['mau phục hồi', 'dẻo dai', 'bền bỉ']);
  });

  it('clears a CEFR value outside the six levels instead of showing it', () => {
    expect(normalizeWordInfoField('cefrLevel', 'Advanced')).toBe('');
    expect(parseWordInfo({ ...raw, cefrLevel: 'Advanced' }).cefrLevel).toBe('');
  });

  it('rejects unknown fields and values of the wrong type', () => {
    expect(normalizeWordInfoField('customDeck', 'IELTS')).toBeUndefined();
    expect(normalizeWordInfoField('translation', ['kiên cường'])).toBeUndefined();
    expect(normalizeWordInfoField('collocations', 'resilient economy')).toBeUndefined();
    expect(normalizeWordInfoField('translationAlternatives', 'dẻo dai')).toBeUndefined();
    expect(normalizeWordInfoField('wordFamily', ['resilience'])).toBeUndefined();
  });

  it('keeps alternatives distinct, bounded and different from the translation', () => {
    expect(normalizeTranslationAlternatives([' Cơ hội ', 'dịp', 'DỊP', 'thời cơ', 'vận may', 'x'.repeat(300)], 'cơ hội'))
      .toEqual(['dịp', 'thời cơ', 'vận may']);
    expect(normalizeTranslationAlternatives(['a'.repeat(300)])).toEqual(['a'.repeat(256)]);
    expect(normalizeTranslationAlternatives([null, '', '  ', 3])).toEqual([]);
    expect(normalizeTranslationAlternatives(undefined)).toEqual([]);
  });

  it('accepts a card without alternatives', () => {
    const { translationAlternatives: _omitted, ...withoutAlternatives } = raw;
    expect(parseWordInfo(withoutAlternatives).translationAlternatives).toEqual([]);
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
