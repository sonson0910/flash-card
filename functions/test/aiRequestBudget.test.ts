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

  it('only enables the memory fallback for declared vocabulary AI scopes', () => {
    expect(isVocabularyAiRateLimitScope('ai-card')).toBe(true);
    expect(isVocabularyAiRateLimitScope('ai-story')).toBe(true);
    expect(isVocabularyAiRateLimitScope('ai-translate')).toBe(true);
    expect(isVocabularyAiRateLimitScope('ai')).toBe(false);
    expect(isVocabularyAiRateLimitScope('image')).toBe(false);
  });
});
