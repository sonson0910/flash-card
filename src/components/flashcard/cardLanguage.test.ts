import { i18n } from '@lingui/core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { messages as enComponents } from '../../i18n/locales/en/components.po';
import { messages as viComponents } from '../../i18n/locales/vi/components.po';
import {
  cardExplanationSectionLabel,
  cardInMeaningLanguage,
  cardMeaningLanguageName,
  cardMeaningSectionLabel,
  cardRevealLabel,
  cardReturnLabel,
  cardSideAnnouncement,
  cardSideStatus,
  cardTargetLanguageKey,
  isLanguagePackCard,
  usesLanguageCardForm,
} from './cardLanguage';

const englishCard = { word: 'immediate', language: 'en', translationLanguage: 'vi' };
const legacyCard = { word: 'immediate', language: undefined, translationLanguage: undefined };
const koreanCard = { word: '결심하다', language: 'ko', translationLanguage: 'vi' };
const japaneseCard = { word: '経験', language: 'ja-JP', translationLanguage: 'vi' };
const chineseCard = { word: '你好', language: 'zh', translationLanguage: 'en' };

beforeAll(() => {
  i18n.load('en', enComponents);
  i18n.load('vi', viComponents);
});

afterEach(() => {
  i18n.activate('en');
});

describe('card language rule', () => {
  it('treats every card whose own language resolves to a non-English pack as a language-pack card', () => {
    expect(isLanguagePackCard(koreanCard)).toBe(true);
    expect(isLanguagePackCard(japaneseCard)).toBe(true);
    expect(isLanguagePackCard({ language: 'zh-Hant' })).toBe(true);
    expect(isLanguagePackCard(englishCard)).toBe(false);
    expect(isLanguagePackCard(legacyCard)).toBe(false);
  });

  it('reads the target language from the card, not from any course', () => {
    expect(cardTargetLanguageKey(englishCard)).toBe('en');
    expect(cardTargetLanguageKey(legacyCard)).toBe('en');
    expect(cardTargetLanguageKey({ language: 'fr' })).toBe('other');
    expect(cardTargetLanguageKey({ language: 'cmn' })).toBe('zh');
  });

  it('uses the language card form whenever a card has no supported picture', () => {
    expect(usesLanguageCardForm({ imageUrl: null })).toBe(true);
    expect(usesLanguageCardForm({ imageUrl: undefined })).toBe(true);
    expect(usesLanguageCardForm({ imageUrl: 'not-a-supported-url' })).toBe(true);
    expect(usesLanguageCardForm({ imageUrl: 'https://images.pexels.com/photos/123/flashcard-language.jpg' })).toBe(false);
  });
});

describe('accessible names in English', () => {
  it('keeps the strings English-course cards produced before', () => {
    i18n.activate('en');
    for (const card of [englishCard, legacyCard]) {
      expect(cardSideStatus(i18n, card, 'front')).toBe('Showing the English word.');
      expect(cardSideStatus(i18n, card, 'back')).toBe('Showing the Vietnamese meaning.');
      expect(cardSideAnnouncement(i18n, card, 'front')).toBe('English word revealed');
      expect(cardSideAnnouncement(i18n, card, 'back')).toBe('Vietnamese meaning revealed');
      expect(cardRevealLabel(i18n, card)).toBe('Reveal the Vietnamese meaning of immediate');
      expect(cardReturnLabel(i18n, card)).toBe('Return to the English side of immediate');
      expect(cardMeaningLanguageName(i18n, card)).toBe('Vietnamese');
      expect(cardMeaningSectionLabel(i18n, card)).toBe('Vietnamese meaning');
      expect(cardExplanationSectionLabel(i18n, card)).toBe('Explanation in Vietnamese');
    }
  });

  it('names the languages of a language-pack card', () => {
    i18n.activate('en');
    expect(cardSideStatus(i18n, koreanCard, 'front')).toBe('Showing the Korean word.');
    expect(cardSideStatus(i18n, japaneseCard, 'front')).toBe('Showing the Japanese word.');
    expect(cardSideStatus(i18n, chineseCard, 'front')).toBe('Showing the Chinese word.');
    expect(cardSideStatus(i18n, chineseCard, 'back')).toBe('Showing the English meaning.');
    expect(cardSideAnnouncement(i18n, koreanCard, 'front')).toBe('Korean word revealed');
    expect(cardSideAnnouncement(i18n, chineseCard, 'back')).toBe('English meaning revealed');
    expect(cardRevealLabel(i18n, chineseCard)).toBe('Reveal the English meaning of 你好');
    expect(cardReturnLabel(i18n, koreanCard)).toBe('Return to the Korean side of 결심하다');
    expect(cardReturnLabel(i18n, { word: 'bonjour', language: 'fr', translationLanguage: 'en' })).toBe('Return to the front of bonjour');
    expect(cardInMeaningLanguage(i18n, koreanCard)).toBe('In Vietnamese');
    expect(cardInMeaningLanguage(i18n, chineseCard)).toBe('In English');
  });
});

describe('accessible names in Vietnamese', () => {
  it('keeps the Vietnamese strings English-course cards produced before', () => {
    i18n.activate('vi');
    expect(cardSideStatus(i18n, englishCard, 'front')).toBe('Đang hiển thị từ tiếng Anh.');
    expect(cardSideStatus(i18n, englishCard, 'back')).toBe('Đang hiển thị nghĩa tiếng Việt.');
    expect(cardSideAnnouncement(i18n, englishCard, 'front')).toBe('Đã hiện từ tiếng Anh');
    expect(cardSideAnnouncement(i18n, englishCard, 'back')).toBe('Đã hiện nghĩa tiếng Việt');
    expect(cardRevealLabel(i18n, englishCard)).toBe('Xem nghĩa tiếng Việt của immediate');
    expect(cardReturnLabel(i18n, englishCard)).toBe('Trở về mặt tiếng Anh của immediate');
    expect(cardMeaningLanguageName(i18n, englishCard)).toBe('Tiếng Việt');
    expect(cardMeaningSectionLabel(i18n, englishCard)).toBe('Nghĩa tiếng Việt');
    expect(cardExplanationSectionLabel(i18n, englishCard)).toBe('Giải thích bằng tiếng Việt');
  });

  it('names the languages of a language-pack card', () => {
    i18n.activate('vi');
    expect(cardSideStatus(i18n, koreanCard, 'front')).toBe('Đang hiển thị từ tiếng Hàn.');
    expect(cardSideStatus(i18n, japaneseCard, 'front')).toBe('Đang hiển thị từ tiếng Nhật.');
    expect(cardSideStatus(i18n, chineseCard, 'front')).toBe('Đang hiển thị từ tiếng Trung.');
    expect(cardSideAnnouncement(i18n, chineseCard, 'back')).toBe('Đã hiện nghĩa tiếng Anh');
    expect(cardRevealLabel(i18n, chineseCard)).toBe('Xem nghĩa tiếng Anh của 你好');
    expect(cardReturnLabel(i18n, japaneseCard)).toBe('Trở về mặt tiếng Nhật của 経験');
    expect(cardInMeaningLanguage(i18n, koreanCard)).toBe('Nghĩa tiếng Việt');
  });
});
