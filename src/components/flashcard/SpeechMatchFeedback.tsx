import { CheckCircle2, Sparkles, Star, XCircle } from 'lucide-react';
import { detectScriptFamily } from '../../features/languagePacks/scriptDetection';
import { segmentGraphemes, segmentWords } from '../../features/languagePacks/unicodeSegmentation';

export interface SpeechMatchFeedbackValue {
  score: number;
  confidence: number;
  transcript: string;
  type: 'word' | 'explanation';
}

interface SpeechMatchFeedbackProps {
  value: SpeechMatchFeedbackValue;
  target: string;
}

const LETTER_OR_DIGIT_PATTERN = /[\p{L}\p{N}]/u;

/** NFKC + case-fold; case-folding is a harmless no-op for scripts without letter casing. */
const normalizeForDiagnostics = (value: string) => value.normalize('NFKC').toLocaleLowerCase();

export const compareWords = (target: string, transcript: string) => {
  const clean = (text: string) => normalizeForDiagnostics(text).replace(/[.,?!:;'"()\-]/g, '').trim();
  const transcriptWords = new Set(segmentWords(clean(transcript)));
  return segmentWords(clean(target)).map(word => ({ word, matched: transcriptWords.has(word) }));
};

/**
 * Grapheme-aware so a Hangul syllable, a kanji, or a combining-mark sequence
 * counts as one diagnostic unit instead of the raw `[^a-z]` strip erasing
 * every non-Latin character before any comparison happens.
 */
export const getLetterDiagnostics = (target: string, transcript: string) => {
  const cleanTarget = segmentGraphemes(normalizeForDiagnostics(target)).filter(char => LETTER_OR_DIGIT_PATTERN.test(char));
  const cleanTranscript = segmentGraphemes(normalizeForDiagnostics(transcript)).filter(char => LETTER_OR_DIGIT_PATTERN.test(char));

  if (cleanTranscript.length === 0) {
    return cleanTarget.map(char => ({ char, status: 'missing' as const }));
  }

  const result: Array<{ char: string; status: 'correct' | 'near' | 'missing' }> = [];
  for (let i = 0; i < cleanTarget.length; i += 1) {
    const targetChar = cleanTarget[i];
    const transChar = cleanTranscript[i];

    if (transChar === targetChar) {
      result.push({ char: targetChar, status: 'correct' });
    } else if (cleanTranscript.includes(targetChar)) {
      result.push({ char: targetChar, status: 'near' });
    } else {
      result.push({ char: targetChar, status: 'missing' });
    }
  }
  return result;
};

export const getPronunciationTip = (score: number, target: string, transcript: string) => {
  if (score >= 90) return '🎉 Outstanding! Natural and accurate pronunciation.';
  if (score >= 70) return '👍 Good job! Emphasize the stress and ending consonants.';
  // The ending-consonant tip only makes sense for Latin/English orthography;
  // other scripts get the generic slow-repeat tip instead of a nonsensical
  // "/x/" suffix check against a non-Latin transcript.
  if (detectScriptFamily(target) === 'latin') {
    const cleanTarget = target.toLowerCase().replace(/[^a-z]/g, '');
    const lastChar = cleanTarget.slice(-1);
    if (['s', 't', 'd', 'k', 'p', 'z'].includes(lastChar) && !transcript.toLowerCase().endsWith(lastChar)) {
      return `💡 Tip: Pronounce the ending sound "/${lastChar}/" clearly.`;
    }
  }
  return '💡 Tip: Listen at 0.75x slow speed and repeat each syllable.';
};

export function SpeechMatchFeedback({ value, target }: SpeechMatchFeedbackProps) {
  const isWordCheck = value.type === 'word';

  return (
    <div className="mb-3 flex flex-col items-center gap-2 w-full text-center" role="status" aria-live="polite">
      {/* Score Badge */}
      <div className={`text-xs font-black px-3.5 py-1 rounded-full flex items-center gap-1.5 shadow-md ${
        value.score >= 80 ? 'bg-emerald-500 text-[#071014]' : value.score >= 50 ? 'bg-amber-400 text-[#071014]' : 'bg-rose-500 text-white'
      }`}>
        {value.score >= 80 ? <CheckCircle2 size={12} /> : value.score >= 50 ? <Star size={12} className="fill-current" /> : <XCircle size={12} />}
        <span>{isWordCheck ? 'Word match' : 'Sentence match'}: {value.score}%</span>
      </div>

      {/* Visual Diagnostic Display */}
      <div className="flex max-w-[280px] flex-wrap items-center justify-center gap-1 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3 py-1.5">
        {compareWords(target, value.transcript).map((item, index) => (
          <span key={`${item.word}-${index}`} className={`text-xs font-black px-1.5 py-0.5 rounded transition-colors ${
            item.matched
              ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30'
              : 'text-rose-600 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 line-through decoration-rose-300'
          }`}>
            {item.word}
          </span>
        ))}
      </div>

      {/* Transcript & Feedback Tip */}
      <span className="max-w-[280px] truncate text-xs font-bold text-[var(--sf-text)]">
        Browser recognised: “{value.transcript || '...'}”
      </span>
      <p className="text-[11px] font-medium text-cyan-800 dark:text-cyan-300 flex items-center justify-center gap-1 max-w-[280px]">
        <Sparkles size={11} className="shrink-0 text-cyan-500 dark:text-cyan-400" />
        <span>The browser checks whether the intended words were recognised; it does not assess individual sounds, phonemes, or accent.</span>
      </p>
    </div>
  );
}
