import { CheckCircle2, Sparkles, Star, XCircle } from 'lucide-react';

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

const compareWords = (target: string, transcript: string) => {
  const clean = (text: string) => text.toLocaleLowerCase('en-US').replace(/[.,?!:;'"()\-]/g, '').trim();
  const transcriptWords = new Set(clean(transcript).split(/\s+/).filter(Boolean));
  return clean(target).split(/\s+/).filter(Boolean).map(word => ({ word, matched: transcriptWords.has(word) }));
};

const getLetterDiagnostics = (target: string, transcript: string) => {
  const cleanTarget = target.toLowerCase().replace(/[^a-z]/g, '');
  const cleanTranscript = transcript.toLowerCase().replace(/[^a-z]/g, '');

  if (!cleanTranscript) {
    return Array.from(cleanTarget).map(char => ({ char, status: 'missing' as const }));
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

const getPronunciationTip = (score: number, target: string, transcript: string) => {
  if (score >= 90) return '🎉 Outstanding! Natural and accurate pronunciation.';
  if (score >= 70) return '👍 Good job! Emphasize the stress and ending consonants.';
  const cleanTarget = target.toLowerCase().replace(/[^a-z]/g, '');
  const lastChar = cleanTarget.slice(-1);
  if (['s', 't', 'd', 'k', 'p', 'z'].includes(lastChar) && !transcript.toLowerCase().endsWith(lastChar)) {
    return `💡 Tip: Pronounce the ending sound "/${lastChar}/" clearly.`;
  }
  return '💡 Tip: Listen at 0.75x slow speed and repeat each syllable.';
};

export function SpeechMatchFeedback({ value, target }: SpeechMatchFeedbackProps) {
  const isWordCheck = value.type === 'word';
  const letterDiagnostics = isWordCheck ? getLetterDiagnostics(target, value.transcript) : null;
  const tip = getPronunciationTip(value.score, target, value.transcript);

  return (
    <div className="mb-3 flex flex-col items-center gap-2 w-full text-center" role="status" aria-live="polite">
      {/* Score Badge */}
      <div className={`text-xs font-black px-3.5 py-1 rounded-full flex items-center gap-1.5 shadow-md ${
        value.score >= 80
          ? 'bg-emerald-700 text-white dark:bg-emerald-500 dark:text-[#071014]'
          : value.score >= 50
            ? 'bg-amber-700 text-white dark:bg-amber-400 dark:text-[#071014]'
            : 'bg-rose-700 text-white dark:bg-rose-700'
      }`}>
        {value.score >= 80 ? <CheckCircle2 size={12} /> : value.score >= 50 ? <Star size={12} className="fill-current" /> : <XCircle size={12} />}
        <span>{isWordCheck ? 'Pronunciation match' : 'Sentence match'}: {value.score}%</span>
      </div>

      {/* Visual Diagnostic Display */}
      {isWordCheck && letterDiagnostics ? (
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-1.5 shadow-inner dark:border-white/15 dark:bg-white/5">
            {letterDiagnostics.map((item, idx) => (
              <span
                key={`${item.char}-${idx}`}
                className={`font-mono text-sm font-black uppercase px-1 py-0.5 rounded ${
                  item.status === 'correct'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-500/40 dark:bg-emerald-500/20 dark:text-emerald-400'
                    : item.status === 'near'
                      ? 'bg-amber-50 text-amber-800 border border-amber-500/40 dark:bg-amber-500/20 dark:text-amber-300'
                      : 'bg-rose-50 text-rose-700 border border-rose-500/40 dark:bg-rose-500/20 dark:text-rose-300 line-through'
                }`}
                title={item.status === 'correct' ? 'Accurate' : item.status === 'near' ? 'Near match' : 'Missing'}
              >
                {item.char}
              </span>
            ))}
          </div>
        </div>
      ) : (
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
      )}

      {/* Transcript & Feedback Tip */}
      <span className="max-w-[280px] truncate text-xs font-bold text-[var(--sf-text)]">
        Microphone heard: “{value.transcript || '...'}”
      </span>
      <p className="text-[11px] font-medium text-cyan-700 dark:text-cyan-300 flex items-center justify-center gap-1 max-w-[280px]">
        <Sparkles size={11} className="shrink-0 text-cyan-600 dark:text-cyan-400" />
        <span>{tip}</span>
      </p>
    </div>
  );
}
