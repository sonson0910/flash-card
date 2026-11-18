import { describe, expect, it } from 'vitest';
import { speechLocaleFor } from './speechLocale';
import type { CardData } from '../types/card';

const card = (overrides: Partial<CardData> = {}): CardData => ({
  id: 'card',
  word: 'word',
  normalizedWord: 'word',
  translation: 'meaning',
  explanation: '',
  phonetic: '',
  emoji: '',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
  ...overrides,
});

describe('speechLocaleFor', () => {
  it('defaults to English for a legacy card without a language field', () => {
    expect(speechLocaleFor(card())).toBe('en-US');
  });

  it('maps each launched target language to its own speech locale', () => {
    expect(speechLocaleFor(card({ language: 'ko' }))).toBe('ko-KR');
    expect(speechLocaleFor(card({ language: 'ja' }))).toBe('ja-JP');
    expect(speechLocaleFor(card({ language: 'zh' }))).toBe('zh-CN');
  });

  it('falls back to English for a language wave not yet launched', () => {
    expect(speechLocaleFor(card({ language: 'fr' }))).toBe('en-US');
  });
});
