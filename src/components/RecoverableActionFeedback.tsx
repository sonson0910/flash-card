import { X } from 'lucide-react';
import { cn } from '../lib/cn';

interface RecoverableActionFeedbackProps {
  message: string;
  retryLabel?: string;
  onRetry?: () => void;
  dismissLabel: string;
  onDismiss: () => void;
  className?: string;
}

export function RecoverableActionFeedback({
  message,
  retryLabel,
  onRetry,
  dismissLabel,
  onDismiss,
  className,
}: RecoverableActionFeedbackProps) {
  return (
    <div
      role="alert"
      aria-atomic="true"
      className={cn(
        'crystal-chamfer-sm mt-3 flex items-center gap-2 border border-[var(--sf-danger)] bg-[color-mix(in_srgb,var(--sf-danger)_10%,var(--sf-surface))] p-2 text-left text-xs font-semibold text-[var(--sf-text)]',
        className,
      )}
    >
      <p className="min-w-0 flex-1 px-1 leading-5">{message}</p>
      {retryLabel && onRetry ? (
        <button
          type="button"
          data-card-control
          onPointerDown={event => event.stopPropagation()}
          onClick={event => {
            event.stopPropagation();
            onRetry();
          }}
          className="min-h-11 shrink-0 rounded-lg border border-current px-3 font-bold transition-colors hover:bg-rose-100 dark:hover:bg-rose-900"
        >
          {retryLabel}
        </button>
      ) : null}
      <button
        type="button"
        data-card-control
        onPointerDown={event => event.stopPropagation()}
        onClick={event => {
          event.stopPropagation();
          onDismiss();
        }}
        className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-rose-100 dark:hover:bg-rose-900"
        aria-label={dismissLabel}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
