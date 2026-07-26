import { describe, expect, it } from 'vitest';
import type { CardData } from '../types/card';
import { buildRecallPrompt, isRecallAnswerCorrect, resolveRecallMode, type RecallMode } from './recall';

const card: CardData = {
  id: 'card-1',
  word: 'garment',
  translation: 'quần áo',
  explanation: 'An item of clothing.',
  phonetic: '/ˈɡɑːr.mənt/',
  emoji: '👗',
  category: 'Fashion',
  audioUrl: null,
  imageUrl: 'https://images.pexels.com/garment.jpeg',
};

describe('buildRecallPrompt', () => {
  it.each<RecallMode>(['adaptive', 'en-to-vi', 'vi-to-en', 'image-to-word', 'listen-to-word', 'cloze'])('keeps the answer separate in %s mode', mode => {
    const prompt = buildRecallPrompt(card, mode);

    expect(prompt.answer).toBeTruthy();
    expect(prompt.promptText.toLocaleLowerCase()).not.toContain(prompt.answer.toLocaleLowerCase());
  });

  it('uses media instead of answer text for image and listening prompts', () => {
    expect(buildRecallPrompt(card, 'image-to-word')).toMatchObject({ showImage: true, answer: 'garment' });
    expect(buildRecallPrompt(card, 'listen-to-word')).toMatchObject({ playAudio: true, answer: 'garment' });
  });

  it('raises adaptive difficulty as the correct streak grows', () => {
    expect(resolveRecallMode({ ...card, correctStreak: 0 }, 'adaptive')).toBe('en-to-vi');
    expect(resolveRecallMode({ ...card, correctStreak: 1 }, 'adaptive')).toBe('vi-to-en');
    expect(resolveRecallMode({ ...card, correctStreak: 3 }, 'adaptive')).toBe('cloze');
  });

  it('builds a cloze without leaking the answer', () => {
    const prompt = buildRecallPrompt({ ...card, exampleSentence: 'This garment is made of wool.' }, 'cloze');

    expect(prompt.promptText).toContain('_____');
    expect(prompt.promptText.toLocaleLowerCase()).not.toContain('garment');
  });

  it('checks typed recall without penalizing accents or one long-word typo', () => {
    expect(isRecallAnswerCorrect('quan ao', 'quần áo')).toBe(true);
    expect(isRecallAnswerCorrect('garmant', 'garment')).toBe(true);
    expect(isRecallAnswerCorrect('shirt', 'garment')).toBe(false);
    expect(isRecallAnswerCorrect('', 'garment')).toBe(false);
  });
});
