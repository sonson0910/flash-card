import { Trans } from '@lingui/react';
import { useState } from 'react';
import {
  Brain,
  Check,
  ChevronDown,
  Eye,
  Headphones,
  PenLine,
  Puzzle,
  Shuffle,
  Sparkles,
  ArrowRight,
  Zap,
} from 'lucide-react';
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Lumi } from '../../components/lumi/Lumi';
import { useTheme } from '../theme/ThemeProvider';
import { readLumiEnabled } from '../settings/lumi-preference';
import './daily-learning-canvas.css';
import './today-caught-up.css';
import './today-sections.css';
import type { LessonMode, TodayScreenActions, TodayScreenModel } from './dailyLearningPresentation';
import { TodayReadyHero } from './TodayReadyHero';
import { StreakChip } from './StreakDialog';

export { sessionStageContent } from './TodayReadyHero';

interface TodayScreenProps {
  readonly model: TodayScreenModel;
  readonly actions: TodayScreenActions;
  readonly ownerId?: string | null;
  readonly targetLanguage?: string | null;
  readonly translationLanguage?: string | null;
}

const featuredLessonModes = [
  { id: 'recognition', label: msg({ id: 'today.mode.recognition.label', message: 'Recognition' }), description: msg({ id: 'today.mode.recognition.description', message: 'Choose the meaning you recognize.' }), tag: msg({ id: 'today.mode.recognition.tag', message: 'Quick recall' }), Icon: Eye, accentColor: 'from-[color-mix(in_srgb,var(--sf-brand)_20%,transparent)] to-[color-mix(in_srgb,var(--sf-brand)_8%,transparent)] text-[var(--sf-brand-text)] border-[color-mix(in_srgb,var(--sf-brand)_30%,transparent)]' },
  { id: 'active-recall', label: msg({ id: 'today.mode.active-recall.label', message: 'Active recall' }), description: msg({ id: 'today.mode.active-recall.description', message: 'Recall the answer without choices.' }), tag: msg({ id: 'today.mode.active-recall.tag', message: 'Deep memory' }), Icon: Brain, accentColor: 'from-[color-mix(in_srgb,var(--sf-second)_20%,transparent)] to-[color-mix(in_srgb,var(--sf-second)_8%,transparent)] text-[var(--sf-text)] border-[color-mix(in_srgb,var(--sf-second)_30%,transparent)]' },
  { id: 'listening', label: msg({ id: 'today.mode.listening.label', message: 'Listening' }), description: msg({ id: 'today.mode.listening.description', message: 'Listen, then identify the word.' }), tag: msg({ id: 'today.mode.listening.tag', message: 'Ear training' }), Icon: Headphones, accentColor: 'from-[color-mix(in_srgb,var(--sf-success)_20%,transparent)] to-[color-mix(in_srgb,var(--sf-success)_8%,transparent)] text-[var(--sf-success)] border-[color-mix(in_srgb,var(--sf-success)_30%,transparent)]' },
] as const;
const additionalLessonModes = [
  { id: 'spelling', label: msg({ id: 'today.mode.spelling.label', message: 'Spelling' }), description: msg({ id: 'today.mode.spelling.description', message: 'Type the word from its meaning.' }), Icon: PenLine },
  { id: 'cloze', label: msg({ id: 'today.mode.cloze.label', message: 'Cloze' }), description: msg({ id: 'today.mode.cloze.description', message: 'Complete a real example sentence.' }), Icon: Puzzle },
  { id: 'sentence-building', label: msg({ id: 'today.mode.sentence-building.label', message: 'Sentence building' }), description: msg({ id: 'today.mode.sentence-building.description', message: 'Put every word occurrence in order.' }), Icon: Shuffle },
] as const satisfies ReadonlyArray<{ id: LessonMode; label: ReturnType<typeof msg>; description: ReturnType<typeof msg>; Icon: React.ComponentType<{ size?: number; className?: string }> }>;

