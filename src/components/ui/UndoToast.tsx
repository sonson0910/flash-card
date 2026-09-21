import { RotateCcw, X } from 'lucide-react';
import { useEffect, useRef, useState, type FocusEvent } from 'react';

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

export function createUndoTimeout(duration: number, onElapsed: () => void) {
  let remaining = duration;
  let startedAt = Date.now();
  let timer: number | null = window.setTimeout(onElapsed, remaining);

  const pause = () => {
    if (timer === null) return;
    window.clearTimeout(timer);
    timer = null;
    remaining = Math.max(0, remaining - (Date.now() - startedAt));
  };

  const resume = () => {
    if (timer !== null || remaining === 0) return;
    startedAt = Date.now();
    timer = window.setTimeout(onElapsed, remaining);
  };

  return { pause, resume, dispose: pause };
}

export function UndoToast({ toast, onDismiss }: UndoToastProps) {
  const duration = toast?.durationMs ?? 5000;
  const onDismissRef = useRef(onDismiss);
  const dismissedRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof createUndoTimeout> | null>(null);
  const hoveredRef = useRef(false);
  const focusedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  onDismissRef.current = onDismiss;

  const updatePause = () => {
    const shouldPause = hoveredRef.current || focusedRef.current;
    if (shouldPause) timeoutRef.current?.pause();
    else timeoutRef.current?.resume();
    setPaused(shouldPause);
  };

  const dismissOnce = () => {
    if (dismissedRef.current) return false;
    dismissedRef.current = true;
    onDismissRef.current();
    return true;
  };

  useEffect(() => {
    if (!toast) return;
    dismissedRef.current = false;
    timeoutRef.current = createUndoTimeout(duration, dismissOnce);
    updatePause();
    return () => timeoutRef.current?.dispose();
  }, [duration, toast?.id]);

  if (!toast) return null;

  return (
    <div
      role="alert"
      onPointerEnter={() => {
        hoveredRef.current = true;
        updatePause();
      }}
      onPointerLeave={() => {
        hoveredRef.current = false;
        updatePause();
      }}
      onFocusCapture={() => {
        focusedRef.current = true;
        updatePause();
      }}
      onBlurCapture={(event: FocusEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          focusedRef.current = false;
          updatePause();
        }
      }}
      className="fixed bottom-6 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center justify-between gap-3 overflow-hidden rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] p-4 text-[var(--sf-text)] shadow-2xl animate-bounce-short"
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
            if (dismissOnce()) toast.onUndo();
          }}
          className="flex min-h-11 items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-all hover:opacity-90 active:scale-95"
        >
          <RotateCcw size={13} />
          <span>Undo</span>
        </button>
        <button
          type="button"
          onClick={dismissOnce}
          className="flex size-11 items-center justify-center rounded-lg text-[var(--sf-text-muted)] hover:bg-[var(--sf-surface-raised)] hover:text-[var(--sf-text)]"
          aria-label="Dismiss notification"
        >
          <X size={14} />
        </button>
      </div>

      {/* Countdown progress line */}
      <div className="absolute bottom-0 left-0 h-1 w-full bg-[var(--sf-surface-muted)]">
        <div
          key={`${toast.id}:${duration}`}
          className="undo-toast-progress h-full origin-left bg-amber-500"
          style={{ animationDuration: `${duration}ms`, animationPlayState: paused ? 'paused' : 'running' }}
        />
      </div>
    </div>
  );
}
