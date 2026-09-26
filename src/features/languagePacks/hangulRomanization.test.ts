import { describe, expect, it } from 'vitest';
import { romanizeHangul } from './hangulRomanization';

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
});
