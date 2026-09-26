import type { SpeechMatchResult } from '../../lib/speechMatch';
import type { ScriptFamily } from './scriptDetection';

/** Wave-1 target-language packs. Additional waves extend this union additively. */
export type LanguagePackId = 'en' | 'ko' | 'ja' | 'zh';

export const LANGUAGE_PACK_IDS: readonly LanguagePackId[] = ['en', 'ko', 'ja', 'zh'];

export type PinyinTone = 1 | 2 | 3 | 4 | 5;

export interface PinyinToneSyllable {
  readonly text: string;
  readonly tone: PinyinTone;
}

/**
 * A reading annotation for a headword: Hangul romanization, kana furigana,
 * or pinyin. `readingText` is null when there is nothing reliable to show,
 * so a caller must hide the toggle rather than render an empty reading -
 * that is the fallback contract non-English cards get in place of English's
 * IPA phonetic.
 */
export interface HeadwordReadingPlan {
  readonly readingText: string | null;
  /** BCP-47 lang attribute for the reading annotation itself. */
  readonly readingLang: string;
  readonly kind: 'romanization' | 'furigana' | 'pinyin';
  /** Populated only for the pinyin pack when tone diacritics are present. */
  readonly toneSyllables?: readonly PinyinToneSyllable[];
}

export interface LanguagePackRendering {
  buildReadingPlan(card: { readonly word: string; readonly phonetic?: string | null }): HeadwordReadingPlan;
}

export interface LanguagePackNormalization {
  readonly scriptFamily: ScriptFamily;
}

export interface LanguagePackTokenization {
  segmentGraphemes(value: string): string[];
  segmentWords(value: string): string[];
}

export interface LanguagePackSpeech {
  /** BCP-47 locale passed to SpeechSynthesis/SpeechRecognition. */
  readonly speechLocale: string;
  scoreTranscript(target: string, transcript: string, recognizerConfidence?: number): SpeechMatchResult;
}

export interface LanguagePackGoal {
  readonly id: string;
  /** Static Lingui message id; the catalog owns the translated label text. */
  readonly labelId: string;
  readonly labelMessage: string;
}

export interface LanguagePackGoalCatalog {
  readonly goals: readonly LanguagePackGoal[];
}

export interface LanguagePack {
  readonly id: LanguagePackId;
  readonly rendering: LanguagePackRendering;
  readonly normalization: LanguagePackNormalization;
  readonly tokenization: LanguagePackTokenization;
  readonly speech: LanguagePackSpeech;
  readonly goalCatalog: LanguagePackGoalCatalog;
}
