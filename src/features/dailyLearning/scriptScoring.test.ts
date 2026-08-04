import { describe, expect, it } from 'vitest';
import { inferScriptScoringPolicy, normalizeScriptAnswer, scoreScriptAnswer } from './scriptScoring';

describe('script-aware scoring', () => {
  it('normalizes Latin case, width, punctuation and spacing without dropping accents', () => {
    expect(scoreScriptAnswer('Café au lait!', '  café   au lait ', 'latin').correct).toBe(true);
    expect(scoreScriptAnswer('cafe', 'café', 'latin').correct).toBe(false);
  });

  it('scores Han without manufacturing spaces or accepting romanization', () => {
    expect(scoreScriptAnswer('我喜欢学习。', '我 喜欢 学习', 'han').correct).toBe(true);
    expect(scoreScriptAnswer('我喜欢学习', 'wo xihuan xuexi', 'han')).toMatchObject({ correct: false, wrongScript: true });
  });

  it('keeps Kana distinct and never transliterates it', () => {
    expect(scoreScriptAnswer('カタカナ', 'ｶﾀｶﾅ', 'kana').correct).toBe(true);
    expect(scoreScriptAnswer('かたかな', 'カタカナ', 'kana').correct).toBe(false);
    expect(scoreScriptAnswer('かたかな', 'katakana', 'kana')).toMatchObject({ correct: false, wrongScript: true });
  });

  it('normalizes composed Hangul but rejects Latin transcription', () => {
    expect(scoreScriptAnswer('한글', '한글', 'hangul').correct).toBe(true);
    expect(scoreScriptAnswer('한글', 'hangeul', 'hangul')).toMatchObject({ correct: false, wrongScript: true });
  });

  it('uses strict NFKC and whitespace normalization for the fallback policy', () => {
    expect(normalizeScriptAnswer('Ａ  B', 'fallback')).toBe('A B');
    expect(scoreScriptAnswer('A B', 'a b', 'fallback').correct).toBe(false);
  });

  it('infers explicit policies deterministically and prefers Kana for mixed Japanese', () => {
    expect(inferScriptScoringPolicy('学び')).toBe('kana');
    expect(inferScriptScoringPolicy('学习')).toBe('han');
    expect(inferScriptScoringPolicy('한글')).toBe('hangul');
    expect(inferScriptScoringPolicy('Vocabulary')).toBe('latin');
    expect(inferScriptScoringPolicy('123')).toBe('fallback');
  });
});
