import { describe, expect, it } from 'vitest';
import { InputValidationError } from '../src/inputValidation.js';
import { parseStoryResponse } from '../src/storyValidation.js';

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

describe('parseStoryResponse', () => {
  it('accepts the exact bounded story lesson contract', () => {
    expect(parseStoryResponse(story, ['opportunity'])).toEqual(story);
  });

  it('rejects unknown and oversized provider fields without truncation', () => {
    expect(() => parseStoryResponse({ ...story, extra: true }, ['opportunity']))
      .toThrowError(new InputValidationError('Story response is invalid.'));
    expect(() => parseStoryResponse({
      ...story,
      segments: [{ ...story.segments[0], english: 'x'.repeat(281) }, story.segments[1]],
    }, ['opportunity'])).toThrowError(new InputValidationError('Story response is invalid.'));
  });

  it('rejects a target that is unrelated to the request', () => {
    expect(() => parseStoryResponse({ ...story, targetPhrases: ['unrelated'] }, ['opportunity']))
      .toThrowError(new InputValidationError('Story response is invalid.'));
  });

  it('rejects duplicate normalized choices and targets', () => {
    expect(() => parseStoryResponse({
      ...story,
      comprehension: { ...story.comprehension, options: ['An opportunity', ' an  OPPORTUNITY ', 'A train'] },
    }, ['opportunity'])).toThrowError(new InputValidationError('Story response is invalid.'));
    expect(() => parseStoryResponse({ ...story, targetPhrases: ['opportunity', ' OPPORTUNITY '] }, ['opportunity']))
      .toThrowError(new InputValidationError('Story response is invalid.'));
  });
});
