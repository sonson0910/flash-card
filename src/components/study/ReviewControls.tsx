import type { ReviewRating } from '../../lib/reviewScheduler';
import { Brain, Check, Gauge, RotateCcw, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';
import { triggerHaptic } from '../../lib/haptics';

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
  hoverClass: string;
  iconColor: string;
  dotColor: string;
}> = [
  {
    rating: 'again',
    label: 'Again',
    shortcut: 'Alt+1',
    icon: RotateCcw,
    selectedClass: 'bg-rose-500/20 border-rose-400 text-rose-700 dark:text-rose-200 shadow-[0_0_16px_rgba(244,63,94,0.35)] ring-1 ring-rose-400/50',
    hoverClass: 'hover:border-rose-400/80 hover:bg-rose-500/10 hover:shadow-[0_0_14px_rgba(244,63,94,0.2)]',
    iconColor: 'text-rose-500 dark:text-rose-400',
    dotColor: 'bg-rose-500',
  },
  {
    rating: 'hard',
    label: 'Hard',
    shortcut: 'Alt+2',
    icon: Gauge,
    selectedClass: 'bg-amber-500/20 border-amber-400 text-amber-700 dark:text-amber-200 shadow-[0_0_16px_rgba(245,158,11,0.35)] ring-1 ring-amber-400/50',
    hoverClass: 'hover:border-amber-400/80 hover:bg-amber-500/10 hover:shadow-[0_0_14px_rgba(245,158,11,0.2)]',
    iconColor: 'text-amber-500 dark:text-amber-400',
    dotColor: 'bg-amber-500',
  },
  {
    rating: 'good',
    label: 'Good',
    shortcut: 'Alt+3',
    icon: Brain,
    selectedClass: 'bg-emerald-500/20 border-emerald-400 text-emerald-700 dark:text-emerald-200 shadow-[0_0_16px_rgba(16,185,129,0.35)] ring-1 ring-emerald-400/50',
    hoverClass: 'hover:border-emerald-400/80 hover:bg-emerald-500/10 hover:shadow-[0_0_14px_rgba(16,185,129,0.2)]',
    iconColor: 'text-emerald-500 dark:text-emerald-400',
    dotColor: 'bg-emerald-500',
  },
  {
    rating: 'easy',
    label: 'Easy',
    shortcut: 'Alt+4',
    icon: Check,
    selectedClass: 'bg-cyan-500/20 border-cyan-400 text-cyan-700 dark:text-cyan-200 shadow-[0_0_16px_rgba(6,182,212,0.35)] ring-1 ring-cyan-400/50',
    hoverClass: 'hover:border-cyan-400/80 hover:bg-cyan-500/10 hover:shadow-[0_0_14px_rgba(6,182,212,0.2)]',
    iconColor: 'text-cyan-500 dark:text-cyan-400',
    dotColor: 'bg-cyan-500',
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
    <section
      className="relative mb-6 flex w-full max-w-md flex-col items-center gap-4 rounded-[32px] border border-slate-200/90 bg-white/95 p-4 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.1)] dark:border-white/12 dark:bg-[#071318]/90 dark:shadow-[0_25px_60px_-20px_rgba(0,0,0,0.5)] backdrop-blur-xl sm:p-5 transition-all"
      aria-label="Rate memory strength"
    >
      <p className="text-center text-sm font-bold text-[var(--sf-text)] text-balance" aria-live="polite" role={error && !saving && !reviewed ? 'alert' : undefined}>
        {message}
      </p>
      <div className="grid grid-cols-4 w-full gap-2">
        {controls.map(control => {
          const Icon = control.icon;
          return (
            <button
              key={control.rating}
              type="button"
              onClick={() => {
                triggerHaptic('light');
                onRate(control.rating);
              }}
              disabled={!revealed || reviewed || saving}
              aria-keyshortcuts={control.shortcut}
              aria-pressed={lastRating === control.rating}
              className={cn(
                'group relative min-h-16 rounded-2xl border px-1.5 py-2.5 text-xs font-black transition-all duration-200 active:scale-[0.95] flex flex-col items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 cursor-pointer',
                lastRating === control.rating
                  ? control.selectedClass
                  : cn(
                      'border-slate-200/80 bg-slate-50/80 text-[var(--sf-text)] dark:border-white/10 dark:bg-white/[0.04]',
                      control.hoverClass,
                    ),
              )}
            >
              <div className="flex items-center gap-1">
                <Icon size={16} className={cn('transition-colors', control.iconColor)} aria-hidden="true" />
                <span
                  className={cn(
                    'size-1.5 rounded-full transition-all',
                    control.dotColor,
                    lastRating === control.rating
                      ? 'animate-pulse shadow-[0_0_8px_currentColor]'
                      : 'opacity-40 group-hover:opacity-100',
                  )}
                  aria-hidden="true"
                />
              </div>
              <span className="font-black tracking-tight">{control.label}</span>
              <span className="hidden sm:inline text-[10px] font-bold opacity-60 tabular-nums">
                {control.shortcut}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
