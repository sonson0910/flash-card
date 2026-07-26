import type { CardData } from '../types/card';
import { normalizePartOfSpeech, normalizePrefixSearch } from './cardQuery';
import { isSupportedAudioUrl } from './audio';
import { isSupportedImageUrl } from './images';

const asText = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback;

const boundedText = (value: unknown, maximum: number, fallback = '') =>
  asText(value, fallback).trim().slice(0, maximum);

const validIsoDate = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

const asTextList = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 4).map(item => item.trim().slice(0, 100)) : [];

const validDifficulties = new Set(['easy', 'good', 'hard', 'unrated']);
const validRatings = new Set(['again', 'hard', 'good', 'easy']);

const normalizeReviewHistory = (value: unknown): CardData['reviewHistory'] => {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is NonNullable<CardData['reviewHistory']>[number] => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const review = entry as Record<string, unknown>;
    return typeof review.rating === 'string'
      && validRatings.has(review.rating)
      && typeof review.reviewedAt === 'string'
      && typeof review.scheduledDays === 'number'
      && Number.isFinite(review.scheduledDays) && review.scheduledDays >= 0
      && typeof review.elapsedDays === 'number'
      && Number.isFinite(review.elapsedDays) && review.elapsedDays >= 0
      && Boolean(validIsoDate(review.reviewedAt));
  }).slice(-100).map(review => ({
    rating: review.rating,
    reviewedAt: validIsoDate(review.reviewedAt) as string,
    scheduledDays: review.scheduledDays,
    elapsedDays: review.elapsedDays,
  }));
};

const normalizeFsrs = (value: unknown): CardData['fsrs'] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const due = validIsoDate(source.due);
  const lastReview = source.lastReview === undefined ? undefined : validIsoDate(source.lastReview);
  const values = ['stability', 'difficulty', 'elapsedDays', 'scheduledDays', 'learningSteps', 'reps', 'lapses'] as const;
  if (!due || (source.lastReview !== undefined && !lastReview)) return undefined;
  if (!values.every(key => typeof source[key] === 'number' && Number.isFinite(source[key]) && Number(source[key]) >= 0)) return undefined;
  if (!Number.isInteger(source.state) || Number(source.state) < 0 || Number(source.state) > 3) return undefined;
  if (Number(source.difficulty) > 10) return undefined;
  return {
    due,
    stability: Number(source.stability),
    difficulty: Number(source.difficulty),
    elapsedDays: Number(source.elapsedDays),
    scheduledDays: Number(source.scheduledDays),
    learningSteps: Number(source.learningSteps),
    reps: Math.floor(Number(source.reps)),
    lapses: Math.floor(Number(source.lapses)),
    state: Number(source.state),
    ...(lastReview ? { lastReview } : {}),
  };
};

export function normalizeCardData(raw: Partial<CardData>, documentId: string): CardData {
  const word = boundedText(raw.word, 256);
  const candidateId = boundedText(raw.id, 128);
  const safeDocumentId = boundedText(documentId, 128, 'card').replace(/[^a-zA-Z0-9_-]/g, '_') || 'card';
  const id = /^[a-zA-Z0-9_-]+$/.test(candidateId) ? candidateId : safeDocumentId;
  const createdAt = validIsoDate(raw.createdAt) ?? new Date(0).toISOString();
  const nextReviewDate = validIsoDate(raw.nextReviewDate);
  const customDeck = typeof raw.customDeck === 'string' ? boundedText(raw.customDeck, 128) || null : null;

  return {
    id,
    word,
    normalizedWord: boundedText(raw.normalizedWord, 256) || normalizePrefixSearch(word),
    translation: boundedText(raw.translation, 256),
    explanation: boundedText(raw.explanation, 2048),
    explanationTranslation: boundedText(raw.explanationTranslation, 2048),
    phonetic: boundedText(raw.phonetic, 256),
    emoji: boundedText(raw.emoji, 64) || '📝',
    category: boundedText(raw.category, 128) || 'Other',
    audioUrl: isSupportedAudioUrl(raw.audioUrl) ? raw.audioUrl ?? null : null,
    imageUrl: isSupportedImageUrl(raw.imageUrl) ? raw.imageUrl ?? null : null,
    imageSearchQuery: boundedText(raw.imageSearchQuery, 120),
    createdAt,
    bookmarked: raw.bookmarked === true,
    difficulty: typeof raw.difficulty === 'string' && validDifficulties.has(raw.difficulty) ? raw.difficulty : 'unrated',
    customDeck,
    ...(nextReviewDate ? { nextReviewDate } : {}),
    reviews: Number.isFinite(raw.reviews) && Number(raw.reviews) >= 0 ? Math.floor(Number(raw.reviews)) : 0,
    interval: Number.isFinite(raw.interval) && Number(raw.interval) >= 0 ? Number(raw.interval) : 0,
    easeFactor: Number.isFinite(raw.easeFactor) && Number(raw.easeFactor) >= 0 && Number(raw.easeFactor) <= 5 ? Number(raw.easeFactor) : 2.5,
    partOfSpeech: normalizePartOfSpeech(raw.partOfSpeech),
    cefrLevel: boundedText(raw.cefrLevel, 8),
    exampleSentence: boundedText(raw.exampleSentence, 2048),
    exampleTranslation: boundedText(raw.exampleTranslation, 2048),
    collocations: asTextList(raw.collocations),
    synonyms: asTextList(raw.synonyms),
    antonyms: asTextList(raw.antonyms),
    register: boundedText(raw.register, 64),
    commonMistake: boundedText(raw.commonMistake, 2048),
    correctStreak: Number.isFinite(raw.correctStreak) && Number(raw.correctStreak) >= 0 ? Math.floor(Number(raw.correctStreak)) : 0,
    reviewHistory: normalizeReviewHistory(raw.reviewHistory),
    fsrs: normalizeFsrs(raw.fsrs),
  };
}
