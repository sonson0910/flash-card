import { describe, expect, it } from 'vitest';
import {
  parseDialogue,
  parseExtractedWords,
  parseMnemonic,
  parseTutorAnswer,
} from './aiFeatureInfo';

describe('AI learning-tool response parsers', () => {
  it('normalizes bounded plain-text tutor and mnemonic responses', () => {
    expect(parseTutorAnswer('  Use it when the situation changes.  ')).toBe('Use it when the situation changes.');
    expect(parseMnemonic('  resilient sounds like “rễ zịn”  ')).toBe('resilient sounds like “rễ zịn”');
    expect(() => parseTutorAnswer(null)).toThrow('Invalid AI tutor response');
    expect(() => parseMnemonic({ text: 'not a string' })).toThrow('Invalid AI mnemonic response');
  });

  it('accepts only bounded extracted-word records', () => {
    expect(parseExtractedWords([
      {
        word: ' resilient ',
        translation: ' bền bỉ ',
        partOfSpeech: ' adjective ',
        cefrLevel: 'B1',
        example: ' She is resilient. ',
      },
    ])).toEqual([{
      word: 'resilient',
      translation: 'bền bỉ',
      partOfSpeech: 'adjective',
      cefrLevel: 'B1',
      example: 'She is resilient.',
    }]);
    expect(() => parseExtractedWords([{ word: null, translation: 'bền bỉ', partOfSpeech: 'noun', cefrLevel: 'B1', example: 'x' }]))
      .toThrow('Invalid AI extracted word');
    expect(() => parseExtractedWords(Array.from({ length: 11 }, () => ({
      word: 'word', translation: 'meaning', partOfSpeech: 'noun', cefrLevel: 'B1', example: 'example',
    })))).toThrow('Invalid AI extracted words');
  });

  it('requires a complete four-to-six-turn dialogue', () => {
    expect(parseDialogue({
      title: 'At a café',
      context: 'Ordering coffee before work.',
      turns: [
        { speaker: 'Alex', en: 'I need coffee.', vi: 'Tôi cần cà phê.' },
        { speaker: 'Sarah', en: 'Try this blend.', vi: 'Hãy thử loại này.' },
        { speaker: 'Alex', en: 'It is resilient.', vi: 'Nó rất bền.' },
        { speaker: 'Sarah', en: 'Good choice.', vi: 'Lựa chọn tốt.' },
      ],
    })).toMatchObject({ title: 'At a café', turns: expect.any(Array) });
    expect(() => parseDialogue({ title: 'Short', context: 'Too short.', turns: [] }))
      .toThrow('Invalid AI dialogue');
    expect(() => parseDialogue({
      title: 'Too long',
      context: 'Too long.',
      turns: Array.from({ length: 7 }, () => ({ speaker: 'Alex', en: 'x', vi: 'x' })),
    })).toThrow('Invalid AI dialogue');
  });
});
