export function getQuizFeedbackAnnouncement(
  answeredCorrectly: boolean | null,
  correctAnswer: string,
): string {
  if (answeredCorrectly === null) return '';
  return answeredCorrectly
    ? 'Correct answer.'
    : `Incorrect. The correct answer is “${correctAnswer}”.`;
}

export function getSpellingFeedbackAnnouncement(
  answeredCorrectly: boolean | null,
  correctAnswer: string,
): string {
  if (answeredCorrectly === null) return '';
  return answeredCorrectly
    ? 'Correct answer.'
    : `Incorrect. The correct answer is “${correctAnswer}”.`;
}

export function getStoryStatusAnnouncement(loading: boolean, hasStory: boolean): string {
  if (loading) return 'Creating your story.';
  return hasStory ? 'Your story is ready.' : '';
}
