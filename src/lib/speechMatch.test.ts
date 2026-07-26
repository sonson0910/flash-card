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
});
