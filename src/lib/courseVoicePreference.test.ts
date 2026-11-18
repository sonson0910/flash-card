import { describe, expect, it } from 'vitest';
import {
  courseVoicePreferenceKey,
  voiceForActiveCourseCard,
  voicesForTargetLanguage,
} from './courseVoicePreference';

const voice = (overrides: Partial<SpeechSynthesisVoice> = {}): SpeechSynthesisVoice => ({
  default: false,
  lang: 'en-US',
  localService: true,
  name: 'English voice',
  voiceURI: 'https://example.test/voice/en-us',
  ...overrides,
});

const course = (targetLanguage: string, pronunciationVariant: string | null = null) => ({
  targetLanguage,
  preferences: { pronunciationVariant },
});

describe('course voice preference', () => {
  it('keeps long voice URIs in the bounded preference field', () => {
    const key = courseVoicePreferenceKey(voice({ voiceURI: `https://example.test/${'voice/'.repeat(80)}` }));
    expect(key.length).toBeLessThanOrEqual(64);
    expect(key).toBe(courseVoicePreferenceKey(voice({ voiceURI: `https://example.test/${'voice/'.repeat(80)}` })));
  });

  it('matches a card only to its active target language', () => {
    const korean = voice({ lang: 'ko-KR', name: 'Korean', voiceURI: 'korean' });
    const english = voice();
    expect(voiceForActiveCourseCard({ language: 'ko-KR' }, course('ko'), [korean])).toBe(korean);
    expect(voiceForActiveCourseCard({ language: 'en' }, course('ko'), [korean])).toBeUndefined();
    expect(voiceForActiveCourseCard({}, course('en'), [english])).toBe(english);
    expect(voiceForActiveCourseCard({ language: 'yue' }, course('zh'), [voice({ lang: 'yue-HK' })])).toBeUndefined();
  });

  it('uses the saved voice after the browser reorders the list', () => {
    const saved = voice({ name: 'Saved', voiceURI: 'saved-uri' });
    const other = voice({ name: 'Other', voiceURI: 'other-uri' });
    const savedKey = courseVoicePreferenceKey(saved);
    expect(voiceForActiveCourseCard({ language: 'en' }, course('en', savedKey), [other, saved])).toBe(saved);
    expect(voicesForTargetLanguage([saved, voice({ lang: 'ko-KR' })], 'en')).toEqual([saved]);
  });

  it('falls back to exact locale, then another voice for the language', () => {
    const exact = voice({ lang: 'ja-JP', name: 'Japanese exact' });
    const exactDefault = voice({ lang: 'ja-JP', name: 'Japanese exact default', voiceURI: 'ja-default', default: true });
    const regional = voice({ lang: 'ja', name: 'Japanese broad' });
    const regionalDefault = voice({ lang: 'ja', name: 'Japanese broad default', voiceURI: 'ja-regional-default', default: true });
    expect(voiceForActiveCourseCard({ language: 'ja' }, course('ja', 'missing'), [regional, exact, exactDefault])).toBe(exactDefault);
    expect(voiceForActiveCourseCard({ language: 'ja' }, course('ja', 'missing'), [regional, regionalDefault])).toBe(regionalDefault);
    expect(voiceForActiveCourseCard({ language: 'ja' }, course('ja', 'missing'), [])).toBeUndefined();
  });

  it('ignores a saved voice from another language and preserves automatic fallback', () => {
    const english = voice({ name: 'English', voiceURI: 'english' });
    const korean = voice({ name: 'Korean', lang: 'ko-KR', voiceURI: 'korean' });
    const courseWithEnglishKey = course('en', courseVoicePreferenceKey(english));
    expect(voiceForActiveCourseCard({ language: 'ko' }, courseWithEnglishKey, [english, korean])).toBeUndefined();
    expect(voiceForActiveCourseCard({ language: 'en' }, course('en', 'missing'), [english])).toBe(english);
  });

  it('keeps Cantonese voices outside the Mandarin course voice list', () => {
    const cantonese = voice({ lang: 'yue-HK', name: 'Cantonese', voiceURI: 'cantonese' });
    expect(voicesForTargetLanguage([cantonese], 'zh')).toEqual([]);
  });
});
