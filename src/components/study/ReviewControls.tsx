import type { ReviewRating } from '../../lib/reviewScheduler';
import { Brain, Check, Gauge, RotateCcw, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';

interface ReviewControlsProps {
  revealed: boolean;
  reviewed: boolean;
  saving?: boolean;
  error?: string | null;
  lastRating?: ReviewRating;
  onRate: (rating: ReviewRating) => void;
}

const controls: Array<{
  rating: ReviewRating;
  label: string;
  shortcut: string;
  icon: LucideIcon;
  selectedClass: string;
}> = [
  {
    rating: 'again', label: 'Again', shortcut: 'Alt+1', icon: RotateCcw,
    selectedClass: 'bg-rose-50 dark:bg-rose-950/25 border-rose-300 dark:border-rose-900 text-rose-700 dark:text-rose-300',
  },
  {
    rating: 'hard', label: 'Hard', shortcut: 'Alt+2', icon: Gauge,
    selectedClass: 'bg-orange-50 dark:bg-orange-950/25 border-orange-300 dark:border-orange-900 text-orange-700 dark:text-orange-300',
  },
  {
    rating: 'good', label: 'Good', shortcut: 'Alt+3', icon: Brain,
    selectedClass: 'bg-cyan-50 dark:bg-cyan-950/25 border-[var(--sf-brand)] text-[var(--sf-brand-text)]',
  },
  {
    rating: 'easy', label: 'Easy', shortcut: 'Alt+4', icon: Check,
    selectedClass: 'bg-emerald-50 dark:bg-emerald-950/25 border-emerald-300 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300',
  },
];

export function ReviewControls({
  revealed,
  reviewed,
  saving = false,
  error = null,
  lastRating,
  onRate,
}: ReviewControlsProps) {
  const message = !revealed
    ? 'Reveal the answer before rating'
    : saving
      ? 'Saving review…'
      : reviewed
        ? 'Review saved. Move to the next card.'
        : error ?? 'How well did you remember this card?';
  return (
    <section data-review-controls="true" data-study-surface="review-controls" className="mb-6 flex w-full max-w-md flex-col items-center gap-4 rounded-[32px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-4 shadow-lg sm:p-5" aria-label="Rate memory strength">
      <p className="text-center text-sm font-bold text-[var(--sf-text)] text-balance" aria-live="polite" role={error && !saving && !reviewed ? 'alert' : undefined}>
        {message}
      </p>
      <div data-review-actions="true" className="grid grid-cols-4 w-full gap-2">
        {controls.map(control => {
          const Icon = control.icon;
          return <button
            key={control.rating}
            type="button"
            onClick={() => onRate(control.rating)}
            disabled={!revealed || reviewed || saving}
            aria-keyshortcuts={control.shortcut}
            aria-pressed={lastRating === control.rating}
            className={cn(
              'min-h-16 rounded-xl border px-1.5 py-2 text-xs font-bold transition-[filter,scale,border-color,background-color,color] active:scale-[0.98] flex flex-col items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100',
              lastRating === control.rating
                ? control.selectedClass
                : 'bg-[var(--sf-surface-raised)] border-[var(--sf-border)] text-[var(--sf-text)] hover:border-[var(--sf-brand)]',
            )}
          >
            <Icon size={17} aria-hidden="true" />
            <span>{control.label}</span>
            <span className="hidden sm:inline text-xs opacity-70 tabular-nums">Key {control.shortcut}</span>
          </button>
        })}
      </div>
    </section>
  );
}
