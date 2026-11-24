import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react';
import type { LandingSignInState } from './landingSignInState';

// Crystal's raised surface is a 6% white tint, so the floating notice takes the opaque surface there to stay
// readable over whatever section scrolls under it, and the chamfer instead of the rounded corners.
const noticeClass = 'fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-4 py-3 text-sm font-semibold shadow-[var(--sf-panel-shadow)] [html[data-theme-family=crystal]_&]:bg-[var(--sf-surface)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm';

/** Feedback for a sign-in started from the landing page, where the app runtime is not visible. */
export function LandingSignInNotice({ busy, error }: LandingSignInState) {
  if (error) return <p role="alert" className={`${noticeClass} text-[var(--sf-danger)]`}>{error}</p>;
  if (busy) return <p role="status" className={`${noticeClass} text-[var(--sf-text)]`}><Trans {...msg({ id: 'landing.sign-in.busy', message: 'Signing in…' })} /></p>;
  return null;
}
