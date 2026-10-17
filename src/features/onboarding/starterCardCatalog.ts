import type { CourseNativeLanguage, CourseTargetLanguage } from '../courses/courseModel';

/** One real, curated starter word. No placeholder or fabricated content. */
export interface StarterCard {
  readonly word: string;
  readonly translation: string;
  readonly phonetic: string;
  readonly category: string;
}

type Catalog = Record<CourseTargetLanguage, Record<CourseNativeLanguage, readonly StarterCard[]>>;

/**
 * Five common, everyday words per target/native pair, used for onboarding's
 * "aha" step. Kept intentionally small: onboarding creates at most this many
 * real cards through the existing `createCard` callable, it never fabricates
 * a success message for cards that were not actually written.
 */
export const STARTER_CARD_CATALOG: Catalog = {
  en: {
    vi: [
      { word: 'hello', translation: 'xin chào', phonetic: '', category: 'greetings' },
      { word: 'thank you', translation: 'cảm ơn', phonetic: '', category: 'greetings' },
      { word: 'water', translation: 'nước', phonetic: '', category: 'daily life' },
      { word: 'friend', translation: 'bạn', phonetic: '', category: 'people' },
      { word: 'love', translation: 'yêu', phonetic: '', category: 'feelings' },
    ],
    en: [],
  },
  ko: {
    vi: [
      { word: '안녕하세요', translation: 'xin chào', phonetic: 'annyeonghaseyo', category: 'greetings' },
      { word: '감사합니다', translation: 'cảm ơn', phonetic: 'gamsahamnida', category: 'greetings' },
      { word: '물', translation: 'nước', phonetic: 'mul', category: 'daily life' },
      { word: '친구', translation: 'bạn', phonetic: 'chingu', category: 'people' },
      { word: '사랑해', translation: 'yêu', phonetic: 'saranghae', category: 'feelings' },
    ],
    en: [
      { word: '안녕하세요', translation: 'hello', phonetic: 'annyeonghaseyo', category: 'greetings' },
      { word: '감사합니다', translation: 'thank you', phonetic: 'gamsahamnida', category: 'greetings' },
      { word: '물', translation: 'water', phonetic: 'mul', category: 'daily life' },
      { word: '친구', translation: 'friend', phonetic: 'chingu', category: 'people' },
      { word: '사랑해', translation: 'love', phonetic: 'saranghae', category: 'feelings' },
    ],
  },
  ja: {
    vi: [
      { word: 'こんにちは', translation: 'xin chào', phonetic: 'konnichiwa', category: 'greetings' },
      { word: 'ありがとう', translation: 'cảm ơn', phonetic: 'arigatou', category: 'greetings' },
      { word: '水', translation: 'nước', phonetic: 'mizu', category: 'daily life' },
      { word: '友達', translation: 'bạn', phonetic: 'tomodachi', category: 'people' },
      { word: '愛してる', translation: 'yêu', phonetic: 'aishiteru', category: 'feelings' },
    ],
    en: [
      { word: 'こんにちは', translation: 'hello', phonetic: 'konnichiwa', category: 'greetings' },
      { word: 'ありがとう', translation: 'thank you', phonetic: 'arigatou', category: 'greetings' },
      { word: '水', translation: 'water', phonetic: 'mizu', category: 'daily life' },
      { word: '友達', translation: 'friend', phonetic: 'tomodachi', category: 'people' },
      { word: '愛してる', translation: 'love', phonetic: 'aishiteru', category: 'feelings' },
    ],
  },
  zh: {
    vi: [
      { word: '你好', translation: 'xin chào', phonetic: 'nǐ hǎo', category: 'greetings' },
      { word: '谢谢', translation: 'cảm ơn', phonetic: 'xièxiè', category: 'greetings' },
      { word: '水', translation: 'nước', phonetic: 'shuǐ', category: 'daily life' },
      { word: '朋友', translation: 'bạn', phonetic: 'péngyou', category: 'people' },
      { word: '爱', translation: 'yêu', phonetic: 'ài', category: 'feelings' },
    ],
    en: [
      { word: '你好', translation: 'hello', phonetic: 'nǐ hǎo', category: 'greetings' },
      { word: '谢谢', translation: 'thank you', phonetic: 'xièxiè', category: 'greetings' },
      { word: '水', translation: 'water', phonetic: 'shuǐ', category: 'daily life' },
      { word: '朋友', translation: 'friend', phonetic: 'péngyou', category: 'people' },
      { word: '爱', translation: 'love', phonetic: 'ài', category: 'feelings' },
    ],
  },
};

export const starterCardsFor = (target: CourseTargetLanguage, native: CourseNativeLanguage): readonly StarterCard[] =>
  STARTER_CARD_CATALOG[target][native] ?? [];
