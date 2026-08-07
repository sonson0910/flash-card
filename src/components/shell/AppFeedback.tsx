import { AlertCircle, CheckCircle2, X } from 'lucide-react';

export interface AppFeedbackProps {
  authError?: string | null;
  error?: string | null;
  notice?: string | null;
  onDismissAuthError?: () => void;
  onDismissError?: () => void;
  onDismissNotice?: () => void;
}

export function AppFeedback({
  authError,
  error,
  notice,
  onDismissAuthError,
  onDismissError,
  onDismissNotice,
}: AppFeedbackProps) {
  return (
    <>
      {authError && (
        <div role="alert" aria-atomic="true" className="mx-4 mt-3 sm:mx-8 flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 shadow-sm dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
          <span>{authError}</span>
          {onDismissAuthError && (
            <button type="button" onClick={onDismissAuthError} className="min-h-11 min-w-11 shrink-0 rounded-lg p-2 hover:bg-rose-100 dark:hover:bg-rose-900/50" aria-label="Dismiss sign-in message">
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {error && (
        <div role="alert" aria-atomic="true" className="mx-4 mt-3 sm:mx-8 flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
          <span className="flex items-start gap-2"><AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden="true" /> {error}</span>
          {onDismissError && (
            <button type="button" onClick={onDismissError} className="min-h-11 min-w-11 shrink-0 rounded-lg p-2 hover:bg-amber-100 dark:hover:bg-amber-900/50" aria-label="Dismiss system message">
              <X size={16} className="mx-auto" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {notice && (
        <div role="status" aria-atomic="true" className="mx-4 mt-3 sm:mx-8 flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          <span className="flex items-start gap-2"><CheckCircle2 size={18} className="mt-0.5 shrink-0" aria-hidden="true" /> {notice}</span>
          {onDismissNotice && (
            <button type="button" onClick={onDismissNotice} className="min-h-11 min-w-11 shrink-0 rounded-lg p-2 hover:bg-emerald-100 dark:hover:bg-emerald-900/50" aria-label="Dismiss success message">
              <X size={16} className="mx-auto" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </>
  );
}
