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
        'mt-3 flex items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 p-2 text-left text-xs font-semibold text-rose-800 dark:border-rose-800 dark:bg-rose-950/80 dark:text-rose-100',
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