const primaryButton = 'brand-action shimmer-sweep min-h-11 rounded-full [html:not([data-theme-family=crystal])_&]:rounded-[var(--sf-button-radius,999px)] bg-[var(--sf-brand)] px-6 py-3 font-extrabold text-[var(--sf-on-brand)] shadow-[0_10px_24px_-14px_var(--sf-brand)] transition-[transform,filter] duration-300 hover:brightness-110 hover:scale-[1.03] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100';
const secondaryButton = 'min-h-11 rounded-full [html:not([data-theme-family=crystal])_&]:rounded-[var(--sf-button-radius,999px)] border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-5 py-2.5 font-bold text-[var(--sf-text)] transition-[transform,border-color,color] duration-200 hover:border-[var(--sf-brand)] hover:text-[var(--sf-brand-text)] hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none cursor-pointer';
const headingClass = 'text-balance text-3xl font-black tracking-tight focus-visible:outline-2 sm:text-4xl';

function PageHeading({ model }: Pick<TodayScreenProps, 'model'>) {
  const { _ } = useLingui();
  const assignHeading = (heading: HTMLHeadingElement | null) => {
    if (model.headingRef) model.headingRef.current = heading;
  };

  return <h1 id="daily-today-heading" ref={assignHeading} tabIndex={-1} className={headingClass}>{_(msg({ id: 'today.title', message: 'Today' }))}</h1>;
}

function RecommendedNext({ model, actions }: TodayScreenProps) {
  const { _ } = useLingui();
  const recommendation = model.recommendation;
  if (!recommendation) return null;
  const modeLabel = _([...featuredLessonModes, ...additionalLessonModes].find(mode => mode.id === recommendation.mode)!.label);

  // A compact row under the board's sections: the board has no slot for it, and it is Today's
  // only entry into the adaptive practice suggestion.
  return (
    <section data-recommended-next="true" aria-labelledby="recommended-next-heading" className="today-recommended crystal-chamfer-sm">
      <Sparkles size={16} className="today-recommended-icon" aria-hidden="true" />
      <div className="today-recommended-copy">
        <h2 id="recommended-next-heading" className="today-recommended-title"><Trans {...msg({ context: 'today-screen.recommended-next', message: 'Recommended next' })} /></h2>
        <p className="today-recommended-reason">{recommendation.reason} · {modeLabel}</p>
      </div>
      <button
        type="button"
        data-recommended-next-action="true"
        aria-label={i18n._(msg({ id: "today.recommended.aria", message: "Recommended next: start {mode}" }).id, { mode: modeLabel.toLowerCase() })}
        onClick={actions.startRecommended}
        className={`${secondaryButton} today-recommended-action text-sm`}
      ><Trans {...msg({ context: 'today-screen.start-recommended-lesson', message: 'Start recommended lesson' })} /><ArrowRight size={14} aria-hidden="true" /></button>
    </section>
  );
}

