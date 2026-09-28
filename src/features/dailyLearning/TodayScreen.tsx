import { Suspense, lazy } from 'react';
import {
  Brain,
  Check,
  ChevronDown,
  Eye,
  Flame,
  Headphones,
  PenLine,
  Puzzle,
  Shuffle,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react';
import { Lumi } from '../../components/lumi/Lumi';
import { useTheme } from '../theme/ThemeProvider';
import { readLumiEnabled } from '../settings/lumi-preference';
import './daily-learning-canvas.css';
import './today-caught-up.css';
import type { LessonMode, TodayScreenActions, TodayScreenModel } from './dailyLearningPresentation';

const WebWordsTodayStrip = lazy(() =>
  import('../webWords/WebWordsTodayStrip').then(module => ({ default: module.WebWordsTodayStrip })),
);

interface TodayScreenProps {
  readonly model: TodayScreenModel;
  readonly actions: TodayScreenActions;
  readonly ownerId?: string | null;
  readonly targetLanguage?: string | null;
}

const lessonModes: ReadonlyArray<{
  id: LessonMode;
  label: ReturnType<typeof msg>;
  description: ReturnType<typeof msg>;
  tag: ReturnType<typeof msg>;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  accentColor: string;
}> = [
  { id: 'recognition', label: msg({ id: 'today.mode.recognition.label', message: 'Recognition' }), description: msg({ id: 'today.mode.recognition.description', message: 'Choose the meaning you recognize.' }), tag: msg({ id: 'today.mode.recognition.tag', message: 'Quick recall' }), Icon: Eye, accentColor: 'from-cyan-500/20 to-sky-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30' },
  { id: 'active-recall', label: msg({ id: 'today.mode.active-recall.label', message: 'Active recall' }), description: msg({ id: 'today.mode.active-recall.description', message: 'Recall the answer without choices.' }), tag: msg({ id: 'today.mode.active-recall.tag', message: 'Deep memory' }), Icon: Brain, accentColor: 'from-indigo-500/20 to-purple-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30' },
  { id: 'listening', label: msg({ id: 'today.mode.listening.label', message: 'Listening' }), description: msg({ id: 'today.mode.listening.description', message: 'Listen, then identify the word.' }), tag: msg({ id: 'today.mode.listening.tag', message: 'Ear training' }), Icon: Headphones, accentColor: 'from-sky-500/20 to-blue-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30' },
  { id: 'spelling', label: msg({ id: 'today.mode.spelling.label', message: 'Spelling' }), description: msg({ id: 'today.mode.spelling.description', message: 'Type the word from its meaning.' }), tag: msg({ id: 'today.mode.spelling.tag', message: 'Precision' }), Icon: PenLine, accentColor: 'from-amber-500/20 to-orange-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30' },
  { id: 'cloze', label: msg({ id: 'today.mode.cloze.label', message: 'Cloze' }), description: msg({ id: 'today.mode.cloze.description', message: 'Complete a real example sentence.' }), tag: msg({ id: 'today.mode.cloze.tag', message: 'Context' }), Icon: Puzzle, accentColor: 'from-emerald-500/20 to-teal-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' },
  { id: 'sentence-building', label: msg({ id: 'today.mode.sentence-building.label', message: 'Sentence building' }), description: msg({ id: 'today.mode.sentence-building.description', message: 'Put every word occurrence in order.' }), tag: msg({ id: 'today.mode.sentence-building.tag', message: 'Structure' }), Icon: Shuffle, accentColor: 'from-violet-500/20 to-fuchsia-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30' },
];

const featuredLessonModes = lessonModes.slice(0, 3);
const additionalLessonModes = lessonModes.slice(3);

const primaryButton = 'brand-action shimmer-sweep min-h-11 rounded-full bg-[var(--sf-brand)] px-6 py-3 font-extrabold text-[var(--sf-on-brand)] shadow-md shadow-sky-600/20 transition-all duration-300 hover:brightness-110 hover:scale-[1.03] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100';
const secondaryButton = 'min-h-11 rounded-full border border-slate-200 bg-slate-100/90 dark:border-white/15 dark:bg-white/5 px-5 py-2.5 font-bold text-slate-800 dark:text-white/90 transition-all duration-200 hover:border-cyan-400/50 hover:bg-slate-200 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none cursor-pointer';
const headingClass = 'text-balance text-3xl font-black tracking-tight focus-visible:outline-2 sm:text-4xl';

const planStages = [
  { key: 'due', label: msg({ id: 'today.stage.due.title', message: 'Review due' }), count: msg({ id: 'today.stage.due.count', message: '{count, plural, one {# due} other {# due}}' }), description: msg({ id: 'today.stage.due.description', message: 'Bring scheduled words back first.' }) },
  { key: 'weak', label: msg({ id: 'today.stage.weak.title', message: 'Strengthen' }), count: msg({ id: 'today.stage.weak.count', message: '{count, plural, one {# weak} other {# weak}}' }), description: msg({ id: 'today.stage.weak.description', message: 'Practice words that need another pass.' }) },
  { key: 'fresh', label: msg({ id: 'today.stage.fresh.title', message: 'First look' }), count: msg({ id: 'today.stage.fresh.count', message: '{count, plural, one {# new} other {# new}}' }), description: msg({ id: 'today.stage.fresh.description', message: 'Meet new vocabulary after review.' }) },
] as const;

function PageHeading({ model }: Pick<TodayScreenProps, 'model'>) {
  const assignHeading = (heading: HTMLHeadingElement | null) => {
    if (model.headingRef) model.headingRef.current = heading;
  };

  return <h1 id="daily-today-heading" ref={assignHeading} tabIndex={-1} className={headingClass}><Trans id="today.title" message="Today" /></h1>;
}

function PlanSummary({ model, actions }: TodayScreenProps) {
  const isCrystal = useTheme().family === 'crystal';
  const { plan } = model;
  if (!plan) return null;

  return (
    <section aria-labelledby="daily-plan-heading" className="liquid-glass crystal-chamfer relative overflow-hidden rounded-[28px] border border-[var(--sf-border)] p-6 shadow-[0_28px_70px_-52px_var(--sf-shadow)] sm:p-7">
      {isCrystal && <span aria-hidden="true" className="crystal-starfield pointer-events-none absolute inset-0 opacity-70 motion-reduce:animate-none" />}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.52fr)] lg:items-end">
        <div className="relative min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-cyan-800 dark:text-cyan-300">
              <Sparkles size={13} className="shrink-0 text-cyan-600 dark:text-cyan-400" />
              <Trans id="today.plan.kicker" message="Daily focus" />
            </span>
            {plan.isShort && <span className="rounded-full border border-amber-500/60 bg-amber-400/10 px-3 py-1 text-xs font-bold text-[var(--sf-text)]"><Trans id="today.plan.short-chip" message="Short plan" /></span>}
          </div>
          <h2 id="daily-plan-heading" className="mt-3 text-balance text-2xl font-black tracking-tight sm:text-3xl"><Trans id="today.plan.title" message="Your daily plan" /></h2>
          <p className="mt-2 max-w-2xl text-pretty font-semibold"><Trans id="today.plan.subtitle" message="Build memory in the right order." /></p>
          <p className="mt-1 max-w-2xl text-pretty text-sm leading-6 text-[var(--sf-text-muted)]"><Trans id="today.plan.sequence" message="{count, plural, one {# item is} other {# items are}} sequenced from scheduled review to first look." values={{ count: plan.total }} /></p>
          {plan.isShort && <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--sf-text-muted)]"><Trans id="today.plan.short-description" message="There are fewer than 10 eligible cards today. You can still complete this shorter plan." /></p>}
        </div>
        <button
          type="button"
          data-primary-learning-action="true"
          disabled={model.isOffline}
          onClick={actions.startSession}
          className={`${primaryButton} w-full justify-self-stretch text-center sm:w-auto lg:w-full`}
        >
          <Trans id="today.plan.start-session" message="Start today's session" />
        </button>
      </div>

      <ol className="relative mt-6 grid overflow-hidden rounded-[22px] border border-[var(--sf-border)] bg-[var(--sf-surface)] sm:grid-cols-3" aria-label={i18n._(msg({ id: 'today.plan.order', message: 'Daily plan order' }).id)}>
        {planStages.map((stage, index) => (
          <li key={stage.key} className="flex min-w-0 gap-3.5 border-b border-[var(--sf-border)] p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:p-5 sm:last:border-r-0">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-cyan-500/25 bg-cyan-500/10 text-xs font-black tabular-nums text-[var(--sf-brand-text)]" aria-hidden="true">
              0{index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-extrabold text-[var(--sf-text)]"><Trans id={stage.label.id} message={stage.label.message} /></p>
              <p className="mt-0.5 text-sm font-semibold text-[var(--sf-brand-text)]"><Trans id={stage.count.id} message={stage.count.message} values={{ count: plan[stage.key] }} /></p>
              <p className="mt-1.5 text-pretty text-xs leading-5 text-[var(--sf-text-muted)]"><Trans id={stage.description.id} message={stage.description.message} /></p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function CaughtUpPanel({ model, actions, showLumi }: TodayScreenProps & { readonly showLumi: boolean }) {
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
          <Trans id="today.caught-up.title" message="All caught" />{' '}
          <span className={isCrystal ? 'today-caught-up-gold' : mode === 'dark' ? 'today-caught-up-dark-accent' : 'today-caught-up-light-accent'}>
            <Trans id="today.caught-up.title-emphasis" message="up." />
          </span>
        </h2>
        <div className="today-caught-up-status" role="status" aria-live="polite">
          {nextReview && (
            <p>
              <Trans
                id="today.caught-up.next-review"
                message="Next review {when} · {count, plural, one {# card} other {# cards}}"
                values={{ when: nextReview.label, count: nextReview.cardCount }}
              />
            </p>
          )}
          <p id="today-caught-up-learn-reason">
            {nextReview ? <Trans id="today.caught-up.no-new-cards" message="No new cards are available in this daily plan." /> : model.message}
          </p>
        </div>
        <div className="today-caught-up-actions">
          <button
            type="button"
            onClick={actions.openVocabulary}
            aria-describedby="today-caught-up-learn-reason"
            className={`today-caught-up-button today-caught-up-primary${isCrystal ? '' : ` ${primaryButton}`}`}
          >
            <Trans id="today.empty.add-vocabulary" message="Add vocabulary" />
          </button>
          <button
            type="button"
            onClick={actions.openPaths}
            className={`today-caught-up-button today-caught-up-secondary${isCrystal ? '' : ` ${secondaryButton}`}`}
          >
            <Trans id="today.caught-up.browse-paths" message="Browse paths" />
          </button>
        </div>
      </div>
    </article>
  );
}

function PracticeModes({ model, actions }: Pick<TodayScreenProps, 'model' | 'actions'>) {
  return (
    <section aria-labelledby="practice-mode-heading" className="rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-5 shadow-[0_18px_48px_-38px_var(--sf-shadow)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <Zap size={14} className="text-cyan-700 dark:text-cyan-400" />
            <p className="premium-kicker uppercase tracking-[0.14em]"><Trans id="today.practice.kicker" message="Extra practice" /></p>
          </div>
          <h2 id="practice-mode-heading" className="mt-1 text-xl font-black tracking-tight"><Trans id="today.practice.title" message="Practice your way" /></h2>
          <p className="mt-1 text-sm text-[var(--sf-text-muted)]"><Trans id="today.practice.description" message="Use another exercise when you want a different kind of recall." /></p>
        </div>
        <button type="button" onClick={event => actions.openMorePractice(event.currentTarget)} className="liquid-control min-h-11 rounded-full px-4 py-2 text-sm font-bold text-[var(--sf-text)] transition-all hover:border-[var(--sf-brand)] hover:scale-105 active:scale-95 cursor-pointer"><Trans id="today.practice.more" message="More practice" /></button>
      </div>
      <div className="mt-5 grid grid-cols-1 gap-3 border-t border-[var(--sf-border)] pt-5 sm:grid-cols-3">
          {featuredLessonModes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              data-practice-mode="true"
              disabled={model.isOffline}
              onClick={() => actions.startLesson(mode.id)}
              className="practice-bento-card min-h-24 rounded-xl group flex flex-col justify-between p-4 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--sf-brand)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <div className="flex items-start justify-between gap-2">
                <div className={`flex size-9 items-center justify-center rounded-xl border bg-gradient-to-br ${mode.accentColor} shadow-xs transition-transform duration-200 group-hover:scale-110`}>
                  <mode.Icon size={18} />
                </div>
                <span className="rounded-full border border-slate-200/90 bg-slate-100/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                  <Trans id={mode.tag.id} message={mode.tag.message} />
                </span>
              </div>
              <div className="mt-3">
                <span className="block text-sm font-black text-[var(--sf-text)] group-hover:text-[var(--sf-brand)] transition-colors"><Trans id={mode.label.id} message={mode.label.message} /></span>
                <span className="mt-0.5 block text-xs leading-5 text-[var(--sf-text-muted)]"><Trans id={mode.description.id} message={mode.description.message} /></span>
              </div>
            </button>
          ))}
      </div>
      <details className="group mt-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-xl px-2 text-sm font-bold text-[var(--sf-brand-text)] hover:bg-[var(--sf-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
          <span><Trans id="today.practice.more-modes" message="More lesson modes" /></span>
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
              className="practice-bento-card min-h-20 rounded-xl p-4 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--sf-brand)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex items-center gap-2 font-black text-[var(--sf-text)]"><mode.Icon size={17} className="text-[var(--sf-brand-text)]" /><Trans id={mode.label.id} message={mode.label.message} /></span>
              <span className="mt-1 block text-xs leading-5 text-[var(--sf-text-muted)]"><Trans id={mode.description.id} message={mode.description.message} /></span>
            </button>
          ))}
        </div>
      </details>
    </section>
  );
}

