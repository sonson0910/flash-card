import { describe, expect, it } from 'vitest';
import {
  getQuizFeedbackAnnouncement,
  getSpellingFeedbackAnnouncement,
  getStoryStatusAnnouncement,
} from './practiceAccessibility';

describe('practice accessibility announcements', () => {
  it('announces correct and incorrect quiz feedback without relying on colour or icons', () => {
    expect(getQuizFeedbackAnnouncement(true, 'Correct answer.', 'Incorrect. The correct answer is “serendipity”.')).toBe('Correct answer.');
    expect(getQuizFeedbackAnnouncement(false, 'Correct answer.', 'Incorrect. The correct answer is “serendipity”.')).toBe('Incorrect. The correct answer is “serendipity”.');
    expect(getQuizFeedbackAnnouncement(null, 'Correct answer.', 'Incorrect. The correct answer is “serendipity”.')).toBe('');
  });

  it('announces story generation state changes concisely', () => {
    expect(getStoryStatusAnnouncement(true, false, 'Creating your story.', 'Your story is ready.')).toBe('Creating your story.');
    expect(getStoryStatusAnnouncement(false, true, 'Creating your story.', 'Your story is ready.')).toBe('Your story is ready.');
    expect(getStoryStatusAnnouncement(false, false, 'Creating your story.', 'Your story is ready.')).toBe('');
  });

  it('announces spelling feedback with the correct answer when needed', () => {
    expect(getSpellingFeedbackAnnouncement(true, 'Correct answer.', 'Incorrect. The correct answer is “serendipity”.')).toBe('Correct answer.');
    expect(getSpellingFeedbackAnnouncement(false, 'Correct answer.', 'Incorrect. The correct answer is “serendipity”.')).toBe('Incorrect. The correct answer is “serendipity”.');
    expect(getSpellingFeedbackAnnouncement(null, 'Correct answer.', 'Incorrect. The correct answer is “serendipity”.')).toBe('');
  });
});
