import { describe, expect, it, vi } from 'vitest';
import { segmentGraphemes, segmentWords, supportsIntlSegmenter } from './unicodeSegmentation';

describe('segmentGraphemes', () => {
  it('splits ASCII text into one grapheme per character', () => {
    expect(segmentGraphemes('cat')).toEqual(['c', 'a', 't']);
  });

  it('splits Hangul and Han text into one grapheme per syllable/character', () => {
    expect(segmentGraphemes('한글')).toEqual(['한', '글']);
    expect(segmentGraphemes('你好')).toEqual(['你', '好']);
  });

  it('returns an empty array for an empty string', () => {
    expect(segmentGraphemes('')).toEqual([]);
  });
});

describe('segmentWords', () => {
  it('retains Japanese words and numbers when an engine marks them non-word-like', async () => {
    vi.resetModules();
    vi.stubGlobal('Intl', Object.create(Intl, {
      Segmenter: { value: class {
        segment() {
          return [
            { segment: '毎朝', isWordLike: false },
            { segment: ' ', isWordLike: false },
            { segment: '123', isWordLike: false },
            { segment: '。', isWordLike: false },
            { segment: '✨', isWordLike: false },
          ];
        }
      } },
    }));
    try {
      const engine = await import('./unicodeSegmentation');
      expect(engine.segmentWords('毎朝 123。✨')).toEqual(['毎朝', '123']);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('splits whitespace-delimited text into words', () => {
    expect(segmentWords('hello world')).toEqual(['hello', 'world']);
  });

  it('tokenizes an unspaced Chinese sentence into more than one word', () => {
    const words = segmentWords('我喜欢学习中文');
    expect(words.length).toBeGreaterThan(1);
    expect(words.join('')).toBe('我喜欢学习中文');
  });

  it('reports whether Intl.Segmenter is available in this runtime', () => {
    expect(typeof supportsIntlSegmenter).toBe('boolean');
  });
});
