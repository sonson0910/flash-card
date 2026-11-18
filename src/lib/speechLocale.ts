import { resolveLanguagePackId, speechLocaleForPack } from '../features/languagePacks/registry';
import type { CardData } from '../types/card';

/**
 * BCP-47 locale passed to SpeechSynthesis/SpeechRecognition, derived from the
 * card's target language pack (en/ko/ja/zh). This is a pure, synchronous
 * mapping so every existing TTS/ASR call site keeps working without waiting
 * on the async language pack registry.
 */
export function speechLocaleFor(card: CardData): string {
  return speechLocaleForPack(resolveLanguagePackId(card.language));
}
