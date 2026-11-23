// A review outcome exactly as the review callable serves it once the verified stats records exist:
// the first answer of a Monday that reaches a seven-day streak and refills the weekly freezes.
// The review persistence test checks the server still serves it; the client tests check it parses.
export const servedReviewOutcome = {
  applied: true,
  duplicate: false,
  xpAwarded: 2,
  card: {
    id: 'word-focus',
    word: 'focus',
    normalizedWord: 'focus',
    language: 'en',
    translation: 'tập trung',
    explanation: 'to concentrate',
    explanationTranslation: 'tập trung',
    phonetic: '/ˈfəʊ.kəs/',
    category: 'Study',
    emoji: '🎯',
    audioUrl: null,
    imageUrl: null,
    imageSearchQuery: 'focus study',
    createdAt: '2026-08-01T00:00:00.000Z',
    bookmarked: false,
    customDeck: null,
    difficulty: 'good',
    reviews: 1,
    interval: 0,
    easeFactor: 2.788189603,
    correctStreak: 1,
    partOfSpeech: 'verb',
    cefrLevel: 'B1',
    exampleSentence: 'Focus on the task.',
    exampleTranslation: 'Tập trung vào nhiệm vụ.',
    collocations: [],
    synonyms: [],
    antonyms: [],
    register: '',
    commonMistake: '',
    reviewHistory: [
      {
        rating: 'good',
        reviewedAt: '2026-11-22T17:00:10.000Z',
        scheduledDays: 0,
        elapsedDays: 0
      }
    ],
    appliedReviewOperationIds: [
      'device-a:review-1'
    ],
    schemaVersion: 2,
    revision: 4,
    nextReviewDate: '2026-11-22T17:10:10.000Z',
    fsrs: {
      due: '2026-11-22T17:10:10.000Z',
      stability: 2.3065,
      difficulty: 2.11810397,
      elapsedDays: 0,
      scheduledDays: 0,
      learningSteps: 1,
      reps: 1,
      lapses: 0,
      state: 1,
      lastReview: '2026-11-22T17:00:10.000Z'
    },
    libraryEpoch: 2,
    updatedAt: '2026-11-22T17:00:10.000Z'
  },
  gamification: {
    xp: 642,
    level: 3,
    streak: 7,
    studyDay: '2026-11-23',
    events: [],
    rewardTimeZone: 'Asia/Saigon',
    xpAwarded: 2,
    reviewActivity: {
      targetLanguage: 'en',
      coverageStartedOn: '2026-11-02',
      days: {
        '2026-11-18': {
          reviewed: 4,
          again: 0,
          hard: 1,
          good: 3,
          easy: 0
        },
        '2026-11-23': {
          reviewed: 1,
          again: 0,
          hard: 0,
          good: 1,
          easy: 0
        }
      }
    },
    streakChange: {
      freezesUsed: 0,
      freezesEarned: 1,
      milestone: 7
    },
    studyTimeMs: 20000
  }
};

// The same review answered again from its stored receipt, as a retry or a resent request receives
// it: the content repeats the first answer and the receipt says it is a replay.
export const servedReplayedReviewOutcome = { ...servedReviewOutcome, duplicate: true, replayed: true };
