export interface LibraryStats {
  total: number;
  reviewed: number;
  easy: number;
  good: number;
  hard: number;
  unrated: number;
  bookmarked: number;
  due: number;
  legacyUnindexed: number;
  dueForecast?: Array<{ date: string; count: number }>;
  recentlyMastered?: Array<{ id: string; word: string; translation: string; masteredAt: string }>;
}
