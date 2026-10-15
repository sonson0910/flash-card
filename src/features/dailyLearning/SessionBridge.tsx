import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { ArrowRight, SkipForward, Sparkles, X } from 'lucide-react';
import { GsapEntrance } from '../../components/motion/GsapEntrance';
import { Lumi } from '../../components/lumi/Lumi';
import { useTheme } from '../theme/ThemeProvider';
import { readLumiEnabled } from '../settings/lumi-preference';
import { useFocusModePreference } from '../settings/focus-mode-preference';
import type { SessionBridgeActions, SessionBridgeModel } from './dailyLearningPresentation';

interface SessionBridgeProps {
  readonly model: SessionBridgeModel;
  readonly actions: SessionBridgeActions;
}

/** A full-screen pause between committed stages, using only the current session's data. */
export function SessionBridge({ model, actions }: SessionBridgeProps) {
  const { _ } = useLingui();
  const { family } = useTheme();
  const { focusModeEnabled } = useFocusModePreference();
  const showLumi = family === 'crystal' && readLumiEnabled();

  return (
    <section aria-labelledby="session-bridge-heading" className="session-bridge" data-session-shell="bridge">
      <header className="session-bridge-header">
        <button type="button" onClick={actions.exit} className="session-bridge-exit" aria-label={_(msg({ id: 'session.bridge.exit', message: 'Exit session' }))}>
          <X size={19} aria-hidden="true" />
        </button>
        <ol className="session-bridge-rail" aria-label={_(msg({ id: 'session.bridge.progress', message: 'Session progress' }))}>
          {model.stages.map(stage => (
            <li key={stage.id} aria-current={stage.current ? 'step' : undefined} data-completed={stage.completed || undefined}>
              <span className="session-bridge-rail-track" aria-hidden="true"><span /></span>
              <span className="session-bridge-rail-label">{stage.label}</span>
            </li>
          ))}
        </ol>
      </header>

      <GsapEntrance variant="view" className="session-bridge-main">
        <div className="session-bridge-result">
          <p className="session-bridge-eyebrow">{model.completedLabel}</p>
          {model.stats.map(stat => (
            <div key={stat.label} className="session-bridge-stat">
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
          ))}
          {!focusModeEnabled && model.comboCount >= 2 && (
            <div className="session-bridge-stat" data-session-combo={model.comboCount}>
              <strong>×{model.comboCount}</strong>
              <span><Trans id="session.bridge.combo" message="Combo" /></span>
            </div>
          )}
          {showLumi && <Lumi pose="happy" size={110} className="session-bridge-lumi" />}
        </div>

        <div className="session-bridge-preview" role="group" aria-label={_(msg({ id: 'session.bridge.preview', message: 'Next stage preview' }))}>
          {model.previewCard ? (
            <div className="session-bridge-card">
              <span className="session-bridge-card-category">{model.previewCard.category}</span>
              <div className="session-bridge-card-word" lang={model.previewCard.language}>{model.previewCard.word}</div>
              {model.previewCard.phonetic && <span className="session-bridge-card-phonetic">{model.previewCard.phonetic}</span>}
              <span className="session-bridge-card-translation">{model.previewCard.translation}</span>
            </div>
          ) : <Sparkles className="session-bridge-finale" size={92} aria-hidden="true" />}
        </div>

        <div className="session-bridge-next">
          <p className="session-bridge-eyebrow"><Trans id="session.bridge.up-next" message="Up next" /></p>
          <h1 id="session-bridge-heading" ref={model.headingRef} tabIndex={-1}>{model.nextLabel}</h1>
          <p className="session-bridge-live" role="status" aria-live="polite">{model.liveMessage}</p>
          <p className="session-bridge-description">{model.nextDescription}</p>
          {model.skipReason && <p className="session-bridge-skip-reason" role="note">{model.skipReason}</p>}
          <div className="session-bridge-actions">
            <button type="button" onClick={actions.continue} className="session-bridge-primary">
              <Trans id="session.bridge.continue" message="Continue" /> <ArrowRight size={18} aria-hidden="true" />
            </button>
            {model.canSkipNextStage && (
              <button type="button" onClick={actions.skip} className="session-bridge-secondary">
                <SkipForward size={17} aria-hidden="true" /> <Trans id="session.bridge.skip" message="Skip" />
              </button>
            )}
          </div>
        </div>
      </GsapEntrance>
    </section>
  );
}
