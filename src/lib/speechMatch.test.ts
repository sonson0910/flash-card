import { describe, expect, it } from 'vitest';
import { scoreSpeechMatch } from './speechMatch';

describe('scoreSpeechMatch', () => {
  it('scores an exact transcript highly without claiming phoneme accuracy', () => {
    const result = scoreSpeechMatch('hesitate', 'Hesitate.', 0.9);

    expect(result.score).toBeGreaterThanOrEqual(95);
    expect(result.matchedWords).toEqual(['hesitate']);
  });

  it('ranks a near transcript above an unrelated transcript', () => {
    const near = scoreSpeechMatch('an item of clothing', 'a item of clothing', 0.7);
    const unrelated = scoreSpeechMatch('an item of clothing', 'the weather is sunny', 0.9);

    expect(near.score).toBeGreaterThan(unrelated.score);
    expect(near.wordCoverage).toBeGreaterThan(unrelated.wordCoverage);
  });

  it('clamps invalid recognizer confidence', () => {
    expect(scoreSpeechMatch('run', 'run', 4).confidence).toBe(1);
    expect(scoreSpeechMatch('run', 'walk', -1).confidence).toBe(0);
  });

  it('scores an exact Korean transcript highly instead of stripping it to score zero', () => {
    const result = scoreSpeechMatch('안녕하세요', '안녕하세요', 0.9);

    expect(result.score).toBeGreaterThanOrEqual(95);
    expect(result.matchedWords).toEqual(['안녕하세요']);
  });

  it('scores an exact Japanese transcript highly across kanji and kana', () => {
    const result = scoreSpeechMatch('こんにちは', 'こんにちは', 0.9);

    expect(result.score).toBeGreaterThanOrEqual(95);
  });

  it('scores an exact unspaced Chinese transcript highly', () => {
    const result = scoreSpeechMatch('你好', '你好', 0.9);

    expect(result.score).toBeGreaterThanOrEqual(95);
  });

  it('still ranks a near CJK transcript above an unrelated one instead of both collapsing to zero', () => {
    const near = scoreSpeechMatch('我喜欢学习中文', '我喜欢学习中', 0.8);
    const unrelated = scoreSpeechMatch('我喜欢学习中文', '今天天气很好', 0.8);

    expect(near.score).toBeGreaterThan(0);
    expect(near.score).toBeGreaterThan(unrelated.score);
  });
});
