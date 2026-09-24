import { lazy, Suspense } from 'react';
import { Trans } from '@lingui/react';

const Lumi = lazy(() => import('../components/lumi/Lumi').then(module => ({ default: module.Lumi })));

export default function AppRuntimeError({ onRetry }: { onRetry: () => void }) {
  return (
    <aside className="crystal-chamfer crystal-starfield fixed inset-x-4 bottom-6 z-50 mx-auto flex max-w-lg items-center justify-between gap-4 border border-[var(--sf-danger)] bg-[var(--sf-surface)] p-4 text-sm text-[var(--sf-text)] shadow-2xl" role="alert">
      {globalThis.document?.documentElement.dataset.themeFamily === 'crystal'
        ? <Suspense fallback={null}><Lumi pose="sleepy" size={44} className="crystal-ornament shrink-0" /></Suspense>
        : null}
      <p><Trans id="shell.runtime-error.message" message="Workspace could not load." /></p>
      <button
        type="button"
        className="min-h-11 shrink-0 rounded-xl bg-[var(--sf-brand)] px-4 py-2 font-bold text-[var(--sf-on-brand)] transition hover:bg-[var(--sf-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--sf-brand)]"
        onClick={onRetry}
      >
        <Trans id="shell.runtime-error.retry" message="Retry workspace" />
      </button>
    </aside>
  );
}
