import { Check, CloudOff, Loader2, RotateCcw, TriangleAlert } from 'lucide-react';
import { getSyncHealth, type SyncHealthInput } from './syncHealthModel';

interface SyncHealthProps extends SyncHealthInput {
  onRetry?: () => void;
  className?: string;
}

const toneClasses = {
  saved: 'border-emerald-200/80 bg-emerald-50/90 text-emerald-900 dark:border-emerald-900/70 dark:bg-emerald-950/35 dark:text-emerald-100',
  'saving-offline': 'border-amber-200/80 bg-amber-50/90 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/35 dark:text-amber-100',
  syncing: 'border-cyan-200/80 bg-cyan-50/90 text-cyan-950 dark:border-cyan-900/70 dark:bg-cyan-950/35 dark:text-cyan-100',
  'needs-attention': 'border-rose-200/80 bg-rose-50/90 text-rose-950 dark:border-rose-900/70 dark:bg-rose-950/35 dark:text-rose-100',
} as const;

function StatusIcon({ kind }: { kind: ReturnType<typeof getSyncHealth>['kind'] }) {
  if (kind === 'saving-offline') return <CloudOff size={16} aria-hidden="true" />;
  if (kind === 'syncing') return <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />;
  if (kind === 'needs-attention') return <TriangleAlert size={16} aria-hidden="true" />;
  return <Check size={16} aria-hidden="true" />;
}

export function SyncHealth({
  isOnline,
  isSyncing,
  pendingCount,
  error,
  onRetry,
  className = '',
}: SyncHealthProps) {
  const state = getSyncHealth({ isOnline, isSyncing, pendingCount, error });

  return (
    <section
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy={state.busy}
      className={`flex min-w-0 items-center gap-3 rounded-2xl border px-3 py-2.5 shadow-sm ${toneClasses[state.kind]} ${className}`}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-white/55 dark:bg-black/15">
        <StatusIcon kind={state.kind} />
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block text-xs font-black tracking-wide">{state.label}</strong>
        <span className="block text-xs leading-relaxed opacity-80">{state.message}</span>
      </span>
      {state.canRetry && onRetry ? (
        <button
          type="button"
          aria-label="Retry syncing your library"
          onClick={onRetry}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-current/20 bg-white/55 px-3 text-xs font-black transition-transform hover:-translate-y-px active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current dark:bg-black/15"
        >
          <RotateCcw size={14} aria-hidden="true" />
          Retry
        </button>
      ) : null}
    </section>
  );
}
