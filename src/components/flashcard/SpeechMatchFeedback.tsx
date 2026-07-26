import { CheckCircle2, Star, XCircle } from 'lucide-react';

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

export function SpeechMatchFeedback({ value, target }: SpeechMatchFeedbackProps) {
  return (
    <div className="mb-3 flex flex-col items-center gap-1.5 w-full" role="status" aria-live="polite">
      <div className={`text-xs font-black px-2.5 py-1 rounded-full flex items-center gap-1 shadow-sm ${
        value.score >= 80 ? 'bg-emerald-600 text-white' : value.score >= 50 ? 'bg-amber-500 text-white' : 'bg-rose-600 text-white'
      }`}>
        {value.score >= 80 ? <CheckCircle2 size={10} /> : value.score >= 50 ? <Star size={10} className="fill-white" /> : <XCircle size={10} />}
        <span>{value.type === 'word' ? 'Word match' : 'Sentence match'}: {value.score}%</span>
      </div>

      <div className="flex max-w-[260px] flex-wrap items-center justify-center gap-1 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-2.5 py-1">
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
      <span className="max-w-[260px] truncate text-xs font-bold italic leading-relaxed text-[var(--sf-text)]">You said: “{value.transcript || '...'}”</span>
      <span className="text-pretty text-xs font-semibold text-[var(--sf-text-muted)]">Recognition confidence: {Math.round(value.confidence * 100)}%. This is not a phoneme-level assessment.</span>
    </div>
  );
}