function CaughtUpPanel({ model, actions, showLumi }: TodayScreenProps & { readonly showLumi: boolean }) {
  const { _ } = useLingui();
  const { family, mode } = useTheme();
  const isCrystal = family === 'crystal';
  const summary = model.caughtUp ?? {};
  const nextReview = summary.nextReview
    && Number.isSafeInteger(summary.nextReview.cardCount)
    && summary.nextReview.cardCount > 0
    && summary.nextReview.label.trim().length > 0
    ? summary.nextReview
    : undefined;
  return (
    <article
      aria-labelledby="today-caught-up-title"
      className={`today-caught-up-panel${isCrystal ? ' today-caught-up-panel--crystal' : ''}`}
      data-today-caught-up="true"
    >
      <div className="today-caught-up-panel-inner">
        {isCrystal ? (
          <div className="today-caught-up-motif" aria-hidden="true">
            <span className="today-caught-up-star motion-reduce:animate-none">
              <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
                <polygon points="50.0,52.0 38.2,35.7 50.0,4.0" fill="#ff5470" />
                <polygon points="50.0,52.0 50.0,4.0 61.8,35.7" fill="#7a0820" />
                <polygon points="50.0,52.0 61.8,35.7 95.7,37.2" fill="#ff5470" />
                <polygon points="50.0,52.0 95.7,37.2 69.2,58.2" fill="#7a0820" />
                <polygon points="50.0,52.0 69.2,58.2 78.2,90.8" fill="#ff5470" />
                <polygon points="50.0,52.0 78.2,90.8 50.0,72.2" fill="#7a0820" />
                <polygon points="50.0,52.0 50.0,72.2 21.8,90.8" fill="#ff5470" />
                <polygon points="50.0,52.0 21.8,90.8 30.8,58.2" fill="#7a0820" />
                <polygon points="50.0,52.0 30.8,58.2 4.3,37.2" fill="#ff5470" />
                <polygon points="50.0,52.0 4.3,37.2 38.2,35.7" fill="#7a0820" />
              </svg>
            </span>
            {showLumi
              ? <Lumi pose="happy" size={108} eager className="today-caught-up-lumi crystal-ornament" />
              : <span className="today-caught-up-lumi" />}
          </div>
        ) : (
          <span className="today-caught-up-seal" aria-hidden="true">
            <Check size={28} strokeWidth={2.2} />
          </span>
        )}
        <h2 id="today-caught-up-title" className="today-caught-up-title">
          {_(msg({ id: 'today.caught-up.title', message: 'All caught' }))}{' '}
          <span className={isCrystal ? 'today-caught-up-gold' : mode === 'dark' ? 'today-caught-up-dark-accent' : 'today-caught-up-light-accent'}>
            {_(msg({ id: 'today.caught-up.title-emphasis', message: 'up.' }))}
          </span>
        </h2>
        <div className="today-caught-up-status" role="status" aria-live="polite">
          {nextReview && (
            <p>
              {_({ ...msg({ id: 'today.caught-up.next-review', message: 'Next review {when} · {count, plural, one {# card} other {# cards}}' }), values: { when: nextReview.label, count: nextReview.cardCount } })}
            </p>
          )}
          <p id="today-caught-up-learn-reason">
            {nextReview ? _(msg({ id: 'today.caught-up.no-new-cards', message: 'No new cards are available in this daily plan.' })) : model.message}
          </p>
        </div>
        <div className="today-caught-up-actions">
          <button
            type="button"
            onClick={actions.openVocabulary}
            aria-describedby="today-caught-up-learn-reason"
            className={`today-caught-up-button today-caught-up-primary${isCrystal ? '' : ` ${primaryButton}`}`}
          >
            {_(msg({ id: 'today.empty.add-vocabulary', message: 'Add vocabulary' }))}
          </button>
          <button
            type="button"
            onClick={actions.openPaths}
            className={`today-caught-up-button today-caught-up-secondary${isCrystal ? '' : ` ${secondaryButton}`}`}
          >
            {_(msg({ id: 'today.caught-up.browse-paths', message: 'Browse paths' }))}
          </button>
        </div>
      </div>
    </article>
  );
}

