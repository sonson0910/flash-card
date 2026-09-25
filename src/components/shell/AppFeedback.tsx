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
import { useEffect, useState, type ReactNode } from 'react';
import { useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { getShellSyncStatus, type ShellSyncStatusInput } from './shellSyncStatus';
import { localizeShellSyncStatus } from './localized-sync-status';
import '../feedback-toast.css';

export interface AppFeedbackProps {
  children?: ReactNode;
  authError?: string | null;
  error?: string | null;
  notice?: string | null;
  syncStatus?: ShellSyncStatusInput;
  onDismissAuthError?: () => void;
  onDismissError?: () => void;
  onDismissNotice?: () => void;
  onRetrySync?: () => void | Promise<void>;
  sessionLost?: boolean;
  onRetryAuth?: () => void | Promise<void>;
  isRetryingAuth?: boolean;
}

type NotificationTone = 'danger' | 'warning' | 'success' | 'sync';

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
  actionBusyLabel,
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
  actionBusyLabel?: string;
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
      className="notification-toast pointer-events-auto relative"
    >
      <div className="notification-toast-layout">
        <span className="notification-toast-icon" aria-hidden="true">
          {busy ? <span className="notification-toast-spinner animate-spin motion-reduce:animate-none" /> : <Icon size={16} />}
        </span>
        <span className="notification-toast-copy">
          <strong className="notification-toast-title">{title}</strong>
          <span className="notification-toast-message">{message}</span>
          {onAction && actionLabel ? (
            <div className="notification-toast-actions">
              <button
                type="button"
                onClick={() => { void onAction(); }}
                disabled={busy}
                aria-label={busy && actionBusyLabel ? actionBusyLabel : actionAriaLabel}
                className="notification-toast-action"
              >
                <span className="notification-toast-action-label">
                  {busy ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <RotateCcw size={14} aria-hidden="true" />}
                  {busy && actionBusyLabel ? actionBusyLabel : actionLabel}
                </span>
              </button>
            </div>
          ) : null}
        </span>
        {onDismiss && dismissLabel ? (
          <button
            type="button"
            onClick={onDismiss}
            className="notification-toast-dismiss"
            aria-label={dismissLabel}
          >
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function AppFeedback({
  children,
  authError,
  error,
  notice,
  syncStatus,
  onDismissAuthError,
  onDismissError,
  onDismissNotice,
  onRetrySync,
  sessionLost = false,
  onRetryAuth,
  isRetryingAuth = false,
}: AppFeedbackProps) {
  const { _ } = useLingui();
  const rawSync = syncStatus ? getShellSyncStatus(syncStatus) : null;
  const sync = rawSync && syncStatus ? localizeShellSyncStatus(rawSync, syncStatus, _) : null;
  const syncSignature = rawSync && !rawSync.healthy && rawSync.kind !== 'checking'
    ? `${rawSync.kind}\u0000${rawSync.headerLabel}\u0000${rawSync.detail}`
    : null;
  const [dismissedSyncSignature, setDismissedSyncSignature] = useState<string | null>(null);

  useEffect(() => {
    if (!syncSignature) setDismissedSyncSignature(null);
  }, [syncSignature]);

  const showSync = Boolean(syncSignature && dismissedSyncSignature !== syncSignature);
  if (!sessionLost && !authError && !error && !notice && !showSync && !children) return null;

  const SyncIcon = sync?.busy ? Loader2 : sync?.kind === 'offline' ? WifiOff : CloudOff;
  const syncTone: NotificationTone = sync?.kind === 'needs-attention'
    ? 'danger'
    : sync?.busy
      ? 'sync'
      : 'warning';

  return (
    <aside
      data-notification-viewport="true"
      aria-label={_(msg({ id: 'shell.feedback.notifications', message: 'Notifications' }))}
      className="app-feedback-stack pointer-events-none fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 top-[5.25rem] z-[70] flex w-[min(25rem,calc(100vw-2rem))] flex-col justify-end overflow-y-auto sm:right-6 lg:bottom-4"
    >
      {sessionLost ? (
        <NotificationToast
          role="alert"
          tone="danger"
          title={_(msg({ id: 'shell.feedback.session-ended', message: 'Session ended' }))}
          message={authError || _(msg({ id: 'shell.feedback.session-ended-detail', message: 'Sign in again to restore cloud sync.' }))}
          Icon={AlertCircle}
          busy={isRetryingAuth}
          actionLabel={_(msg({ id: 'shell.feedback.sign-in-again', message: 'Sign in again' }))}
          actionBusyLabel={_(msg({ id: 'shell.feedback.connecting', message: 'Connecting…' }))}
          actionAriaLabel={_(msg({ id: 'shell.feedback.sign-in-again', message: 'Sign in again' }))}
          onAction={onRetryAuth}
        />
      ) : authError ? (
        <NotificationToast
          role="alert"
          tone="danger"
          title={_(msg({ id: 'shell.feedback.account', message: 'Account' }))}
          message={authError}
          Icon={AlertCircle}
          busy={isRetryingAuth}
          dismissLabel={_(msg({ id: 'shell.feedback.dismiss-sign-in', message: 'Dismiss sign-in message' }))}
          onDismiss={onDismissAuthError}
          actionLabel={onRetryAuth ? _(msg({ id: 'shell.feedback.try-sign-in-again', message: 'Try again' })) : undefined}
          actionBusyLabel={_(msg({ id: 'shell.feedback.connecting', message: 'Connecting…' }))}
          actionAriaLabel={_(msg({ id: 'shell.feedback.try-sign-in-again', message: 'Try again' }))}
          onAction={onRetryAuth}
        />
      ) : null}
      {error ? (
        <NotificationToast
          role="alert"
          tone="warning"
          title={_(msg({ id: 'shell.feedback.needs-attention', message: 'Needs attention' }))}
          message={error}
          Icon={AlertCircle}
          dismissLabel={_(msg({ id: 'shell.feedback.dismiss-system', message: 'Dismiss system message' }))}
          onDismiss={onDismissError}
        />
      ) : null}
      {notice ? (
        <NotificationToast
          role="status"
          tone="success"
          title={_(msg({ id: 'shell.feedback.done', message: 'Done' }))}
          message={notice}
          Icon={CheckCircle2}
          dismissLabel={_(msg({ id: 'shell.feedback.dismiss-success', message: 'Dismiss success message' }))}
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
          dismissLabel={_(msg({ id: 'shell.feedback.dismiss-sync', message: 'Dismiss sync status' }))}
          onDismiss={() => setDismissedSyncSignature(syncSignature)}
          actionLabel={sync.canRetry && onRetrySync ? _(msg({ id: 'shell.feedback.retry', message: 'Retry' })) : undefined}
          actionAriaLabel={_(msg({ id: 'shell.feedback.retry-sync', message: 'Retry syncing your library' }))}
          onAction={sync.canRetry ? onRetrySync : undefined}
        />
      ) : null}
      {children}
    </aside>
  );
}
