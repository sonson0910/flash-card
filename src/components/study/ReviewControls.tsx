import type { CSSProperties } from 'react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import type { ReviewRating } from '../../lib/reviewScheduler';
import { triggerHaptic } from '../../lib/haptics';
import { useCardLook } from '../flashcard/cardLook';
import '../flashcard/flashcard-canvas.css';

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
}> = [
  {
    rating: 'again',
    label: msg({ id: 'review.again', message: 'Again' }),
    shortcut: 'Alt+1',
  },
  {
    rating: 'hard',
    label: msg({ id: 'review.hard', message: 'Hard' }),
    shortcut: 'Alt+2',
  },
  {
    rating: 'good',
    label: msg({ id: 'review.good', message: 'Good' }),
    shortcut: 'Alt+3',
  },
  {
    rating: 'easy',
    label: msg({ id: 'review.easy', message: 'Easy' }),
    shortcut: 'Alt+4',
  },
];

const ratingTokens: Record<ReviewRating, string> = {
  again: 'var(--sf-rating-again, var(--sf-danger))',
  hard: 'var(--sf-rating-hard, var(--sf-reward))',
  good: 'var(--sf-rating-good, var(--sf-success))',
  easy: 'var(--sf-rating-easy, var(--sf-second))',
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
  const look = useCardLook();
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
      data-card-look={look}
      className="review-grades relative mb-6 flex w-full max-w-xl flex-col items-center gap-3"
      aria-label={_(msg({ id: 'review.strength', message: 'Rate memory strength' }))}
    >
      <p className="review-grades-message text-center text-balance" aria-live="polite" role={error && !saving && !reviewed ? 'alert' : undefined}>
        {message}
      </p>
      <div className="review-grades-row grid w-full grid-cols-4 gap-2">
        {controls.map(control => (
          <button
            key={control.rating}
            type="button"
            data-rating={control.rating}
            onClick={() => {
              triggerHaptic('light');
              onRate(control.rating);
            }}
            disabled={!revealed || reviewed || saving}
            aria-keyshortcuts={control.shortcut}
            aria-pressed={lastRating === control.rating}
            style={{ '--rating-color': ratingTokens[control.rating] } as CSSProperties}
            className="review-grade group relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 px-2 py-2 transition-[transform,box-shadow,border-color,background-color] duration-200 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rating-color)] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 motion-reduce:transition-none"
          >
            <span className="review-grade-face flex flex-col items-center gap-1">
              <span className="review-grade-label flex items-center gap-[7px]">
                <span className="review-grade-dot" aria-hidden="true" />
                <span className="truncate">{_(control.label)}</span>
              </span>
              <span className="review-grade-key hidden font-mono tabular-nums sm:inline">{control.shortcut}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