function StreakChip({ streak }: Pick<TodayScreenProps['model'], 'streak'>) {
  if (streak === undefined || streak < 1) return null;

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button type="button" className="liquid-control crystal-chamfer-sm inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-bold text-[var(--sf-text)] transition-transform hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transform-none motion-reduce:transition-none">
          <Flame size={16} className="text-orange-500" aria-hidden="true" />
          <Trans id="today.streak.chip" message="{count, plural, one {# study day} other {# study days}}" values={{ count: streak }} />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/72 backdrop-blur-sm motion-reduce:backdrop-blur-none" />
        <Dialog.Content className="liquid-glass crystal-chamfer fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[28px] border border-[var(--sf-border)] p-6 text-[var(--sf-text)] shadow-2xl focus-visible:outline-2 focus-visible:outline-offset-2">
          <div className="flex items-start gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-orange-500/12 text-orange-500"><Flame size={22} aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-balance text-xl font-black"><Trans id="today.streak.title" message="Your study rhythm" /></Dialog.Title>
              <Dialog.Description className="mt-2 text-pretty text-sm leading-6 text-[var(--sf-text-muted)]"><Trans id="today.streak.description" message="You have studied for {count, plural, one {# day in a row} other {# days in a row}}. Keep choosing the next helpful study step." values={{ count: streak }} /></Dialog.Description>
            </div>
            <Dialog.Close className="flex size-11 shrink-0 items-center justify-center rounded-xl text-[var(--sf-text-muted)] transition-colors hover:bg-[var(--sf-surface-raised)] hover:text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2" aria-label={i18n._(msg({ id: 'today.streak.close', message: 'Close streak details' }).id)}><X size={18} aria-hidden="true" /></Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function TodayScreen({ model, actions, ownerId, targetLanguage }: TodayScreenProps) {
  const { family } = useTheme();
  const showLumi = family === 'crystal' && readLumiEnabled();
  if (model.status === 'loading') {
    return <section aria-labelledby="daily-today-heading" aria-busy="true" className="daily-canvas daily-canvas-today"><p className="premium-kicker uppercase tracking-[.16em]"><Trans id="today.kicker" message="Daily learning" /></p><PageHeading model={model} /><div className="daily-facet-panel skeleton-sheen mt-6 min-h-52" role="status" aria-live="polite"><span className="sr-only">{model.message}</span></div></section>;
  }

  if (model.status === 'empty') {
    return (
      <section aria-labelledby="daily-today-heading" className="daily-canvas daily-canvas-today daily-zero">
        <div className="daily-zero-copy">
          <p className="premium-kicker uppercase tracking-[0.16em]"><Trans id="today.kicker" message="Daily learning" /></p>
          <PageHeading model={model} />
          <p className="daily-zero-lede" role="status" aria-live="polite">{model.message} <Trans id="today.empty.description" message="Add a word you care about, or begin with a reviewed learning path." /></p>
        </div>
        <div className="daily-facet-panel daily-zero-panel">
          <div className="daily-zero-lumi">{showLumi && <Lumi pose="sleepy" size={150} className="crystal-ornament" />}</div>
          <div className="daily-zero-panel-copy">
            <span className="daily-eyebrow"><Sparkles size={14} aria-hidden="true" /><Trans id="today.empty.kicker" message="Start here" /></span>
            <h2><Trans id="today.empty.title" message="Build your first learning plan" /></h2>
            <p><Trans id="today.adult-statement" message="SonFlash is for learners aged 18 and over." /> <a href="/privacy.html"><Trans id="today.privacy" message="Privacy" /></a> · <a href="/terms.html"><Trans id="today.terms" message="Terms" /></a></p>
            <div className="daily-zero-actions">
              <button type="button" onClick={actions.openVocabulary} className={`${primaryButton} daily-facet-action`}><Trans id="today.empty.add-vocabulary" message="Add vocabulary" /></button>
              <button type="button" onClick={actions.openPaths} className={`${secondaryButton} daily-ghost-action`}><Trans id="today.empty.open-paths" message="Explore learning paths" /></button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (model.status === 'caught-up') {
    return (
      <section aria-labelledby="daily-today-heading" className="daily-canvas mx-auto max-w-6xl">
        <header>
          <p className="premium-kicker uppercase tracking-[0.16em]"><Trans id="today.kicker" message="Daily learning" /></p>
          <PageHeading model={model} />
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-[var(--sf-brand-text)]">{model.courseLabel ?? <Trans id="today.course.fallback" message="Your current course" />}</p>
            <StreakChip streak={model.streak} />
          </div>
        </header>
        {model.isOffline && <p className="mt-4 rounded-xl border border-sky-500/70 bg-sky-500/10 p-3 font-semibold" role="status" aria-live="polite"><Trans id="today.offline" message="You're offline. Reconnect to start today's session." /></p>}
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
        <div className="mt-6 max-w-3xl rounded-[28px] border border-rose-500/70 bg-[var(--sf-surface)] p-6 sm:p-8" role="alert" aria-live="assertive">
          <p className="premium-kicker uppercase tracking-[0.16em]"><Trans id="today.error.kicker" message="Plan unavailable" /></p>
          <h2 className="mt-3 text-2xl font-black tracking-tight"><Trans id="today.error.title" message="Today needs attention" /></h2>
          <p className="mt-2 max-w-xl text-[var(--sf-text-muted)]">{model.message}</p>
          <button type="button" onClick={actions.retry} className={`${primaryButton} mt-5`}><Trans id="today.error.retry" message="Try again" /></button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="daily-today-heading" className="daily-canvas daily-canvas-today mx-auto max-w-6xl space-y-5 sm:space-y-6">
      <header>
        <p className="premium-kicker uppercase tracking-[0.16em]"><Trans id="today.kicker" message="Daily learning" /></p>
        <PageHeading model={model} />
        <div className="mt-1 flex flex-wrap items-center gap-2"><p className="text-sm font-bold text-[var(--sf-brand-text)]">{model.courseLabel ?? <Trans id="today.course.fallback" message="Your current course" />}</p><StreakChip streak={model.streak} /></div>
        <p className="mt-2 max-w-2xl text-pretty text-[var(--sf-text-muted)]" role="status" aria-live="polite">{model.message}</p>
      </header>
      {model.isOffline && <p className="rounded-xl border border-sky-500/70 bg-sky-500/10 p-3 font-semibold" role="status" aria-live="polite"><Trans id="today.offline" message="You're offline. Reconnect to start today's session." /></p>}
      <PlanSummary model={model} actions={actions} />
      <Suspense fallback={null}><WebWordsTodayStrip ownerId={ownerId ?? null} targetLanguage={targetLanguage ?? null} /></Suspense>
      {showLumi && <aside className="crystal-chamfer flex min-h-24 items-center gap-4 border border-[var(--sf-border)] bg-[var(--sf-surface-glass)] p-4 shadow-[var(--sf-panel-shadow)]"><Lumi pose="hero" size={76} eager className="crystal-ornament shrink-0" /><p className="text-sm font-bold leading-6 text-[var(--sf-text)]"><Trans id="today.lumi.ready" message="Lumi is ready to study with you." /></p></aside>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,0.38fr)]">
        <PracticeModes model={model} actions={actions} />
        {model.placementAvailable && (
          <aside aria-labelledby="placement-invite-heading" className="liquid-glass rounded-[28px] border border-[var(--sf-border)] p-5 sm:p-6">
            <p className="premium-kicker uppercase tracking-[0.14em]"><Trans id="today.placement.kicker" message="Optional" /></p>
            <h2 id="placement-invite-heading" className="mt-2 text-xl font-black tracking-tight"><Trans id="today.placement.title" message="Not sure where to begin?" /></h2>
            <p className="mt-2 text-pretty text-sm leading-6 text-[var(--sf-text-muted)]"><Trans id="today.placement.description" message="Take a diagnostic check. It will not change your review history or unlock content." /></p>
            <button type="button" onClick={actions.startPlacement} className={`${secondaryButton} mt-5 w-full`}><Trans id="today.placement.action" message="Take placement check" /></button>
          </aside>
        )}
      </div>
    </section>
  );
}
