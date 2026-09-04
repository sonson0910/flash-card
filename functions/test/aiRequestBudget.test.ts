import { describe, expect, it } from 'vitest';
import {
  getVocabularyAiBudget,
  isVocabularyAiRateLimitScope,
} from '../src/aiRequestBudget.js';

describe('vocabulary AI request budgets', () => {
  it('gives card generation its own 120-call hourly budget', () => {
    expect(getVocabularyAiBudget('word')).toEqual({
      scope: 'ai-card',
      maximum: 120,
      message: 'Card generation limit reached. Try again later.',
    });
  });

  it('keeps story generation separate from card generation', () => {
    expect(getVocabularyAiBudget('story')).toEqual({
      scope: 'ai-story',
      maximum: 30,
      message: 'Story generation limit reached. Try again later.',
    });
  });

  it('gives translation its own 120-call hourly budget', () => {
    expect(getVocabularyAiBudget('translate')).toEqual({
      scope: 'ai-translate',
      maximum: 120,
      message: 'Translation limit reached. Try again later.',
    });
  });

  it('gives each learning tool an explicit hourly budget scope', () => {
    expect(getVocabularyAiBudget('tutor')).toEqual({
      scope: 'ai-tutor',
      maximum: 60,
      message: 'Tutor request limit reached. Try again later.',
    });
    expect(getVocabularyAiBudget('mnemonic')).toEqual({
      scope: 'ai-mnemonic',
      maximum: 60,
      message: 'Mnemonic request limit reached. Try again later.',
    });
    expect(getVocabularyAiBudget('extract')).toEqual({
      scope: 'ai-extract',
      maximum: 30,
      message: 'Vocabulary extraction limit reached. Try again later.',
    });
    expect(getVocabularyAiBudget('dialogue')).toEqual({
      scope: 'ai-dialogue',
      maximum: 30,
      message: 'Dialogue generation limit reached. Try again later.',
    });
    expect(getVocabularyAiBudget('conversation')).toEqual({
      scope: 'ai-conversation',
      maximum: 24,
      message: 'Conversation limit reached. Try again later.',
    });
  });

  it('only enables the memory fallback for declared vocabulary AI scopes', () => {
    expect(isVocabularyAiRateLimitScope('ai-card')).toBe(true);
    expect(isVocabularyAiRateLimitScope('ai-story')).toBe(true);
    expect(isVocabularyAiRateLimitScope('ai-translate')).toBe(true);
    expect(isVocabularyAiRateLimitScope('ai-tutor')).toBe(true);
    expect(isVocabularyAiRateLimitScope('ai-mnemonic')).toBe(true);
    expect(isVocabularyAiRateLimitScope('ai-extract')).toBe(true);
    expect(isVocabularyAiRateLimitScope('ai-dialogue')).toBe(true);
    expect(isVocabularyAiRateLimitScope('ai-conversation')).toBe(true);
    expect(isVocabularyAiRateLimitScope('ai')).toBe(false);
    expect(isVocabularyAiRateLimitScope('image')).toBe(false);
  });
});
