import { describe, expect, it } from 'vitest';
import {
  getQuizFeedbackAnnouncement,
  getSpellingFeedbackAnnouncement,
  getStoryStatusAnnouncement,
} from './practiceAccessibility';

describe('practice accessibility announcements', () => {
  it('announces correct and incorrect quiz feedback without relying on colour or icons', () => {
    expect(getQuizFeedbackAnnouncement(true, 'serendipity')).toBe('Correct answer.');
    expect(getQuizFeedbackAnnouncement(false, 'serendipity')).toBe('Incorrect. The correct answer is “serendipity”.');
    expect(getQuizFeedbackAnnouncement(null, 'serendipity')).toBe('');
  });

  it('announces story generation state changes concisely', () => {
    expect(getStoryStatusAnnouncement(true, false)).toBe('Creating your story.');
    expect(getStoryStatusAnnouncement(false, true)).toBe('Your story is ready.');
    expect(getStoryStatusAnnouncement(false, false)).toBe('');
  });

  it('announces spelling feedback with the correct answer when needed', () => {
    expect(getSpellingFeedbackAnnouncement(true, 'serendipity')).toBe('Correct answer.');
    expect(getSpellingFeedbackAnnouncement(false, 'serendipity')).toBe('Incorrect. The correct answer is “serendipity”.');
    expect(getSpellingFeedbackAnnouncement(null, 'serendipity')).toBe('');
  });
});
