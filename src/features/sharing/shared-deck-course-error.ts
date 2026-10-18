export class SharedDeckCourseNativeLanguageMismatchError extends Error {
  constructor() {
    super("This shared deck uses a different meaning language from your existing course. Change the course's Meaning language in Settings, then try again.");
    this.name = 'SharedDeckCourseNativeLanguageMismatchError';
  }
}
