import { describe, expect, it } from 'vitest';
import { parseVocabularyRequest } from '../src/inputValidation.js';
import { buildMnemonicPrompt, buildTranslatePrompt } from '../src/vocabularyPrompts.js';

describe('mnemonic and explanation-translation language pair', () => {
  it('builds prompts from the card language pair without naming Vietnamese or English by default', () => {
    const mnemonic = buildMnemonicPrompt({ word: '사과', translation: 'apple' }, 'ko', 'en');
    const translate = buildTranslatePrompt('사과는 빨간 과일입니다.', 'ko', 'en');

    expect(mnemonic).toContain('Korean');
    expect(mnemonic).toContain('English');
    expect(mnemonic).not.toContain('Vietnamese');
    expect(translate).toContain('Korean');
    expect(translate).toContain('English');
    expect(translate).not.toContain('Vietnamese');
  });

  it('keeps English to Vietnamese for a request without a language pair', () => {
    expect(buildMnemonicPrompt({ word: 'greet', translation: 'chào' })).toContain('Vietnamese memory mnemonic for this English');
    expect(buildTranslatePrompt('Hello.')).toContain('English text');
    expect(buildTranslatePrompt('Hello.')).toContain('into clear, natural Vietnamese');
  });

  it('accepts and validates the language pair on mnemonic and translate requests', () => {
    expect(parseVocabularyRequest({
      action: 'mnemonic',
      input: { word: '사과', translation: 'apple', targetLanguage: 'ko', translationLanguage: 'en' },
    })).toEqual({ action: 'mnemonic', word: '사과', translation: 'apple', targetLanguage: 'ko', translationLanguage: 'en' });
    expect(parseVocabularyRequest({
      action: 'translate',
      input: { text: '사과', targetLanguage: 'ko', translationLanguage: 'en' },
    })).toEqual({ action: 'translate', text: '사과', targetLanguage: 'ko', translationLanguage: 'en' });
    expect(parseVocabularyRequest({ action: 'translate', input: 'apple' })).toEqual({ action: 'translate', text: 'apple' });
    expect(() => parseVocabularyRequest({
      action: 'mnemonic', input: { word: 'a', translation: 'b', targetLanguage: 'xx' },
    })).toThrow();
    expect(() => parseVocabularyRequest({
      action: 'translate', input: { text: 'a', translationLanguage: 'fr' },
    })).toThrow();
  });
});
