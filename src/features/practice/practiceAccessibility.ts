export function getQuizFeedbackAnnouncement(
  answeredCorrectly: boolean | null,
  correctMessage: string,
  incorrectMessage: string,
): string {
  if (answeredCorrectly === null) return '';
  return answeredCorrectly
    ? correctMessage
    : incorrectMessage;
}

export function getSpellingFeedbackAnnouncement(
  answeredCorrectly: boolean | null,
  correctMessage: string,
  incorrectMessage: string,
): string {
  if (answeredCorrectly === null) return '';
  return answeredCorrectly
    ? correctMessage
    : incorrectMessage;
}

export function getStoryStatusAnnouncement(loading: boolean, hasStory: boolean, loadingMessage: string, readyMessage: string): string {
  if (loading) return loadingMessage;
  return hasStory ? readyMessage : '';
}
