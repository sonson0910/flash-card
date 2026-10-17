import type { CSSProperties } from 'react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
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
  label: ReturnType<typeof msg>;
  shortcut: string;
  icon: LucideIcon;
}> = [
  {
    rating: 'again',
    label: msg({ id: 'review.again', message: 'Again' }),
    shortcut: 'Alt+1',
    icon: RotateCcw,
  },
  {
    rating: 'hard',
    label: msg({ id: 'review.hard', message: 'Hard' }),
    shortcut: 'Alt+2',
    icon: Gauge,
  },
  {
    rating: 'good',
    label: msg({ id: 'review.good', message: 'Good' }),
    shortcut: 'Alt+3',
    icon: Brain,
  },
  {
    rating: 'easy',
    label: msg({ id: 'review.easy', message: 'Easy' }),
    shortcut: 'Alt+4',
    icon: Check,
  },
];

const ratingTokens: Record<ReviewRating, string> = {
  again: 'var(--sf-danger)',
  hard: 'var(--sf-reward)',
  good: 'var(--sf-success)',
  easy: 'var(--sf-second)',
};

export function ReviewControls({
  revealed,
  reviewed,
  saving = false,
  error = null,
  lastRating,
  onRate,
}: ReviewControlsProps) {
  const { _ } = useLingui();
  const message = !revealed
    ? _(msg({ id: 'review.reveal-before-rating', message: 'Reveal the answer before rating' }))
    : saving
      ? _(msg({ id: 'review.saving', message: 'Saving review…' }))
      : reviewed
        ? _(msg({ id: 'review.saved', message: 'Review saved. Move to the next card.' }))
        : error ?? _(msg({ id: 'review.prompt', message: 'How well did you remember this card?' }));
  return (
    <section
      data-review-state={revealed ? 'ready' : 'locked'}
      className="practice-rating-board crystal-chamfer relative mb-6 flex w-full max-w-xl flex-col items-center gap-3 rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface-glass)] p-3 shadow-[var(--sf-panel-shadow)] backdrop-blur-xl sm:p-4"
      aria-label={_(msg({ id: 'review.strength', message: 'Rate memory strength' }))}
    >
      <p className="text-center text-sm font-bold text-[var(--sf-text)] text-balance" aria-live="polite" role={error && !saving && !reviewed ? 'alert' : undefined}>
        {message}
      </p>
      <div className="grid w-full grid-cols-4 gap-2">
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
              style={{ '--rating-color': ratingTokens[control.rating] } as CSSProperties}
              className={cn(
                'crystal-chamfer-sm group relative flex min-h-14 flex-col items-center justify-center gap-1 border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-2 py-2 text-xs font-black text-[var(--sf-text)] transition-[transform,box-shadow,border-color] duration-200 hover:border-[var(--rating-color)] hover:shadow-[0_8px_22px_-14px_var(--rating-color)] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rating-color)] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 motion-reduce:transition-none',
                lastRating === control.rating
                  ? 'border-[var(--rating-color)] bg-[var(--sf-surface-raised)] shadow-[0_0_20px_-10px_var(--rating-color)] ring-1 ring-[var(--rating-color)]'
                  : '',
              )}
            >
              <div className="flex items-center gap-1">
                <Icon size={16} className="text-[var(--rating-color)]" aria-hidden="true" />
                <span
                  className={cn(
                    'size-1.5 rounded-full bg-[var(--rating-color)] transition-opacity',
                    lastRating === control.rating
                      ? 'animate-pulse shadow-[0_0_8px_var(--rating-color)] motion-reduce:animate-none'
                      : 'opacity-40 group-hover:opacity-100',
                  )}
                  aria-hidden="true"
                />
              </div>
              <span className="font-black tracking-tight">{_(control.label)}</span>
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
