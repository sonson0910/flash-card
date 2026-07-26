export type LegacyDifficulty = 'easy' | 'good' | 'hard' | 'unrated';
export type ReviewRatingValue = 'again' | 'hard' | 'good' | 'easy';

export interface CardData {
  id: string;
  word: string;
  normalizedWord?: string;
  translation: string;
  explanation: string;
  explanationTranslation?: string;
  phonetic: string;
  emoji: string;
  category: string;
  audioUrl: string | null;
  imageUrl: string | null;
  imageSearchQuery?: string;
  createdAt?: string;
  bookmarked?: boolean;
  difficulty?: LegacyDifficulty;
  customDeck?: string | null;
  nextReviewDate?: string;
  reviews?: number;
  interval?: number;
  easeFactor?: number;
  fsrs?: {
    due: string;
    stability: number;
    difficulty: number;
    elapsedDays: number;
    scheduledDays: number;
    learningSteps: number;
    reps: number;
    lapses: number;
    state: number;
    lastReview?: string;
  };
  reviewHistory?: Array<{
    rating: ReviewRatingValue;
    reviewedAt: string;
    scheduledDays: number;
    elapsedDays: number;
  }>;
  partOfSpeech?: string;
  cefrLevel?: string;
  exampleSentence?: string;
  exampleTranslation?: string;
  collocations?: string[];
  synonyms?: string[];
  antonyms?: string[];
  register?: string;
  commonMistake?: string;
  correctStreak?: number;
}