function PracticeModes({ model, actions }: Pick<TodayScreenProps, 'model' | 'actions'>) {
  const { _ } = useLingui();
  const [target, setTarget] = useState<5 | 10 | 15>(10);
  return (
    <section aria-labelledby="practice-mode-heading" className="rounded-[28px] [html:not([data-theme-family=crystal])_&]:rounded-[var(--sf-panel-radius,18px)] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-5 shadow-[0_18px_48px_-38px_var(--sf-shadow)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <Zap size={14} className="text-[var(--sf-brand-text)]" />
            <p className="premium-kicker uppercase tracking-[0.14em]">{_(msg({ id: 'today.practice.kicker', message: 'Extra practice' }))}</p>
          </div>
          <h2 id="practice-mode-heading" className="mt-1 text-xl font-black tracking-tight">{_(msg({ id: 'today.practice.title', message: 'Practice your way' }))}</h2>
          <p className="mt-1 text-sm text-[var(--sf-text-muted)]">{_(msg({ id: 'today.practice.description', message: 'Use another exercise when you want a different kind of recall.' }))}</p>
        </div>
        <button type="button" onClick={event => actions.openMorePractice(event.currentTarget)} className="liquid-control min-h-11 rounded-full [html:not([data-theme-family=crystal])_&]:rounded-[var(--sf-button-radius,999px)] px-4 py-2 text-sm font-bold text-[var(--sf-text)] transition-[transform,border-color] hover:border-[var(--sf-brand)] hover:scale-105 active:scale-95 cursor-pointer">{_(msg({ id: 'today.practice.more', message: 'More practice' }))}</button>
      </div>
      {model.plan && (
        <fieldset className="today-length">
          <legend>{_(msg({ id: 'today.plan.length', message: 'Practice length' }))}</legend>
          {([5, 10, 15] as const).map(size => <button key={size} type="button" aria-pressed={target === size} onClick={() => setTarget(size)} className={secondaryButton}>{size}</button>)}
          <button type="button" disabled={model.isOffline} onClick={() => actions.startDailyPlan(target)} className={secondaryButton}>{_(msg({ id: 'today.plan.sized-start', message: 'Start selected practice' }))}</button>
        </fieldset>
      )}
      <div className="mt-5 grid grid-cols-1 gap-3 border-t border-[var(--sf-border)] pt-5 sm:grid-cols-3">
          {featuredLessonModes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              data-practice-mode="true"
              disabled={model.isOffline}
              onClick={() => actions.startLesson(mode.id)}
              className="practice-bento-card min-h-24 rounded-xl [html:not([data-theme-family=crystal])_&]:rounded-[calc(var(--sf-panel-radius,18px)-4px)] group flex flex-col justify-between p-4 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--sf-brand)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <div className="flex items-start justify-between gap-2">
                <div className={`flex size-9 items-center justify-center rounded-xl [html:not([data-theme-family=crystal])_&]:rounded-[10px] border bg-gradient-to-br ${mode.accentColor} shadow-xs transition-transform duration-200 group-hover:scale-110`}>
                  <mode.Icon size={18} />
                </div>
                <span className="rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--sf-text-muted)]">
                  {_(mode.tag)}
                </span>
              </div>
              <div className="mt-3">
                <span className="block text-sm font-black text-[var(--sf-text)] group-hover:text-[var(--sf-brand)] transition-colors">{_(mode.label)}</span>
                <span className="mt-0.5 block text-xs leading-5 text-[var(--sf-text-muted)]">{_(mode.description)}</span>
              </div>
            </button>
          ))}
      </div>
      <details className="group mt-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-xl [html:not([data-theme-family=crystal])_&]:rounded-[12px] px-2 text-sm font-bold text-[var(--sf-brand-text)] hover:bg-[var(--sf-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
          <span>{_(msg({ id: 'today.practice.more-modes', message: 'More lesson modes' }))}</span>
          <ChevronDown size={16} className="transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
        </summary>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {additionalLessonModes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              data-practice-catalog-mode="true"
              disabled={model.isOffline}
              onClick={() => actions.startLesson(mode.id)}
              className="practice-bento-card min-h-20 rounded-xl [html:not([data-theme-family=crystal])_&]:rounded-[calc(var(--sf-panel-radius,18px)-4px)] p-4 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--sf-brand)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex items-center gap-2 font-black text-[var(--sf-text)]"><mode.Icon size={17} className="text-[var(--sf-brand-text)]" />{_(mode.label)}</span>
              <span className="mt-1 block text-xs leading-5 text-[var(--sf-text-muted)]">{_(mode.description)}</span>
            </button>
          ))}
        </div>
      </details>
    </section>
  );
}

const streakChipProps = (model: TodayScreenModel) => ({
  streak: model.streak, run: model.studyRun, week: model.studyWeek,
  ...(model.streakView ? { view: model.streakView, runStats: model.streakRunStats ?? null, now: model.streakNow } : {}),
});

const streakChipClass = 'liquid-control crystal-chamfer-sm inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-bold text-[var(--sf-text)] transition-transform hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transform-none motion-reduce:transition-none';

