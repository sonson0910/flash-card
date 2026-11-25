import { resolveLanguagePackId, speechLocaleForPack } from '../features/languagePacks/registry';
import type { CardData } from '../types/card';

// Target languages that have no language pack yet still need their own voice.
const SPEECH_LOCALE_BY_LANGUAGE: Readonly<Record<string, string>> = {
  fr: 'fr-FR',
  de: 'de-DE',
  es: 'es-ES',
};

/**
 * BCP-47 locale passed to SpeechSynthesis/SpeechRecognition, derived from the
 * card's target language pack (en/ko/ja/zh), or from the card's own language
 * when it has no pack. This is a pure, synchronous mapping so every existing
 * TTS/ASR call site keeps working without waiting on the async language pack
 * registry.
 */
export function speechLocaleFor(card: Pick<CardData, 'language'>): string {
  const pack = resolveLanguagePackId(card.language);
  if (pack !== 'en') return speechLocaleForPack(pack);
  const primary = (card.language ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return SPEECH_LOCALE_BY_LANGUAGE[primary] ?? speechLocaleForPack(pack);
}
