import { describe, expect, it } from 'vitest';
import { compareWords, getLetterDiagnostics, getPronunciationTip } from './SpeechMatchFeedback';

describe('getLetterDiagnostics', () => {
  it('diagnoses an exact Latin transcript as fully correct', () => {
    const result = getLetterDiagnostics('cat', 'cat');
    expect(result).toEqual([
      { char: 'c', status: 'correct' },
      { char: 'a', status: 'correct' },
      { char: 't', status: 'correct' },
    ]);
  });

  it('diagnoses Hangul syllables instead of stripping them to nothing', () => {
    const result = getLetterDiagnostics('한글', '한글');
    expect(result).toEqual([
      { char: '한', status: 'correct' },
      { char: '글', status: 'correct' },
    ]);
  });

  it('marks every target character missing when the transcript is empty', () => {
    expect(getLetterDiagnostics('你好', '')).toEqual([
      { char: '你', status: 'missing' },
      { char: '好', status: 'missing' },
    ]);
  });
});

describe('compareWords', () => {
  it('tokenizes an unspaced Chinese sentence into more than a single matched-or-not blob', () => {
    const result = compareWords('我喜欢学习', '我喜欢学习');
    expect(result.length).toBeGreaterThan(1);
    expect(result.every(item => item.matched)).toBe(true);
  });
});

describe('getPronunciationTip', () => {
  it('does not apply the Latin ending-consonant tip to a non-Latin target', () => {
    const tip = getPronunciationTip(40, '한글', '');
    expect(tip).not.toContain('/');
  });
});