function LearningJourney({ model, actions }: TodayScreenProps) {
  const { plan } = model;
  const isEmpty = model.status === 'empty';
  const canImmerse = model.listenPilotAvailable ?? !isEmpty;
  if (!plan && !isEmpty) return null;

  const learnLabel = isEmpty ? i18n._(msg({ id: "today.journey.add-vocabulary", message: "Add vocabulary" })) : (plan?.due ?? 0) > 0 ? i18n._(msg({ id: "today.journey.review-due-words", message: "Review due words" })) : i18n._(msg({ id: "today.journey.start-recognition-lesson", message: "Start recognition lesson" }));
  const unavailableLabel = i18n._(msg({ id: "today.journey.available-after-your-first-plan", message: "Available after your first plan" }));

  return (
    <section data-learning-journey="true" aria-labelledby="learning-journey-heading" className="liquid-glass rounded-[28px] [html:not([data-theme-family=crystal])_&]:rounded-[var(--sf-panel-radius,18px)] border border-[var(--sf-border)] p-5 shadow-[0_28px_70px_-52px_var(--sf-shadow)] sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="premium-kicker uppercase tracking-[0.14em]"><Trans {...msg({ context: 'today-screen.one-learning-loop', message: 'One learning loop' })} /></p>
          <h2 id="learning-journey-heading" className="mt-1 text-2xl font-black tracking-tight sm:text-3xl"><Trans {...msg({ context: 'today-screen.learn-immerse-communicate', message: 'Learn → Immerse → Communicate' })} /></h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'today-screen.start-with-memory-meet-the-words-in-sound-then-use-them-in-a-real', message: 'Start with memory, meet the words in sound, then use them in a real context.' })} /></p>
        </div>
      </div>

      <ol aria-label={i18n._(msg({ id: "today-screen.learning-journey", message: "Learning journey" }))} className="mt-5 grid gap-3 lg:grid-cols-3">
        <li data-journey-stage="learn" className="flex min-w-0 flex-col rounded-2xl [html:not([data-theme-family=crystal])_&]:rounded-[calc(var(--sf-panel-radius,18px)-4px)] border border-[color-mix(in_srgb,var(--sf-brand)_25%,transparent)] bg-[color-mix(in_srgb,var(--sf-brand)_5%,transparent)] p-4">
          <span className="flex size-9 items-center justify-center rounded-xl [html:not([data-theme-family=crystal])_&]:rounded-[10px] border border-[color-mix(in_srgb,var(--sf-brand)_30%,transparent)] bg-[color-mix(in_srgb,var(--sf-brand)_10%,transparent)] text-[var(--sf-brand-text)]" aria-hidden="true"><Brain size={18} /></span>
          <h3 className="mt-4 text-lg font-black"><Trans {...msg({ context: 'today-screen.learn', message: 'Learn' })} /></h3>
          <p className="mt-1 flex-1 text-sm leading-6 text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'today-screen.build-recall-with-the-next-scheduled-words', message: 'Build recall with the next scheduled words.' })} /></p>
          <button
            type="button"
            data-journey-action="learn"
            aria-label={i18n._(msg({ id: "today.journey.learn.aria", message: "Learn: {action}" }).id, { action: learnLabel.toLowerCase() })}
            onClick={() => {
              if (isEmpty) actions.openVocabulary();
              else if ((plan?.due ?? 0) > 0) actions.continueReview();
              else actions.startLesson('recognition');
            }}
            className={`${primaryButton} mt-4 w-full text-sm`}
          >
            {learnLabel}
          </button>
        </li>

        <li data-journey-stage="immerse" className="flex min-w-0 flex-col rounded-2xl [html:not([data-theme-family=crystal])_&]:rounded-[calc(var(--sf-panel-radius,18px)-4px)] border border-[color-mix(in_srgb,var(--sf-success)_25%,transparent)] bg-[color-mix(in_srgb,var(--sf-success)_5%,transparent)] p-4">
          <span className="flex size-9 items-center justify-center rounded-xl [html:not([data-theme-family=crystal])_&]:rounded-[10px] border border-[color-mix(in_srgb,var(--sf-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--sf-success)_10%,transparent)] text-[var(--sf-success)]" aria-hidden="true"><Headphones size={18} /></span>
          <h3 className="mt-4 text-lg font-black"><Trans {...msg({ context: 'today-screen.immerse', message: 'Immerse' })} /></h3>
          <p className="mt-1 flex-1 text-sm leading-6 text-[var(--sf-text-muted)]">{canImmerse ? i18n._(msg({ id: "today.journey.train-your-ear-with-a-focused-listening-lesson", message: "Train your ear with a focused listening lesson." })) : isEmpty ? i18n._(msg({ id: "today.journey.build-a-plan-to-unlock-listening-practice", message: "Build a plan to unlock listening practice." })) : i18n._(msg({ id: "today.journey.a-listening-lesson-is-not-available-yet", message: "A listening lesson is not available yet." }))}</p>
          <button
            type="button"
            data-journey-action="immerse"
            aria-label={canImmerse ? i18n._(msg({ id: "today.journey.immerse-start-listening-practice", message: "Immerse: start listening practice" })) : i18n._(msg({ id: "today.journey.immerse.aria", message: "Immerse: {action}" }).id, { action: unavailableLabel.toLowerCase() })}
            disabled={!canImmerse}
            onClick={() => actions.startLesson('listening')}
            className={`${secondaryButton} mt-4 w-full text-sm`}
          >
            {canImmerse ? i18n._(msg({ id: "today.journey.start-listening-practice", message: "Start listening practice" })) : unavailableLabel}
          </button>
        </li>

        <li data-journey-stage="communicate" className="flex min-w-0 flex-col rounded-2xl [html:not([data-theme-family=crystal])_&]:rounded-[calc(var(--sf-panel-radius,18px)-4px)] border border-[color-mix(in_srgb,var(--sf-second)_25%,transparent)] bg-[color-mix(in_srgb,var(--sf-second)_5%,transparent)] p-4">
          <span className="flex size-9 items-center justify-center rounded-xl [html:not([data-theme-family=crystal])_&]:rounded-[10px] border border-[color-mix(in_srgb,var(--sf-second)_30%,transparent)] bg-[color-mix(in_srgb,var(--sf-second)_10%,transparent)] text-[var(--sf-text)]" aria-hidden="true"><Sparkles size={18} /></span>
          <h3 className="mt-4 text-lg font-black"><Trans {...msg({ context: 'today-screen.communicate', message: 'Communicate' })} /></h3>
          <p className="mt-1 flex-1 text-sm leading-6 text-[var(--sf-text-muted)]">{isEmpty ? i18n._(msg({ id: "today.journey.build-a-plan-to-unlock-story-shadowing-and-ai-dialogue", message: "Build a plan to unlock Story, Shadowing, and AI Dialogue." })) : i18n._(msg({ id: "today.journey.use-a-bounded-text-mission-story-or-shadowing-practice-with-your-", message: "Use a bounded text mission, story, or shadowing practice with your vocabulary." }))}</p>
          <button
            type="button"
            data-journey-action="communicate"
            aria-label={isEmpty ? i18n._(msg({ id: "today.journey.communicate.aria", message: "Communicate: {action}" }).id, { action: unavailableLabel.toLowerCase() }) : i18n._(msg({ id: "today.journey.communicate-open-text-story-or-shadowing-practice", message: "Communicate: open text, Story, or Shadowing practice" }))}
            disabled={isEmpty}
            onClick={event => actions.openMorePractice(event.currentTarget)}
            className={`${secondaryButton} mt-4 w-full text-sm`}
          >
            {isEmpty ? unavailableLabel : i18n._(msg({ id: "today.journey.open-communication-practice", message: "Open communication practice" }))}
          </button>
          <button
            type="button"
            data-journey-action="communicate-ai"
            aria-label={isEmpty ? i18n._(msg({ id: "today.journey.communicate.aria", message: "Communicate: {action}" }).id, { action: unavailableLabel.toLowerCase() }) : i18n._(msg({ id: "today.journey.communicate-go-to-vocabulary-tools-for-ai-dialogue", message: "Communicate: go to Vocabulary tools for AI Dialogue" }))}
            disabled={isEmpty}
            onClick={actions.openVocabulary}
            className="mt-2 min-h-11 rounded-xl [html:not([data-theme-family=crystal])_&]:rounded-[var(--sf-button-radius,999px)] px-3 py-2 text-xs font-bold text-[var(--sf-brand-text)] transition-colors hover:bg-[var(--sf-surface-raised)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:no-underline"
          >
            {isEmpty ? unavailableLabel : i18n._(msg({ id: "today.journey.go-to-vocabulary-tools-for-ai-dialogue", message: "Go to Vocabulary tools for AI Dialogue" }))}
          </button>
        </li>
      </ol>
    </section>
  );
}

