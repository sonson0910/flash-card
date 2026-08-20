import { describe, expect, it } from 'vitest';
import { parseSyllables } from './syllableParser';

describe('syllableParser', () => {
  it('parses multi-syllable word with explicit IPA stress markers', () => {
    const result = parseSyllables('serendipity', '/ˌser.ənˈdɪp.ə.ti/');
    expect(result.hasMultipleSyllables).toBe(true);
    expect(result.syllables.length).toBeGreaterThanOrEqual(4);
    const primaryStressed = result.syllables.find(s => s.isPrimaryStress);
    expect(primaryStressed).toBeDefined();
  });

  it('parses beautiful with primary stress on 1st syllable', () => {
    const result = parseSyllables('beautiful', '/ˈbjuː.tɪ.fəl/');
    expect(result.hasMultipleSyllables).toBe(true);
    expect(result.primaryStressIndex).toBe(0);
    expect(result.syllables[0].isPrimaryStress).toBe(true);
  });

  it('gracefully handles single syllable word', () => {
    const result = parseSyllables('cat', '/kæt/');
    expect(result.syllables.length).toBe(1);
    expect(result.syllables[0].text).toBe('cat');
  });

  it('gracefully handles empty string', () => {
    const result = parseSyllables('');
    expect(result.syllables.length).toBe(1);
    expect(result.hasMultipleSyllables).toBe(false);
  });
});
