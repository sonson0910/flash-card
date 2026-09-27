import { ArrowRight, SkipForward, X } from 'lucide-react';
import { Trans } from '@lingui/react';
import { GsapEntrance } from '../../components/motion/GsapEntrance';
import { useTheme } from '../theme/ThemeProvider';
import { readLumiEnabled } from '../settings/lumi-preference';
import { Lumi } from '../../components/lumi/Lumi';
import type { SessionBridgeActions, SessionBridgeModel } from './dailyLearningPresentation';

interface SessionBridgeProps {
  readonly model: SessionBridgeModel;
  readonly actions: SessionBridgeActions;
}

const actionClass = 'crystal-chamfer-sm min-h-11 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-5 py-2.5 font-bold text-[var(--sf-text)] shadow-[var(--sf-panel-shadow)] transition duration-200 hover:border-[var(--sf-brand)] hover:bg-[var(--sf-surface-raised)] active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none';
const primaryClass = 'brand-action crystal-chamfer min-h-11 rounded-2xl bg-[var(--sf-brand)] px-6 py-3 font-extrabold text-[var(--sf-on-brand)] shadow-[var(--sf-panel-shadow)] transition duration-200 hover:bg-[var(--sf-brand-hover)] active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none';

/**
 * The interstitial between two parts of the sequenced daily session (Canvas SessionBridge
 * board): confirms what was just finished, previews what comes next, and explains a skip
 * out loud instead of jumping the learner into an empty stage without a reason.
 */
export function SessionBridge({ model, actions }: SessionBridgeProps) {
  const { family } = useTheme();
  const showLumi = family === 'crystal' && readLumiEnabled();

  return (
    <section aria-labelledby="session-bridge-heading" className="mx-auto max-w-3xl py-8 sm:py-14" data-session-shell="bridge">
      <GsapEntrance variant="view" className="crystal-chamfer relative overflow-hidden rounded-[32px] border border-[var(--sf-border)] bg-[var(--sf-surface-glass)] p-7 text-center shadow-[var(--sf-panel-shadow)] sm:p-10">
        {showLumi && <Lumi pose="happy" size={88} className="crystal-ornament mx-auto mb-2" />}
        <p className="premium-kicker uppercase tracking-[.16em]">{model.completedLabel}</p>
        <h1 id="session-bridge-heading" ref={model.headingRef} tabIndex={-1} className="mt-3 text-balance text-3xl font-black tracking-tight focus-visible:outline-2 sm:text-4xl">
          {model.nextLabel}
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-pretty text-[var(--sf-text-muted)]" role="status" aria-live="polite">{model.liveMessage}</p>
        {model.stats.length > 0 && (
          <dl className="mx-auto mt-6 grid max-w-md grid-cols-2 gap-3 sm:grid-cols-3">
            {model.stats.map(stat => (
              <div key={stat.label} className="crystal-chamfer-sm rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-3">
                <dt className="text-[11px] font-black uppercase tracking-wider text-[var(--sf-text-muted)]">{stat.label}</dt>
                <dd className="mt-1 font-display text-xl font-black tabular-nums text-[var(--sf-text)]">{stat.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {model.skipReason && (
          <p className="mx-auto mt-5 max-w-xl rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-muted)] p-3 text-sm text-[var(--sf-text-muted)]" role="note">
            {model.skipReason}
          </p>
        )}
        <p className="mt-4 max-w-xl text-pretty text-sm leading-6 text-[var(--sf-text-muted)]">{model.nextDescription}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button type="button" onClick={actions.continue} className={`${primaryClass}`}>
            <Trans id="session.bridge.continue" message="Continue" /> <ArrowRight size={17} aria-hidden="true" className="ml-1 inline" />
          </button>
          {model.canSkipNextStage && (
            <button type="button" onClick={actions.skip} className={actionClass}>
              <SkipForward size={16} aria-hidden="true" className="mr-1 inline" /> <Trans id="session.bridge.skip" message="Skip" />
            </button>
          )}
          <button type="button" onClick={actions.exit} className={actionClass}>
            <X size={16} aria-hidden="true" className="mr-1 inline" /> <Trans id="session.bridge.exit" message="Exit session" />
          </button>
        </div>
      </GsapEntrance>
    </section>
  );
}