export function TodayScreen({ model, actions, ownerId, targetLanguage, translationLanguage }: TodayScreenProps) {
  const { _ } = useLingui();
  const { family } = useTheme();
  const showLumi = family === 'crystal' && readLumiEnabled();
  if (model.status === 'loading') {
    return <section aria-labelledby="daily-today-heading" aria-busy="true" className="daily-canvas daily-canvas-today"><p className="premium-kicker uppercase tracking-[.16em]">{_(msg({ id: 'today.kicker', message: 'Daily learning' }))}</p><PageHeading model={model} /><div className="daily-facet-panel skeleton-sheen mt-6 min-h-52" role="status" aria-live="polite"><span className="sr-only">{model.message}</span></div></section>;
  }

  if (model.status === 'empty') {
    return (
      <section aria-labelledby="daily-today-heading" className="daily-canvas daily-canvas-today daily-zero">
        <div className="daily-zero-copy">
          <p className="premium-kicker uppercase tracking-[0.16em]">{_(msg({ id: 'today.kicker', message: 'Daily learning' }))}</p>
          <PageHeading model={model} />
          {model.isOffline && <p className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--sf-brand)_70%,transparent)] bg-[color-mix(in_srgb,var(--sf-brand)_10%,transparent)] p-3 font-semibold" role="status" aria-live="polite">{_(msg({ id: 'today.offline', message: "You're offline. Reconnect to start today's session." }))}</p>}
          <p className="daily-zero-lede" role="status" aria-live="polite">{model.message} {_(msg({ id: 'today.empty.description', message: 'Add a word you care about, or begin with a reviewed learning path.' }))}</p>
        </div>
        <div className="daily-facet-panel daily-zero-panel">
          <div className="daily-zero-lumi">{showLumi && <Lumi pose="sleepy" size={150} className="crystal-ornament" />}</div>
          <div className="daily-zero-panel-copy">
            <span className="daily-eyebrow"><Sparkles size={14} aria-hidden="true" />{_(msg({ id: 'today.empty.kicker', message: 'Start here' }))}</span>
            <h2>{_(msg({ id: 'today.empty.title', message: 'Build your first learning plan' }))}</h2>
            <p>{_(msg({ id: 'today.adult-statement', message: 'SonFlash is for learners aged 18 and over.' }))} <a href="/privacy.html">{_(msg({ id: 'today.privacy', message: 'Privacy' }))}</a> · <a href="/terms.html">{_(msg({ id: 'today.terms', message: 'Terms' }))}</a></p>
            <div className="daily-zero-actions">
              <button type="button" onClick={actions.openVocabulary} className={`${primaryButton} daily-facet-action`}>{_(msg({ id: 'today.empty.add-vocabulary', message: 'Add vocabulary' }))}</button>
              <button type="button" onClick={actions.openPaths} className={`${secondaryButton} daily-ghost-action`}>{_(msg({ id: 'today.empty.open-paths', message: 'Explore learning paths' }))}</button>
            </div>
          </div>
        </div>
        <LearningJourney model={model} actions={actions} />
      </section>
    );
  }

  if (model.status === 'caught-up') {
    return (
      <section aria-labelledby="daily-today-heading" className="daily-canvas mx-auto max-w-6xl">
        <header>
          <p className="premium-kicker uppercase tracking-[0.16em]">{_(msg({ id: 'today.kicker', message: 'Daily learning' }))}</p>
          <PageHeading model={model} />
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-[var(--sf-brand-text)]">{model.courseLabel ?? _(msg({ id: 'today.course.fallback', message: 'Your current course' }))}</p>
            <StreakChip {...streakChipProps(model)} className={streakChipClass} />
          </div>
        </header>
        {model.isOffline && <p className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--sf-brand)_70%,transparent)] bg-[color-mix(in_srgb,var(--sf-brand)_10%,transparent)] p-3 font-semibold" role="status" aria-live="polite">{_(msg({ id: 'today.offline', message: "You're offline. Reconnect to start today's session." }))}</p>}
        <div className="mt-8 flex justify-center">
          <CaughtUpPanel model={model} actions={actions} showLumi={showLumi} />
        </div>
      </section>
    );
  }

  if (model.status === 'error') {
    return (
      <section aria-labelledby="daily-today-heading" className="daily-canvas daily-canvas-today">
        <PageHeading model={model} />
        <div data-today-error="true" className="mt-6 max-w-3xl rounded-[28px] [html:not([data-theme-family=crystal])_&]:rounded-[var(--sf-panel-radius,18px)] border border-[color-mix(in_srgb,var(--sf-danger)_70%,transparent)] bg-[var(--sf-surface)] p-6 sm:p-8" role="alert" aria-live="assertive">
          <p className="premium-kicker uppercase tracking-[0.16em]">{_(msg({ id: 'today.error.kicker', message: 'Plan unavailable' }))}</p>
          <h2 className="mt-3 text-2xl font-black tracking-tight">{_(msg({ id: 'today.error.title', message: 'Today needs attention' }))}</h2>
          <p className="mt-2 max-w-xl text-[var(--sf-text-muted)]">{model.message}</p>
          <button type="button" onClick={actions.retry} className={`${primaryButton} mt-5`}>{_(msg({ id: 'today.error.retry', message: 'Try again' }))}</button>
        </div>
      </section>
    );
  }

  return (
    <div className="today-ready-page">
      {model.isOffline && <p className="today-offline-note" role="status" aria-live="polite">{_(msg({ id: 'today.offline', message: "You're offline. Reconnect to start today's session." }))}</p>}
      <TodayReadyHero
        model={model}
        actions={actions}
        ownerId={ownerId}
        targetLanguage={targetLanguage}
        translationLanguage={translationLanguage}
        isCrystal={family === 'crystal'}
        showLumi={showLumi}
        streakChip={<StreakChip {...streakChipProps(model)} className="today-chip today-chip--button" onStartSession={actions.startSession} />}
      />
      <div className="daily-canvas daily-canvas-today today-below mx-auto max-w-6xl space-y-5 sm:space-y-6">
      <LearningJourney model={model} actions={actions} />
      {/* On the Crystal board the side column exists only for the placement invite; without it the practice panel takes the full row. */}
      <div className={`grid gap-5${model.placementAvailable || family !== 'crystal' ? ' lg:grid-cols-[minmax(0,1fr)_minmax(17rem,0.38fr)]' : ''}`}>
        <PracticeModes model={model} actions={actions} />
        {model.placementAvailable && (
          <aside aria-labelledby="placement-invite-heading" className="liquid-glass rounded-[28px] [html:not([data-theme-family=crystal])_&]:rounded-[var(--sf-panel-radius,18px)] border border-[var(--sf-border)] p-5 sm:p-6">
            <p className="premium-kicker uppercase tracking-[0.14em]">{_(msg({ id: 'today.placement.kicker', message: 'Optional' }))}</p>
            <h2 id="placement-invite-heading" className="mt-2 text-xl font-black tracking-tight">{_(msg({ id: 'today.placement.title', message: 'Not sure where to begin?' }))}</h2>
            <p className="mt-2 text-pretty text-sm leading-6 text-[var(--sf-text-muted)]">{_(msg({ id: 'today.placement.description', message: 'Take a diagnostic check. It will not change your review history or unlock content.' }))}</p>
            <button type="button" onClick={actions.startPlacement} className={`${secondaryButton} mt-5 w-full`}>{_(msg({ id: 'today.placement.action', message: 'Take placement check' }))}</button>
          </aside>
        )}
      </div>
      <RecommendedNext model={model} actions={actions} />
      </div>
    </div>
  );
}
