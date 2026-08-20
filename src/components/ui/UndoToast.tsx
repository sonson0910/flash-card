import { RotateCcw, X } from 'lucide-react';
import { useEffect, useState } from 'react';

export interface UndoToastItem {
  id: string;
  message: string;
  onUndo: () => void;
  durationMs?: number;
}

interface UndoToastProps {
  toast: UndoToastItem | null;
  onDismiss: () => void;
}

export function UndoToast({ toast, onDismiss }: UndoToastProps) {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    if (!toast) {
      setProgress(100);
      return;
    }

    const duration = toast.durationMs || 5000;
    const interval = 50;
    const step = (interval / duration) * 100;

    const timer = setInterval(() => {
      setProgress(prev => prev - step);
    }, interval);

    return () => clearInterval(timer);
  }, [toast]);

  useEffect(() => {
    if (progress <= 0 && toast) {
      onDismiss();
    }
  }, [progress, toast, onDismiss]);

  if (!toast) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-6 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center justify-between gap-3 overflow-hidden rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] p-4 text-[var(--sf-text)] shadow-2xl backdrop-blur-xl animate-bounce-short"
    >
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-xs font-semibold text-[var(--sf-text)] truncate">
          {toast.message}
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => {
            toast.onUndo();
            onDismiss();
          }}
          className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-all hover:opacity-90 active:scale-95"
        >
          <RotateCcw size={13} />
          <span>Undo</span>
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="flex size-7 items-center justify-center rounded-lg text-[var(--sf-text-muted)] hover:bg-[var(--sf-surface-raised)] hover:text-[var(--sf-text)]"
          aria-label="Dismiss notification"
        >
          <X size={14} />
        </button>
      </div>

      {/* Countdown progress line */}
      <div className="absolute bottom-0 left-0 h-1 w-full bg-[var(--sf-surface-muted)]">
        <div
          className="h-full bg-amber-500 transition-all duration-75"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
