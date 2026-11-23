import { detectScriptFamily, isUnsegmentedScript } from '../features/languagePacks/scriptDetection';
import { segmentGraphemes, segmentWords } from '../features/languagePacks/unicodeSegmentation';

export interface SpeechMatchResult {
  score: number;
  confidence: number;
  wordCoverage: number;
  matchedWords: string[];
}

const MAXIMUM_SPEECH_LENGTH = 500;

/**
 * Preserved byte-for-byte for the Latin/English default path: lowercases,
 * NFKD-decomposes, then strips everything outside ASCII letters/digits. This
 * is the original English behaviour and must not change so existing English
 * pronunciation grading stays identical.
 */
const normalizeLatinSpeech = (value: string) => value
  .toLocaleLowerCase('en-US')
  .normalize('NFKD')
  .replace(/[^a-z0-9\s']/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, MAXIMUM_SPEECH_LENGTH);

/**
 * For Han/Kana/Hangul, an ASCII strip erases the entire transcript (every
 * character is outside a-z0-9), which used to collapse every non-Latin
 * pronunciation check to a meaningless near-zero score. This keeps letters
 * and digits from any script and only strips punctuation/symbols.
 */
const normalizeUnicodeSpeech = (value: string) => value
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/[\p{P}\p{S}]+/gu, ' ')
  .replace(/\s+/gu, ' ')
  .trim()
  .slice(0, MAXIMUM_SPEECH_LENGTH);

function graphemeLevenshteinDistance(left: readonly string[], right: readonly string[]): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    for (let index = 0; index <= right.length; index += 1) previous[index] = current[index];
  }

  return previous[right.length];
}

export function scoreSpeechMatch(target: string, transcript: string, recognizerConfidence = 0.75): SpeechMatchResult {
  const family = detectScriptFamily(target);
  const useUnicodeNormalization = family === 'han' || family === 'kana' || family === 'hangul';
  const normalizedTarget = useUnicodeNormalization ? normalizeUnicodeSpeech(target) : normalizeLatinSpeech(target);
  const normalizedTranscript = useUnicodeNormalization
    ? normalizeUnicodeSpeech(transcript)
    : normalizeLatinSpeech(transcript);
  const confidence = Math.min(1, Math.max(0, Number.isFinite(recognizerConfidence) ? recognizerConfidence : 0));

  const tokenize = isUnsegmentedScript(family)
    ? (value: string) => segmentWords(value).filter(Boolean)
    : (value: string) => value.split(' ').filter(Boolean);
  const targetWords = tokenize(normalizedTarget);
  const transcriptWords = new Set(tokenize(normalizedTranscript));
  const matchedWords = targetWords.filter(word => transcriptWords.has(word));
  const wordCoverage = targetWords.length > 0 ? matchedWords.length / targetWords.length : 0;

  const targetGraphemes = segmentGraphemes(normalizedTarget);
  const transcriptGraphemes = segmentGraphemes(normalizedTranscript);
  const longestLength = Math.max(targetGraphemes.length, transcriptGraphemes.length, 1);
  const characterSimilarity = 1 - (graphemeLevenshteinDistance(targetGraphemes, transcriptGraphemes) / longestLength);
  const exactBonus = normalizedTarget.length > 0 && normalizedTarget === normalizedTranscript ? 0.1 : 0;
  const score = Math.round(Math.min(1, Math.max(0, characterSimilarity * 0.55 + wordCoverage * 0.3 + confidence * 0.15 + exactBonus)) * 100);

  return { score, confidence, wordCoverage, matchedWords };
}
