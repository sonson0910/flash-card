import { resolveLanguagePackId, speechLocaleForPack } from '../features/languagePacks/registry';
import { createCardIdentityHash, normalizeCardLanguage } from './cardIdentity';
import type { CardData } from '../types/card';

type VoiceLike = Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'voiceURI'>;

export interface ActiveCourseVoiceSettings {
  readonly targetLanguage: string;
  readonly preferences: { readonly pronunciationVariant: string | null };
}

const language = (value: unknown): string => {
  const normalized = normalizeCardLanguage(typeof value === 'string' ? value.replace(/_/g, '-') : value);
  const primary = normalized.split('-')[0] ?? '';
  return primary === 'cmn' ? 'zh' : primary;
};
const locale = (value: unknown): string => typeof value === 'string' ? value.trim().toLowerCase().replace(/_/g, '-') : '';
const voiceIdentity = (voice: VoiceLike): string => `${voice.voiceURI}\u0000${voice.lang}\u0000${voice.name}`;

/** A short deterministic key fits the server's 64-character preference field. */
export function courseVoicePreferenceKey(voice: VoiceLike): string {
  return `v1-${createCardIdentityHash(voiceIdentity(voice)).slice(0, 16)}`;
}

export function voicesForTargetLanguage(
  voices: readonly SpeechSynthesisVoice[],
  targetLanguage: string,
): SpeechSynthesisVoice[] {
  const target = language(targetLanguage);
  return target ? voices.filter(voice => language(voice.lang) === target) : [];
}

function readVoices(): SpeechSynthesisVoice[] {
  const synthesis = typeof window === 'undefined' ? undefined : window.speechSynthesis;
  if (!synthesis || typeof synthesis.getVoices !== 'function') return [];
  try { return [...synthesis.getVoices()]; } catch { return []; }
}

export function voiceForActiveCourseCard(
  card: Pick<CardData, 'language'>,
  course: ActiveCourseVoiceSettings | null | undefined,
  voices: readonly SpeechSynthesisVoice[] = readVoices(),
): SpeechSynthesisVoice | undefined {
  if (!course) return undefined;
  const target = language(course.targetLanguage);
  if (!target || language(card.language === undefined ? 'en' : card.language) !== target) return undefined;
  const matching = voicesForTargetLanguage(voices, target);
  const saved = course.preferences.pronunciationVariant
    && matching.find(voice => courseVoicePreferenceKey(voice) === course.preferences.pronunciationVariant);
  if (saved) return saved;
  const exact = matching.filter(voice => locale(voice.lang) === locale(speechLocaleForPack(resolveLanguagePackId(target))));
  return exact.find(voice => voice.default) ?? exact[0] ?? matching.find(voice => voice.default) ?? matching[0];
}

export const readSpeechSynthesisVoices = readVoices;
