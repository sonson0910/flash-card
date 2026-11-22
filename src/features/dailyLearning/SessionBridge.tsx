import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { ArrowRight, Moon, SkipForward, Sparkles, Sun, Vibrate, VibrateOff, Volume2, VolumeX, X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { GsapEntrance } from '../../components/motion/GsapEntrance';
import { Lumi } from '../../components/lumi/Lumi';
import { useHapticsSettings } from '../../lib/haptics';
import { useSoundSettings } from '../../lib/interactionSounds';
import { useTheme } from '../theme/ThemeProvider';
import { readLumiEnabled } from '../settings/lumi-preference';
import { useFocusModePreference } from '../settings/focus-mode-preference';
import type { SessionBridgeActions, SessionBridgeModel, SessionBridgePreviewCard } from './dailyLearningPresentation';
import './session-bridge.css';

interface SessionBridgeProps {
  readonly model: SessionBridgeModel;
  readonly actions: SessionBridgeActions;
}

/** Crystal names a run of remembered cards after its length, as the AnimeBridge board does. */
const comboTiers = [
  msg({ id: 'session.bridge.combo-tier.sweet', message: 'Sweet' }),
  msg({ id: 'session.bridge.combo-tier.lovely', message: 'Lovely' }),
  msg({ id: 'session.bridge.combo-tier.sparkly', message: 'Sparkly' }),
  msg({ id: 'session.bridge.combo-tier.dreamy', message: 'Dreamy' }),
  msg({ id: 'session.bridge.combo-tier.dreamy-plus', message: 'Dreamy+' }),
] as const;

/** The tier for a run of at least two; runs past five keep the top tier with a plus. */
function crystalComboTier(count: number) {
  return comboTiers[Math.min(Math.max(count, 2), 6) - 2];
}

const tierNames = {
  new: msg({ id: 'session.bridge.card.tier.new', message: 'Bud' }),
  learning: msg({ id: 'session.bridge.card.tier.learning', message: 'Bloom' }),
  mastered: msg({ id: 'session.bridge.card.tier.mastered', message: 'Star' }),
} as const;
const tierStatuses = {
  new: msg({ id: 'session.bridge.card.tier-status.new', message: 'New' }),
  learning: msg({ id: 'session.bridge.card.tier-status.learning', message: 'Learning' }),
  mastered: msg({ id: 'session.bridge.card.tier-status.mastered', message: 'Mastered' }),
} as const;

/** The example with the previewed word picked out, as the AnimeBridge card quotes it. */
function ExampleQuote({ sentence, word, language }: { readonly sentence: string; readonly word: string; readonly language: string }) {
  const found = word.trim() ? new RegExp(word.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu').exec(sentence) : null;
  return (
    <span className="session-bridge-card-quote" lang={language}>
      {found ? <>{sentence.slice(0, found.index)}<b>{found[0]}</b>{sentence.slice(found.index + found[0].length)}</> : sentence}
    </span>
  );
}

/** The board sets the first word of the stage name in the accent ink and breaks the rest onto a second line. */
function StageTitle({ label }: { readonly label: string }) {
  const space = label.indexOf(' ');
  if (space < 0) return <em>{label}</em>;
  return <><em>{label.slice(0, space)}</em><br /><span>{label.slice(space + 1)}</span></>;
}

function PreviewCard({ card, flipped, crystal }: { readonly card: SessionBridgePreviewCard; readonly flipped: boolean; readonly crystal: boolean }) {
  const { _ } = useLingui();
  const meta = [card.phonetic, card.partOfSpeech].filter(Boolean).join(' · ');
  return (
    <span className="session-bridge-card-rotor" data-flipped={flipped || undefined}>
      <span className="session-bridge-card-face session-bridge-card-front" aria-hidden={flipped || undefined}>
        <span className="session-bridge-card-chips">
          {crystal && card.tier && (
            <span className="session-bridge-card-tier" data-tier={card.tier}>
              <b>{_(tierNames[card.tier])}</b><span>{_(tierStatuses[card.tier])}</span>
            </span>
          )}
          {card.sourceSite
            ? <span className="session-bridge-card-category"><span className="session-bridge-card-site" aria-hidden="true">{card.sourceSite.charAt(0).toUpperCase()}</span><Trans {...msg({ id: 'session.bridge.card.source', message: 'From {site}' })} values={{ site: card.sourceSite }} /></span>
            : card.category ? <span className="session-bridge-card-category">{card.category}</span> : null}
        </span>
        {card.partOfSpeech && <span className="session-bridge-card-kind">{card.partOfSpeech}{card.category ? <span> // {card.category}</span> : null}</span>}
        <span className="session-bridge-card-word" lang={card.language}>{card.word}</span>
        {meta && <span className="session-bridge-card-phonetic">{meta}</span>}
        {crystal && card.exampleSentence && <ExampleQuote sentence={card.exampleSentence} word={card.word} language={card.language} />}
        <span className="session-bridge-card-hint"><Trans {...msg({ id: 'session.bridge.card.flip', message: 'Tap or press <0>Space</0> to flip' })} components={{ 0: <kbd /> }} /></span>
      </span>
      <span className="session-bridge-card-face session-bridge-card-back" aria-hidden={flipped ? undefined : true}>
        <span className="session-bridge-card-kind"><Trans {...msg({ id: 'session.bridge.card.meaning', message: 'Meaning' })} /></span>
        <span className="session-bridge-card-translation" lang={card.translationLanguage}>{card.translation}</span>
        {card.exampleSentence && <span className="session-bridge-card-example" lang={card.language}>{card.exampleSentence}</span>}
      </span>
    </span>
  );
}

/** A full-screen pause between committed stages, using only the current session's data. */
export function SessionBridge({ model, actions }: SessionBridgeProps) {
  const { _ } = useLingui();
  const { family, mode, setMode } = useTheme();
  const { focusModeEnabled } = useFocusModePreference();
  const { isSoundEnabled } = useSoundSettings();
  const { isHapticsEnabled } = useHapticsSettings();
  const [flipped, setFlipped] = useState(false);
  const crystal = family === 'crystal';
  const showLumi = crystal && readLumiEnabled();
  const showCombo = !focusModeEnabled && model.comboCount >= 2;
  const showXp = !focusModeEnabled && model.xpEarned > 0;
  const card = model.previewCard;
  const feedbackLabel = isSoundEnabled
    ? (isHapticsEnabled ? _(msg({ id: 'session.bridge.feedback.both', message: 'Sound and haptics on' })) : _(msg({ id: 'session.bridge.feedback.sound', message: 'Sound on, haptics off' })))
    : (isHapticsEnabled ? _(msg({ id: 'session.bridge.feedback.haptics', message: 'Sound off, haptics on' })) : _(msg({ id: 'session.bridge.feedback.none', message: 'Sound and haptics off' })));

  const flipFromKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (!card || event.key !== ' ' || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    setFlipped(value => !value);
  };

  return (
    <section aria-labelledby="session-bridge-heading" className="session-bridge" data-family={family} data-session-shell="bridge" onKeyDown={flipFromKeyboard}>
      {crystal && <>
        <span className="session-bridge-wing session-bridge-wing--start crystal-wing-art" aria-hidden="true" />
        <span className="session-bridge-wing session-bridge-wing--end crystal-wing-art" aria-hidden="true" />
      </>}
      <header className="session-bridge-header">
        <button type="button" onClick={actions.exit} className="session-bridge-exit" aria-label={_(msg({ id: 'session.bridge.exit', message: 'Exit session' }))}>
          <X size={16} aria-hidden="true" />
        </button>
        <ol className="session-bridge-rail" aria-label={_(msg({ id: 'session.bridge.progress', message: 'Session progress' }))}>
          {model.stages.map((stage, index) => (
            <li key={stage.id} aria-current={stage.current ? 'step' : undefined} data-completed={stage.completed || undefined}>
              <span className="session-bridge-rail-track" aria-hidden="true"><span /></span>
              <span className="session-bridge-rail-row">
                <span className="session-bridge-rail-label"><span className="session-bridge-rail-number" aria-hidden="true">{String(index + 1).padStart(2, '0')} </span>{stage.label}</span>
                {stage.meta && <span className="session-bridge-rail-meta">{stage.meta}</span>}
              </span>
            </li>
          ))}
        </ol>
        <span className="session-bridge-feedback" role="img" aria-label={feedbackLabel} title={feedbackLabel}>
          {isSoundEnabled ? <Volume2 size={15} aria-hidden="true" /> : <VolumeX size={15} aria-hidden="true" />}
          {isSoundEnabled && <span className="session-bridge-wave" aria-hidden="true"><span /><span /><span /></span>}
          {isHapticsEnabled ? <Vibrate size={15} aria-hidden="true" /> : <VibrateOff size={15} aria-hidden="true" />}
        </span>
        {crystal && (
          <button type="button" className="session-bridge-theme" onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')} aria-pressed={mode === 'dark'} aria-label={_(msg({ id: 'shell.theme.quick-toggle', message: 'Switch light and dark mode' }))}>
            {mode === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
          </button>
        )}
      </header>

      <GsapEntrance variant="view" className="session-bridge-main">
        <div className="session-bridge-result">
          <p className="session-bridge-eyebrow">{model.completedLabel}</p>
          {showCombo ? (
            <div className="session-bridge-combo" data-session-combo={model.comboCount}>
              <span className="session-bridge-combo-banner" aria-hidden="true" />
              {crystal && <span className="session-bridge-combo-star crystal-star-art" aria-hidden="true" />}
              <strong>×{model.comboCount}</strong>
              <span className="session-bridge-combo-text">
                {crystal && <span className="session-bridge-combo-tier" aria-hidden="true">{_(crystalComboTier(model.comboCount))}</span>}
                <span className="session-bridge-combo-label">{crystal
                  ? <Trans {...msg({ context: 'session.bridge.combo-crystal', message: 'correct in a row' })} />
                  : <Trans {...msg({ context: 'session.bridge.combo', message: 'correct answers in a row' })} />}</span>
              </span>
            </div>
          ) : model.stats.map(stat => (
            <div key={stat.label} className="session-bridge-stat">
              <strong>{stat.value}</strong>
              <span>{stat.label}</span>
            </div>
          ))}
          {showCombo && model.recentAnswers.length > 0 && (
            <ol className="session-bridge-ticks" aria-label={_(msg({ id: 'session.bridge.recent-answers', message: 'Latest answers' }))}>
              {model.recentAnswers.map((correct, index) => (
                <li key={index} data-correct={correct || undefined}>
                  <span className="sr-only">{correct ? _(msg({ id: 'session.bridge.answer.correct', message: 'Remembered' })) : _(msg({ id: 'session.bridge.answer.missed', message: 'Missed' }))}</span>
                </li>
              ))}
            </ol>
          )}
          {showXp && <p className="session-bridge-xp"><Trans {...msg({ id: 'session.bridge.xp', message: '+{xp} XP this session' })} values={{ xp: model.xpEarned }} /></p>}
          {showLumi && (
            <div className="session-bridge-companion">
              <Lumi pose="happy" className="session-bridge-lumi" />
              <div className="session-bridge-speech">
                <span className="session-bridge-speech-name"><Trans {...msg({ id: 'session.bridge.lumi.name', message: 'Lumi' })} /></span>
                <strong><Trans {...msg({ id: 'session.bridge.lumi.title', message: 'Nice rhythm!' })} /></strong>
                <span><Trans {...msg({ id: 'session.bridge.lumi.body', message: 'Your answers so far are saved.' })} /></span>
              </div>
            </div>
          )}
        </div>

        <div className="session-bridge-preview" role="group" aria-label={_(msg({ id: 'session.bridge.preview', message: 'Next stage preview' }))}>
          <span className="session-bridge-aura" aria-hidden="true" />
          {card ? (
            <>
              <span className="session-bridge-ghosts" aria-hidden="true"><span /><span /><span /></span>
              <span className="session-bridge-trails" aria-hidden="true"><span /><span /></span>
              <button type="button" className="session-bridge-card" aria-pressed={flipped} onClick={() => setFlipped(value => !value)}>
                <PreviewCard card={card} flipped={flipped} crystal={crystal} />
              </button>
            </>
          ) : <Sparkles className="session-bridge-finale" size={92} aria-hidden="true" />}
        </div>

        <div className="session-bridge-next">
          <p className="session-bridge-step">{model.stepLabel}</p>
          <h1 id="session-bridge-heading" ref={model.headingRef} tabIndex={-1} aria-label={model.nextLabel}><StageTitle label={model.nextLabel} /></h1>
          {model.nextSummary && <p className="session-bridge-summary">{model.nextSummary}</p>}
          <p className="session-bridge-description">{model.nextDescription}</p>
          <p className="session-bridge-live" role="status" aria-live="polite">{model.liveMessage}</p>
          {model.skipReason && <p className="session-bridge-skip-reason" role="note">{model.skipReason}</p>}
          <div className="session-bridge-actions">
            <button type="button" onClick={actions.continue} className="session-bridge-primary">
              <Trans {...msg({ context: 'session.bridge.continue', message: 'Continue' })} /> <ArrowRight size={18} aria-hidden="true" />
            </button>
            {model.canSkipNextStage && (
              <button type="button" onClick={actions.skip} className="session-bridge-secondary">
                <SkipForward size={17} aria-hidden="true" /> <Trans {...msg({ context: 'session.bridge.skip', message: 'Skip' })} />
              </button>
            )}
          </div>
        </div>
      </GsapEntrance>
    </section>
  );
}
