/**
 * Single source of truth for classifying which writing system a string uses.
 * Shared by script-aware answer scoring (scriptScoring.ts), speech matching
 * (speechMatch.ts) and the language pack registry so every consumer agrees
 * on the same script boundaries.
 */
export type ScriptFamily = 'latin' | 'han' | 'kana' | 'hangul' | 'fallback';

/**
 * Kana is checked before Han so mixed Japanese text (which freely combines
 * kanji and kana) is classified as 'kana' rather than 'han'. Order matters.
 */
export function detectScriptFamily(value: unknown): ScriptFamily {
  if (typeof value !== 'string') return 'fallback';
  const normalized = value.normalize('NFKC');
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(normalized)) return 'kana';
  if (/\p{Script=Hangul}/u.test(normalized)) return 'hangul';
  if (/\p{Script=Han}/u.test(normalized)) return 'han';
  if (/\p{Script=Latin}/u.test(normalized)) return 'latin';
  return 'fallback';
}

/** Han and Kana text is conventionally written without inter-word spaces. */
export function isUnsegmentedScript(family: ScriptFamily): boolean {
  return family === 'han' || family === 'kana';
}
