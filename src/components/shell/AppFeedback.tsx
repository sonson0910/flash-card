import {
  AlertCircle,
  CheckCircle2,
  CloudOff,
  Loader2,
  RotateCcw,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { getShellSyncStatus, type ShellSyncStatusInput } from './shellSyncStatus';

export interface AppFeedbackProps {
  authError?: string | null;
  error?: string | null;
  notice?: string | null;
  syncStatus?: ShellSyncStatusInput;
  onDismissAuthError?: () => void;
  onDismissError?: () => void;
  onDismissNotice?: () => void;
  onRetrySync?: () => void | Promise<void>;
}

type NotificationTone = 'danger' | 'warning' | 'success' | 'sync';

const toneClasses: Record<NotificationTone, string> = {
  danger: 'border-rose-300/70 bg-rose-50/95 text-rose-950 dark:border-rose-800/70 dark:bg-rose-950/90 dark:text-rose-100',
  warning: 'border-amber-300/70 bg-amber-50/95 text-amber-950 dark:border-amber-800/70 dark:bg-amber-950/90 dark:text-amber-100',
  success: 'border-emerald-300/70 bg-emerald-50/95 text-emerald-950 dark:border-emerald-800/70 dark:bg-emerald-950/90 dark:text-emerald-100',
  sync: 'border-cyan-300/70 bg-cyan-50/95 text-cyan-950 dark:border-cyan-800/70 dark:bg-cyan-950/90 dark:text-cyan-100',
};

const iconClasses: Record<NotificationTone, string> = {
  danger: 'bg-rose-600 text-white',
  warning: 'bg-amber-500 text-slate-950',
  success: 'bg-emerald-600 text-white',
  sync: 'bg-cyan-600 text-white',
};

function NotificationToast({
  role,
  tone,
  title,
  message,
  Icon,
  busy = false,
  dismissLabel,
  onDismiss,
  actionLabel,
  actionAriaLabel,
  onAction,
}: {
  role: 'alert' | 'status';
  tone: NotificationTone;
  title: string;
  message: string;
  Icon: LucideIcon;
  busy?: boolean;
  dismissLabel?: string;
  onDismiss?: () => void;
  actionLabel?: string;
  actionAriaLabel?: string;
  onAction?: () => void | Promise<void>;
}) {
  return (
    <section
      data-notification-toast="true"
      data-tone={tone}
      role={role}
      aria-live={role === 'alert' ? 'assertive' : 'polite'}
      aria-atomic="true"
      aria-busy={busy}
      className={`notification-toast pointer-events-auto relative overflow-hidden rounded-2xl border p-3 backdrop-blur-xl ${toneClasses[tone]}`}
    >
      <div className="relative z-10 flex items-start gap-3">
        <span className={`notification-toast-icon mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl shadow-sm ${iconClasses[tone]}`}>
          <Icon size={16} className={busy ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block text-xs font-black uppercase tracking-[0.08em]">{title}</strong>
          <span className="mt-0.5 block text-xs leading-5 opacity-85">{message}</span>
        </span>
        {onDismiss && dismissLabel ? (
          <button
            type="button"
            onClick={onDismiss}
            className="-mr-1 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-xl opacity-70 transition-colors hover:bg-black/5 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-1 dark:hover:bg-white/10"
            aria-label={dismissLabel}
          >
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {onAction && actionLabel ? (
        <div className="relative z-10 mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => { void onAction(); }}
            aria-label={actionAriaLabel}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-current/20 bg-white/55 px-3 text-xs font-black transition-colors hover:bg-white/85 focus-visible:outline-2 focus-visible:outline-offset-1 dark:bg-black/15 dark:hover:bg-black/25"
          >
            <RotateCcw size={14} aria-hidden="true" />
            {actionLabel}
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function AppFeedback({
  authError,
  error,
  notice,
  syncStatus,
  onDismissAuthError,
  onDismissError,
  onDismissNotice,
  onRetrySync,
}: AppFeedbackProps) {
  const sync = syncStatus ? getShellSyncStatus(syncStatus) : null;
  const syncSignature = sync && !sync.healthy && sync.kind !== 'checking'
    ? `${sync.kind}\u0000${sync.headerLabel}\u0000${sync.detail}`
    : null;
  const [dismissedSyncSignature, setDismissedSyncSignature] = useState<string | null>(null);

  useEffect(() => {
    if (!syncSignature) setDismissedSyncSignature(null);
  }, [syncSignature]);

  const showSync = Boolean(syncSignature && dismissedSyncSignature !== syncSignature);
  if (!authError && !error && !notice && !showSync) return null;

  const SyncIcon = sync?.busy ? Loader2 : sync?.kind === 'offline' ? WifiOff : CloudOff;
  const syncTone: NotificationTone = sync?.kind === 'needs-attention'
    ? 'danger'
    : sync?.busy
      ? 'sync'
      : 'warning';

  return (
    <aside
      data-notification-viewport="true"
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 top-[5.25rem] z-[70] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 overflow-y-auto sm:right-6 lg:bottom-4"
    >
      {authError ? (
        <NotificationToast
          role="alert"
          tone="danger"
          title="Account"
          message={authError}
          Icon={AlertCircle}
          dismissLabel="Dismiss sign-in message"
          onDismiss={onDismissAuthError}
        />
      ) : null}
      {error ? (
        <NotificationToast
          role="alert"
          tone="warning"
          title="Needs attention"
          message={error}
          Icon={AlertCircle}
          dismissLabel="Dismiss system message"
          onDismiss={onDismissError}
        />
      ) : null}
      {notice ? (
        <NotificationToast
          role="status"
          tone="success"
          title="Done"
          message={notice}
          Icon={CheckCircle2}
          dismissLabel="Dismiss success message"
          onDismiss={onDismissNotice}
        />
      ) : null}
      {showSync && sync && SyncIcon ? (
        <NotificationToast
          role={sync.kind === 'needs-attention' ? 'alert' : 'status'}
          tone={syncTone}
          title={sync.headerLabel}
          message={sync.detail}
          Icon={SyncIcon}
          busy={sync.busy}
          dismissLabel="Dismiss sync status"
          onDismiss={() => setDismissedSyncSignature(syncSignature)}
          actionLabel={sync.canRetry && onRetrySync ? 'Retry' : undefined}
          actionAriaLabel="Retry syncing your library"
          onAction={sync.canRetry ? onRetrySync : undefined}
        />
      ) : null}
    </aside>
  );
}
