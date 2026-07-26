export interface SpeechMatchResult {
  score: number;
  confidence: number;
  wordCoverage: number;
  matchedWords: string[];
}

const normalizeSpeech = (value: string) => value
  .toLocaleLowerCase('en-US')
  .normalize('NFKD')
  .replace(/[^a-z0-9\s']/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 500);

function levenshteinDistance(left: string, right: string): number {
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
  const normalizedTarget = normalizeSpeech(target);
  const normalizedTranscript = normalizeSpeech(transcript);
  const confidence = Math.min(1, Math.max(0, Number.isFinite(recognizerConfidence) ? recognizerConfidence : 0));
  const targetWords = normalizedTarget.split(' ').filter(Boolean);
  const transcriptWords = new Set(normalizedTranscript.split(' ').filter(Boolean));
  const matchedWords = targetWords.filter(word => transcriptWords.has(word));
  const wordCoverage = targetWords.length > 0 ? matchedWords.length / targetWords.length : 0;
  const longestLength = Math.max(normalizedTarget.length, normalizedTranscript.length, 1);
  const characterSimilarity = 1 - (levenshteinDistance(normalizedTarget, normalizedTranscript) / longestLength);
  const exactBonus = normalizedTarget.length > 0 && normalizedTarget === normalizedTranscript ? 0.1 : 0;
  const score = Math.round(Math.min(1, Math.max(0, characterSimilarity * 0.55 + wordCoverage * 0.3 + confidence * 0.15 + exactBonus)) * 100);

  return { score, confidence, wordCoverage, matchedWords };
}
