import { describe, expect, it } from 'vitest';
import { decomposeHangulSyllables, romanizeHangul } from './hangulRomanization';

describe('romanizeHangul', () => {
  it('romanizes a two-syllable word with a final consonant', () => {
    expect(romanizeHangul('한글')).toBe('hangeul');
  });

  it('romanizes a greeting spanning a null-onset syllable', () => {
    expect(romanizeHangul('안녕')).toBe('annyeong');
  });

  it('romanizes each syllable independently without cross-syllable assimilation', () => {
    // The fully assimilated pronunciation is "gamsahamnida"; this function
    // documents that it returns the per-syllable form instead.
    expect(romanizeHangul('감사합니다')).toBe('gamsahapnida');
  });

  it('leaves non-Hangul characters untouched and reports no Hangul as null', () => {
    expect(romanizeHangul('한글 101!')).toBe('hangeul 101!');
    expect(romanizeHangul('hello')).toBeNull();
    expect(romanizeHangul('')).toBeNull();
  });

  it('decomposes syllables to compatibility jamo with the same RR parts', () => {
    expect(decomposeHangulSyllables('결심하다')).toEqual([
      { block: '결', parts: [{ jamo: 'ㄱ', romanization: 'g' }, { jamo: 'ㅕ', romanization: 'yeo' }, { jamo: 'ㄹ', romanization: 'l' }] },
      { block: '심', parts: [{ jamo: 'ㅅ', romanization: 's' }, { jamo: 'ㅣ', romanization: 'i' }, { jamo: 'ㅁ', romanization: 'm' }] },
      { block: '하', parts: [{ jamo: 'ㅎ', romanization: 'h' }, { jamo: 'ㅏ', romanization: 'a' }] },
      { block: '다', parts: [{ jamo: 'ㄷ', romanization: 'd' }, { jamo: 'ㅏ', romanization: 'a' }] },
    ]);
  });
});
