import { X } from 'lucide-react';
import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { Trans } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import '../feedback-toast.css';

export interface UndoToastItem {
  id: string;
  message: string;
  subject?: string;
  onUndo: () => void;
  durationMs?: number;
}

export function isUndoKeyboardShortcut(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'target'>) {
  if (event.key.toLowerCase() !== 'z' || (!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey) return false;
  const target = event.target as { closest?: (selector: string) => Element | null } | null;
  return !target?.closest?.('input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])');
}

interface UndoToastProps {
  toast: UndoToastItem | null;
  onDismiss: () => void;
  stacked?: boolean;
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

export function UndoToast({ toast, onDismiss, stacked = false }: UndoToastProps) {
  const { _ } = useLingui();
  const duration = toast?.durationMs ?? 6000;
  const onDismissRef = useRef(onDismiss);
  const dismissedRef = useRef(false);
  const onUndoRef = useRef(toast?.onUndo);
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

  onUndoRef.current = toast?.onUndo;

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

  useEffect(() => {
    if (!toast) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (dismissedRef.current || !isUndoKeyboardShortcut(event)) return;
      event.preventDefault();
      if (dismissOnce()) onUndoRef.current?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toast?.id]);

  if (!toast) return null;
  const shortcut = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘Z'
    : 'Ctrl+Z';
  const positionClasses = stacked
    ? 'relative z-[75] w-full'
    : 'fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 z-[75] w-[min(25rem,calc(100vw-2rem))] sm:right-6 lg:bottom-4';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-undo-toast="true"
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
      className={`notification-toast undo-toast pointer-events-auto ${positionClasses}`}
    >
      <span className={`undo-toast-message${toast.subject ? ' undo-toast-message--with-subject' : ''}`}>
        <span className="undo-toast-copy">{toast.message}</span>
        {toast.subject ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="undo-toast-subject">{toast.subject}</span>
          </>
        ) : null}
      </span>

      <div className="undo-toast-actions">
        <button
          type="button"
          onClick={() => {
            if (dismissOnce()) onUndoRef.current?.();
          }}
          aria-keyshortcuts="Meta+Z Control+Z"
          className="undo-toast-action"
        >
          <span><Trans id="shell.undo.action" message="Undo" /></span>
          <kbd className="undo-toast-shortcut">{shortcut}</kbd>
        </button>
        <button
          type="button"
          onClick={dismissOnce}
          className="undo-toast-dismiss"
          aria-label={_(msg({ id: 'shell.undo.dismiss', message: 'Dismiss notification' }))}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <span className="sr-only">
        <Trans id="shell.undo.window" message="Undo is available for {seconds} seconds." values={{ seconds: Math.ceil(duration / 1000) }} />
      </span>
      <div className="undo-toast-progress-track" aria-hidden="true">
        <div
          key={toast.id}
          className="undo-toast-progress"
          style={{ animationDuration: `${duration}ms`, animationPlayState: paused ? 'paused' : 'running' }}
        />
      </div>
    </div>
  );
}
