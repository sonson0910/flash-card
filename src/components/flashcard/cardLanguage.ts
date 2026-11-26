import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { resolveLanguagePackId } from '../../features/languagePacks/registry';
import { isSupportedImageUrl } from '../../lib/mediaUrlPolicy';
import type { CardData } from '../../types/card';

/** Target languages the card copy names; any other language reads as "the word". */
export type CardTargetLanguageKey = 'en' | 'ko' | 'ja' | 'zh' | 'other';
/** Meaning languages the card copy names; any other language reads as "the meaning". */
export type CardMeaningLanguageKey = 'vi' | 'en' | 'other';

type CardLanguages = Pick<CardData, 'language' | 'translationLanguage'>;

const cardShowingMeaningLanguageMessage = msg({ id: 'flashcard.card.showing-meaning-language', message: '{language, select, vi {Showing the Vietnamese meaning.} en {Showing the English meaning.} other {Showing the meaning.}}' });
const cardShowingWordLanguageMessage = msg({ id: 'flashcard.card.showing-word-language', message: '{language, select, en {Showing the English word.} ko {Showing the Korean word.} ja {Showing the Japanese word.} zh {Showing the Chinese word.} other {Showing the word.}}' });
const cardMeaningLanguageRevealedMessage = msg({ id: 'flashcard.card.meaning-language-revealed', message: '{language, select, vi {Vietnamese meaning revealed} en {English meaning revealed} other {Meaning revealed}}' });
const cardWordLanguageRevealedMessage = msg({ id: 'flashcard.card.word-language-revealed', message: '{language, select, en {English word revealed} ko {Korean word revealed} ja {Japanese word revealed} zh {Chinese word revealed} other {Word revealed}}' });
const revealMeaningLanguageLabelMessage = msg({ id: 'flashcard.reveal-meaning-language-label', message: '{language, select, vi {Reveal the Vietnamese meaning of {word}} en {Reveal the English meaning of {word}} other {Reveal the meaning of {word}}}' });
const returnToWordLanguageLabelMessage = msg({ id: 'flashcard.return-to-word-language-label', message: '{language, select, en {Return to the English side of {word}} ko {Return to the Korean side of {word}} ja {Return to the Japanese side of {word}} zh {Return to the Chinese side of {word}} other {Return to the front of {word}}}' });
const backMeaningLanguageMessage = msg({ id: 'flashcard.back.meaning-language', message: '{language, select, vi {Vietnamese} en {English} other {Meaning}}' });
const backInMeaningLanguageMessage = msg({ id: 'flashcard.back.in-meaning-language', message: '{language, select, vi {In Vietnamese} en {In English} other {Meaning}}' });
const backMeaningLabelMessage = msg({ id: 'flashcard.back.meaning-label', message: '{language, select, vi {Vietnamese meaning} en {English meaning} other {Meaning}}' });
const backExplanationLabelMessage = msg({ id: 'flashcard.back.explanation-label', message: '{language, select, vi {Explanation in Vietnamese} en {Explanation in English} other {Explanation}}' });

/**
 * Formats one of the select messages above with its values. The id-first call keeps the shape the
 * card used before; the source message stands in when a catalog has not loaded.
 */
function format(i18n: I18n, message: MessageDescriptor, values: Record<string, string>): string {
  return i18n._(message.id, values, { message: message.message });
}

const primarySubtag = (value: string | null | undefined, fallback: string) =>
  ((value ?? '').trim() || fallback).toLowerCase().split(/[-_]/)[0];

/**
 * The language a card teaches, read from the card itself. A learner with several courses sees
 * cards of every course in one library, so the active course cannot name a card's language.
 */
export function cardTargetLanguageKey(card: Pick<CardData, 'language'>): CardTargetLanguageKey {
  const pack = resolveLanguagePackId(card.language);
  if (pack !== 'en') return pack;
  return primarySubtag(card.language, 'en') === 'en' ? 'en' : 'other';
}

/** The language the card's meaning is written in; cards stored before the field existed are Vietnamese. */
export function cardMeaningLanguageKey(card: Pick<CardData, 'translationLanguage'>): CardMeaningLanguageKey {
  const primary = primarySubtag(card.translationLanguage, 'vi');
  return primary === 'vi' || primary === 'en' ? primary : 'other';
}

/**
 * A card of a language-pack course: its own target language resolves to a pack other than
 * English (Korean, Japanese, Chinese and every pack added later). Its front teaches through the
 * example sentence and common phrases instead of the definition.
 */
export function isLanguagePackCard(card: Pick<CardData, 'language'>): boolean {
  return resolveLanguagePackId(card.language) !== 'en';
}

/**
 * Cards without a supported picture use the Study Card language form across every target language.
 */
export function usesLanguageCardForm(card: { imageUrl?: string | null }): boolean {
  return !isSupportedImageUrl(card.imageUrl);
}

/** The side half of the card's group label, naming the language that side shows. */
export function cardSideStatus(i18n: I18n, card: CardLanguages, side: 'front' | 'back'): string {
  return side === 'back'
    ? format(i18n, cardShowingMeaningLanguageMessage, { language: cardMeaningLanguageKey(card) })
    : format(i18n, cardShowingWordLanguageMessage, { language: cardTargetLanguageKey(card) });
}

/** The polite announcement after the card turns. */
export function cardSideAnnouncement(i18n: I18n, card: CardLanguages, side: 'front' | 'back'): string {
  return side === 'back'
    ? format(i18n, cardMeaningLanguageRevealedMessage, { language: cardMeaningLanguageKey(card) })
    : format(i18n, cardWordLanguageRevealedMessage, { language: cardTargetLanguageKey(card) });
}

/** Accessible name of the front's reveal control. */
export function cardRevealLabel(i18n: I18n, card: CardLanguages & Pick<CardData, 'word'>): string {
  return format(i18n, revealMeaningLanguageLabelMessage, { language: cardMeaningLanguageKey(card), word: card.word });
}

/** Accessible name of the back's return control. */
export function cardReturnLabel(i18n: I18n, card: CardLanguages & Pick<CardData, 'word'>): string {
  return format(i18n, returnToWordLanguageLabelMessage, { language: cardTargetLanguageKey(card), word: card.word });
}

/** The back header naming the meaning language: a plain language name on a standard card. */
export function cardMeaningLanguageName(i18n: I18n, card: CardLanguages): string {
  return format(i18n, backMeaningLanguageMessage, { language: cardMeaningLanguageKey(card) });
}

/** The back header of a language-pack card, as the language-card boards word it. */
export function cardInMeaningLanguage(i18n: I18n, card: CardLanguages): string {
  return format(i18n, backInMeaningLanguageMessage, { language: cardMeaningLanguageKey(card) });
}

/** Screen-reader heading of the back's meaning section. */
export function cardMeaningSectionLabel(i18n: I18n, card: CardLanguages): string {
  return format(i18n, backMeaningLabelMessage, { language: cardMeaningLanguageKey(card) });
}

/** Screen-reader heading of the back's explanation section. */
export function cardExplanationSectionLabel(i18n: I18n, card: CardLanguages): string {
  return format(i18n, backExplanationLabelMessage, { language: cardMeaningLanguageKey(card) });
}
