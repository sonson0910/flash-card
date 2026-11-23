import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react';

const noticeClass = 'fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-4 py-3 text-sm font-semibold shadow-[var(--sf-panel-shadow)]';

/** Feedback for a sign-in started from the landing page, where the app runtime is not visible. */
export function LandingSignInNotice({ busy, error }: { readonly busy: boolean; readonly error: string | null }) {
  if (error) return <p role="alert" className={`${noticeClass} text-[var(--sf-danger)]`}>{error}</p>;
  if (busy) return <p role="status" className={`${noticeClass} text-[var(--sf-text)]`}><Trans {...msg({ id: 'landing.sign-in.busy', message: 'Signing in…' })} /></p>;
  return null;
}
