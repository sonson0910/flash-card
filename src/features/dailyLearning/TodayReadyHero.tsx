import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { ArrowRight, CalendarDays, Globe2, Play, Plus, RefreshCw, Sparkles, Star, Zap } from 'lucide-react';
import type { CardData } from '../../types/card';
import { Lumi } from '../../components/lumi/Lumi';
import { openWebWordsRoute } from '../webWords/webWordsRoute';
import type { WebWordsPreview } from '../webWords/useWebWordsPreview';
import type { TodayScreenActions, TodayScreenModel, TodaySessionWord } from './dailyLearningPresentation';
import {
  dayPeriod,
  daysUntil,
  greetingName,
  isoWeekNumber,
  levelProgress,
  runDayNumber,
  sessionMinutes,
  sessionsToNextLevel,
  sessionXpCeiling,
  sourceSite,
  stageMinutes,
  type StudyRun,
  type TodayStageFact,
} from './todayScreenFacts';
import './today-ready-hero.css';

const WebWordsPreviewSource = lazy(() => import('../webWords/WebWordsPreviewSource'));

export const sessionStageContent = {
  review: {
    label: msg({ id: 'session.stage.review', message: 'Review' }),
    description: msg({ id: 'session.stage.review.description', message: 'Review the words that are due or need another pass.' }),
  },
  new: {
    label: msg({ id: 'session.stage.new', message: 'New words' }),
    description: msg({ id: 'session.stage.new.description', message: 'Meet a few new words for the first time.' }),
  },
  match: {
    label: msg({ id: 'session.stage.match', message: 'Word match' }),
    description: msg({ id: 'session.stage.match.description', message: 'Match target words to their meanings for a quick bonus round.' }),
  },
  recap: {
    label: msg({ id: 'session.stage.recap', message: 'Recap' }),
    description: msg({ id: 'session.stage.recap.description', message: 'See what you strengthened today.' }),
  },
} as const;

const stageIcons = { review: RefreshCw, new: Plus, match: Zap, recap: Star } as const;

export interface TodayReadyHeroProps {
  readonly model: TodayScreenModel;
  readonly actions: TodayScreenActions;
  readonly ownerId?: string | null;
  readonly targetLanguage?: string | null;
  readonly translationLanguage?: string | null;
  /** The streak chip owns its own dialog; the hero only places it. */
  readonly streakChip: ReactNode;
  readonly showLumi: boolean;
}

interface ReadyFacts {
  readonly stages: readonly TodayStageFact[];
  readonly minutes: number;
  readonly xpCeiling: number;
  readonly readyCount: number;
  readonly reviewCount: number;
  readonly activeSteps: number;
  readonly run: StudyRun;
  readonly level: ReturnType<typeof levelProgress> | null;
  readonly sessionsToLevel: number | null;
}

const readyFacts = (model: TodayScreenModel): ReadyFacts => {
  const plan = model.plan ?? { total: 0, due: 0, weak: 0, fresh: 0, isShort: true };
  const stages: readonly TodayStageFact[] = model.sessionStages ?? [
    { id: 'review', count: plan.due + plan.weak, skipped: plan.due + plan.weak === 0 },
    { id: 'new', count: plan.fresh, skipped: plan.fresh === 0 },
    { id: 'match', count: 0, skipped: true },
    { id: 'recap', count: 0, skipped: false },
  ];
  const level = model.learner?.xp === undefined ? null : levelProgress(model.learner.xp);
  return {
    stages,
    minutes: sessionMinutes(stages),
    xpCeiling: sessionXpCeiling(stages),
    readyCount: plan.total || stages.find(stage => stage.id === 'match' && !stage.skipped)?.count || 0,
    reviewCount: plan.due + plan.weak,
    activeSteps: stages.filter(stage => !stage.skipped).length,
    run: model.studyRun ?? { studiedToday: (model.streak ?? 0) > 0, days: model.streak ?? 0 },
    level,
    sessionsToLevel: level ? sessionsToNextLevel(level.remaining, (model.recentStudyXp ?? []).map(XP => ({ XP }))) : null,
  };
};

/** Narrow screens get the phone composition; read synchronously so the first paint is already right. */
const COMPACT_QUERY = '(max-width: 767px)';
function useCompactLayout(): boolean {
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(COMPACT_QUERY).matches);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(COMPACT_QUERY);
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return compact;
}

/** The board's keyboard hint: the key starts the session unless focus is in a control or a dialog is open. */
function useStartShortcut(key: ' ' | 'Enter', enabled: boolean, start: () => void) {
  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== key || event.repeat || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, select, button, a, summary, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault();
      startRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [key, enabled]);
}

function useHeadingRef(model: TodayScreenModel) {
  return (heading: HTMLHeadingElement | null) => {
    if (model.headingRef) model.headingRef.current = heading;
  };
}

function StageSub({ stage, model }: { readonly stage: TodayStageFact & { readonly webCount?: number }; readonly model: TodayScreenModel }) {
  const { _ } = useLingui();
  const plan = model.plan;
  if (stage.skipped) return <>{_(msg({ id: 'today.stage.skipped', message: 'Skipped' }))}</>;
  if (stage.id === 'review') {
    const due = plan?.due ?? stage.count;
    const weak = plan?.weak ?? 0;
    return <>{_({ ...msg({ id: 'today.stage.due.count', message: '{count, plural, one {# due} other {# due}}' }), values: { count: due } })}{weak > 0 && <> · {_({ ...msg({ id: 'today.stage.weak.count', message: '{count, plural, one {# weak} other {# weak}}' }), values: { count: weak } })}</>}</>;
  }
  if (stage.id === 'new') {
    return <>{_({ ...msg({ id: 'today.stage.fresh.count', message: '{count, plural, one {# new} other {# new}}' }), values: { count: stage.count } })}{(stage.webCount ?? 0) > 0 && <> · {_({ ...msg({ id: 'today.stage.from-web', message: '{count} from the web' }), values: { count: stage.webCount } })}</>}</>;
  }
  if (stage.id === 'match') return <>{_({ ...msg({ id: 'today.stage.match.pairs', message: '{count, plural, one {# pair} other {# pairs}} · quick round' }), values: { count: stage.count } })}</>;
  return <>{_(msg({ id: 'today.stage.recap.sub', message: 'XP, streak, weak words' }))}</>;
}

function StageRail({ model, facts, variant }: { readonly model: TodayScreenModel; readonly facts: ReadyFacts; readonly variant: 'classic' | 'crystal' }) {
  const { _ } = useLingui();
  const currentId = facts.stages.find(stage => !stage.skipped)?.id;
  return (
    <ol className={`today-stage-rail today-stage-rail--${variant}`} aria-label={_(msg({ id: 'today.plan.order', message: 'Daily plan order' }))}>
      {facts.stages.map((stage, index) => {
        const Icon = stageIcons[stage.id];
        const minutes = stageMinutes(stage);
        const isCurrent = stage.id === currentId;
        return (
          <li key={stage.id} className={`today-stage${stage.skipped ? ' today-stage--skipped' : ''}${isCurrent ? ' today-stage--current' : ''}`} data-stage-id={stage.id} data-stage-count={stage.count}>
            {variant === 'classic'
              ? <span className="today-stage-mark" aria-hidden="true"><span className="today-stage-icon"><Icon size={17} strokeWidth={1.9} /></span><span className="today-stage-link" /></span>
              : <span className="today-stage-node" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>}
            <p className="today-stage-title">{_(sessionStageContent[stage.id].label)}</p>
            <p className="today-stage-sub"><StageSub stage={stage} model={model} /></p>
            {variant === 'classic' && !stage.skipped && (
              <p className="today-stage-time">{_({ ...msg({ id: 'today.stage.minutes', message: '≈ {minutes} min' }), values: { minutes } })}</p>
            )}
            <p className="sr-only">{_(sessionStageContent[stage.id].description)}</p>
          </li>
        );
      })}
    </ol>
  );
}

function streakLine(_: ReturnType<typeof useLingui>['_'], facts: ReadyFacts, streak: number | undefined): string {
  if (facts.run.studiedToday) {
    return _({ ...msg({ id: 'today.hero.streak.keep', message: '{count, plural, one {keeps your #-day streak} other {keeps your #-day streak}}' }), values: { count: Math.max(streak ?? 0, facts.run.days, 1) } });
  }
  if (facts.run.days > 0) {
    return _({ ...msg({ id: 'today.hero.streak.extend', message: 'makes it a {count}-day streak' }), values: { count: runDayNumber(facts.run) } });
  }
  return _(msg({ id: 'today.hero.streak.start', message: 'starts your study streak' }));
}

function GoalChip({ model }: { readonly model: TodayScreenModel }) {
  const { _ } = useLingui();
  const goal = model.learner?.goal;
  const days = goal?.targetDate ? daysUntil(goal.targetDate, new Date()) : null;
  const text = !goal
    ? model.courseLabel ?? _(msg({ id: 'today.course.fallback', message: 'Your current course' }))
    : days !== null && goal.level
      ? _({ ...msg({ id: 'today.hero.goal.days-level', message: '{goal} in {days, plural, one {# day} other {# days}} · target {level}' }), values: { goal: goal.label, days, level: goal.level } })
      : days !== null
        ? _({ ...msg({ id: 'today.hero.goal.days', message: '{goal} in {days, plural, one {# day} other {# days}}' }), values: { goal: goal.label, days } })
        : goal.level
          ? _({ ...msg({ id: 'today.hero.goal.level', message: '{goal} · target {level}' }), values: { goal: goal.label, level: goal.level } })
          : goal.label;
  return <p className="today-chip today-chip--accent"><CalendarDays size={13} aria-hidden="true" />{text}</p>;
}

function PrimaryAction({ model, actions, facts, label, shortcut, className, children }: {
  readonly model: TodayScreenModel;
  readonly actions: TodayScreenActions;
  readonly facts: ReadyFacts;
  readonly label: string;
  readonly shortcut: 'Space' | 'Enter' | null;
  readonly className: string;
  readonly children?: ReactNode;
}) {
  return (
    <button
      type="button"
      data-primary-learning-action="true"
      disabled={model.isOffline}
      onClick={actions.startSession}
      aria-keyshortcuts={shortcut ?? undefined}
      className={className}
      data-session-minutes={facts.minutes}
    >
      {children ?? <><Play size={14} fill="currentColor" aria-hidden="true" /><span>{label}</span></>}
      {shortcut && <kbd aria-hidden="true">{shortcut}</kbd>}
    </button>
  );
}

function LevelRow({ model, actions, facts }: { readonly model: TodayScreenModel; readonly actions: TodayScreenActions; readonly facts: ReadyFacts }) {
  const { _, i18n } = useLingui();
  const level = facts.level;
  if (!level && facts.reviewCount === 0) return null;
  const number = new Intl.NumberFormat(i18n.locale);
  return (
    <div className="today-level-row">
      {level && (
        <div className="today-level">
          <div className="today-level-copy">
            <span><Trans {...msg({ id: 'today.hero.level', message: 'Level {level} · <0>{xp}</0> / {next} XP' })} values={{ level: level.level, xp: number.format(level.xp), next: number.format(level.next) }} components={{ 0: <b /> }} /></span>
            {facts.sessionsToLevel !== null && <span>{_({ ...msg({ id: 'today.hero.level-eta', message: 'Level {level} after ≈ {sessions, plural, one {# session} other {# sessions}}' }), values: { level: level.level + 1, sessions: facts.sessionsToLevel } })}</span>}
          </div>
          <div className="today-level-track" role="progressbar" aria-label={_(msg({ id: 'today.hero.level-progress', message: 'Level progress' }))} aria-valuemin={0} aria-valuemax={100} aria-valuenow={level.percent}>
            <span style={{ width: `${level.percent}%` }} />
          </div>
        </div>
      )}
      {facts.reviewCount > 0 && (
        <button type="button" className="today-text-link" disabled={model.isOffline} onClick={actions.continueReview}>
          {_(msg({ id: 'today.hero.review-only', message: 'Just review instead' }))}<ArrowRight size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function siteBadge(site: string | null): string {
  return site ? site.charAt(0).toUpperCase() : '•';
}

function WebWordRows({ items }: { readonly items: readonly CardData[] }) {
  return (
    <ul className="today-words-list">
      {items.map(card => {
        const site = sourceSite(card.source?.url);
        return (
          <li key={card.id} className="today-word">
            <span className="today-word-badge" aria-hidden="true">{siteBadge(site)}</span>
            <span className="today-word-term" lang={card.language}>{card.word}</span>
            <span className="today-word-meaning" lang={card.translationLanguage}>{card.translation}</span>
            <span className="today-word-source">{site}{card.source?.context ? <> · “{card.source.context}”</> : null}</span>
          </li>
        );
      })}
    </ul>
  );
}

function SessionWordRows({ words }: { readonly words: readonly TodaySessionWord[] }) {
  const { _ } = useLingui();
  const reasonLabel = (reason: TodaySessionWord['reason']) => reason === 'new'
    ? _(msg({ id: 'today.words.reason.new', message: 'New word' }))
    : reason === 'weak'
      ? _(msg({ id: 'today.words.reason.weak', message: 'Needs another pass' }))
      : _(msg({ id: 'today.words.reason.due', message: 'Due for review' }));
  return (
    <ul className="today-words-list">
      {words.map(word => {
        const site = sourceSite(word.sourceUrl);
        const Icon = word.reason === 'new' ? Plus : RefreshCw;
        return (
          <li key={word.id} className="today-word">
            <span className="today-word-badge" aria-hidden="true">{site ? siteBadge(site) : <Icon size={11} strokeWidth={2.2} />}</span>
            <span className="today-word-term" lang={word.language}>{word.word}</span>
            <span className="today-word-meaning" lang={word.translationLanguage}>{word.translation}</span>
            <span className="today-word-source">{reasonLabel(word.reason)}{site ? <> · {site}</> : null}{word.sourceContext ? <> · “{word.sourceContext}”</> : null}</span>
          </li>
        );
      })}
    </ul>
  );
}

function WordsPanelFrame({ title, subtitle, children, footer }: { readonly title: string; readonly subtitle: string; readonly children: ReactNode; readonly footer: ReactNode }) {
  return (
    <>
      <div className="today-words-head">
        <span className="today-words-logo" aria-hidden="true"><Globe2 size={17} /></span>
        <div>
          <h2 id="today-words-heading">{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      {children}
      <div className="today-words-foot">{footer}</div>
    </>
  );
}

function SessionWordsPanel({ model, actions }: { readonly model: TodayScreenModel; readonly actions: TodayScreenActions }) {
  const { _ } = useLingui();
  const words = model.sessionWords ?? [];
  const total = model.plan?.total ?? words.length;
  return (
    <WordsPanelFrame
      title={_(msg({ id: 'today.words.session.title', message: "In today's session" }))}
      subtitle={_({ ...msg({ id: 'today.words.session.subtitle', message: '{shown} of {total, plural, one {# planned word} other {# planned words}}' }), values: { shown: words.length, total } })}
      footer={<button type="button" className="today-words-link" onClick={actions.openVocabulary}>{_(msg({ id: 'today.words.session.open', message: 'Open vocabulary' }))}<ArrowRight size={13} aria-hidden="true" /></button>}
    >
      {words.length > 0
        ? <SessionWordRows words={words} />
        : <p className="today-words-empty">{_(msg({ id: 'today.words.session.match-only', message: 'Today is a Word Match round with words you already know.' }))}</p>}
    </WordsPanelFrame>
  );
}

function WebWordsPanel({ preview, model }: { readonly preview: WebWordsPreview; readonly model: TodayScreenModel }) {
  const { _ } = useLingui();
  const count = preview.items.length;
  const inSession = model.sessionWebWordCount ?? 0;
  return (
    <WordsPanelFrame
      title={_(msg({ id: 'today.words.web.title', message: 'Words you met on the web' }))}
      subtitle={preview.isAtCap
        ? _({ ...msg({ id: 'today.words.web.subtitle-cap', message: 'Your {count} newest saves · {inSession} in today’s session' }), values: { count, inSession } })
        : _({ ...msg({ id: 'today.words.web.subtitle', message: '{count, plural, one {# saved word} other {# saved words}} · {inSession} in today’s session' }), values: { count, inSession } })}
      footer={<button type="button" className="today-words-link" onClick={openWebWordsRoute}>{_(msg({ id: 'today.words.web.open', message: 'See all with their sentences' }))}<ArrowRight size={13} aria-hidden="true" /></button>}
    >
      <WebWordRows items={preview.items} />
    </WordsPanelFrame>
  );
}

function WordsPanel({ model, actions, ownerId, targetLanguage, translationLanguage, render }: Pick<TodayReadyHeroProps, 'model' | 'actions' | 'ownerId' | 'targetLanguage' | 'translationLanguage'> & {
  readonly render: (preview: WebWordsPreview | null) => ReactNode;
}) {
  void model;
  void actions;
  return (
    <Suspense fallback={render(null)}>
      <WebWordsPreviewSource ownerId={ownerId ?? null} targetLanguage={targetLanguage ?? null} translationLanguage={translationLanguage ?? null}>
        {preview => render(preview.items.length > 0 ? preview : null)}
      </WebWordsPreviewSource>
    </Suspense>
  );
}

function ClassicDesktopHero({ model, actions, ownerId, targetLanguage, translationLanguage, streakChip }: TodayReadyHeroProps) {
  const { _ } = useLingui();
  const facts = readyFacts(model);
  const assignHeading = useHeadingRef(model);
  useStartShortcut(' ', !model.isOffline, actions.startSession);
  const period = dayPeriod(new Date());
  const name = greetingName(model.learner?.name);
  const greeting = name
    ? _({ ...msg({ id: 'today.hero.greeting.named', message: '{period, select, morning {Good morning, {name}.} afternoon {Good afternoon, {name}.} other {Good evening, {name}.}}' }), values: { period, name } })
    : _({ ...msg({ id: 'today.hero.greeting', message: '{period, select, morning {Good morning.} afternoon {Good afternoon.} other {Good evening.}}' }), values: { period } });
  const plan = model.plan;

  return (
    <section aria-labelledby="daily-today-heading" className="today-hero" data-today-ready="true">
      <div className="today-hero-main">
        <div className="today-hero-chips">
          <GoalChip model={model} />
          {streakChip}
        </div>
        <h1 id="daily-today-heading" ref={assignHeading} tabIndex={-1} className="today-hero-title">
          <span className="today-hero-line">{greeting}</span>
          <span className="today-hero-line">
            <Trans {...msg({ id: 'today.hero.minutes', message: '<0>{minutes, plural, one {# minute} other {# minutes}}</0> today.' })} values={{ minutes: facts.minutes }} components={{ 0: <em /> }} />
          </span>
        </h1>
        <p className="sr-only" role="status" aria-live="polite">{model.message}</p>
        <div className="today-session-card">
          <div className="today-session-head">
            <h2>{_(msg({ id: 'today.hero.session', message: "Today's session" }))}</h2>
            <span>{_({ ...msg({ id: 'today.hero.session-size', message: '{count, plural, one {# card} other {# cards}} planned' }), values: { count: facts.readyCount } })}</span>
          </div>
          <StageRail model={model} facts={facts} variant="classic" />
          <div className="today-session-cta">
            <PrimaryAction
              model={model}
              actions={actions}
              facts={facts}
              shortcut="Space"
              className="today-primary"
              label={_({ ...msg({ id: 'today.hero.start', message: "Start today's session · {minutes} min" }), values: { minutes: facts.minutes } })}
            />
            <p className="today-session-reward">
              <span>{_({ ...msg({ id: 'today.hero.xp', message: 'Up to +{xp} XP when you finish' }), values: { xp: facts.xpCeiling } })}</span>
              <strong>{streakLine(_, facts, model.streak)}</strong>
            </p>
          </div>
          {plan?.isShort && <p className="today-session-note">{_(msg({ id: 'today.plan.short-description', message: 'There are fewer than 10 eligible cards today. You can still complete this shorter plan.' }))}</p>}
        </div>
        <LevelRow model={model} actions={actions} facts={facts} />
      </div>
      <aside className="today-words" aria-labelledby="today-words-heading" data-today-words="true">
        <WordsPanel
          model={model}
          actions={actions}
          ownerId={ownerId}
          targetLanguage={targetLanguage}
          translationLanguage={translationLanguage}
          render={preview => preview ? <WebWordsPanel preview={preview} model={model} /> : <SessionWordsPanel model={model} actions={actions} />}
        />
      </aside>
    </section>
  );
}

function ClassicCompactHero({ model, actions, streakChip }: TodayReadyHeroProps) {
  const { _, i18n } = useLingui();
  const facts = readyFacts(model);
  const assignHeading = useHeadingRef(model);
  const now = new Date();
  const dateLabel = `${new Intl.DateTimeFormat(i18n.locale, { weekday: 'long' }).format(now)} · ${new Intl.DateTimeFormat(i18n.locale, { day: 'numeric', month: 'short' }).format(now)}`;
  const card = model.previewCard;
  const firstReason = model.sessionWords?.[0]?.reason;
  const number = new Intl.NumberFormat(i18n.locale);

  return (
    <section aria-labelledby="daily-today-heading" className="today-hero today-hero--compact" data-today-ready="true">
      <div className="today-compact-top">
        <p className="today-compact-date">{dateLabel}</p>
        {streakChip}
      </div>
      <h1 id="daily-today-heading" ref={assignHeading} tabIndex={-1} className="today-hero-title">
        <Trans {...msg({ id: 'today.hero.ready-words', message: '{count, plural, one {# word ready to <0>remember.</0>} other {# words ready to <0>remember.</0>}}' })} values={{ count: facts.readyCount }} components={{ 0: <em /> }} />
      </h1>
      <p className="sr-only" role="status" aria-live="polite">{model.message}</p>
      {card && (
        <div className="today-stack">
          <span className="today-stack-ghost today-stack-ghost--back" aria-hidden="true" />
          <span className="today-stack-ghost today-stack-ghost--mid" aria-hidden="true" />
          <article className="today-stack-card" data-today-preview="true" aria-label={`${card.word}: ${card.translation}`}>
            {card.imageUrl
              ? <img src={card.imageUrl} alt="" className="today-stack-image" loading="lazy" />
              : <span className="today-stack-image today-stack-image--empty" aria-hidden="true"><Sparkles size={22} /></span>}
            <p className="today-stack-label">{firstReason === 'new' ? _(msg({ id: 'today.stack.new', message: 'New word' })) : _(msg({ id: 'today.stack.due', message: 'Due now' }))}</p>
            <p className="today-stack-word" lang={card.language}>{card.word}</p>
            {card.phonetic && <p className="today-stack-phonetic">{card.phonetic}</p>}
            <p className="sr-only" lang={card.translationLanguage}>{card.translation}</p>
          </article>
        </div>
      )}
      <PrimaryAction
        model={model}
        actions={actions}
        facts={facts}
        shortcut={null}
        className="today-primary today-primary--wide"
        label={_({ ...msg({ id: 'today.hero.start', message: "Start today's session · {minutes} min" }), values: { minutes: facts.minutes } })}
      />
      <div className="today-tiles">
        <div className="today-tile">
          <span>{_(msg({ id: 'today.tile.review', message: 'To review' }))}</span>
          <strong>{facts.reviewCount}<small> / {facts.readyCount}</small></strong>
        </div>
        {facts.level
          ? (
            <div className="today-tile">
              <span>{_({ ...msg({ id: 'today.tile.level', message: 'Level {level}' }), values: { level: facts.level.level } })}</span>
              <strong>{number.format(facts.level.xp)}<small> / {number.format(facts.level.next)} XP</small></strong>
            </div>
          )
          : (
            <div className="today-tile">
              <span>{_(msg({ id: 'today.tile.new', message: 'New words' }))}</span>
              <strong>{model.plan?.fresh ?? 0}</strong>
            </div>
          )}
      </div>
    </section>
  );
}

function CrystalHero({ model, actions, ownerId, targetLanguage, translationLanguage, streakChip, showLumi }: TodayReadyHeroProps) {
  const { _, i18n } = useLingui();
  const facts = readyFacts(model);
  const assignHeading = useHeadingRef(model);
  useStartShortcut('Enter', !model.isOffline, actions.startSession);
  const now = new Date();
  const weekday = new Intl.DateTimeFormat(i18n.locale, { weekday: 'long' }).format(now);
  const day = runDayNumber(facts.run);
  const number = new Intl.NumberFormat(i18n.locale);
  const name = greetingName(model.learner?.name);
  const goals = [
    { id: 'lesson', label: _(msg({ id: 'today.crystal.goal.lesson', message: "Finish today's lesson" })), xp: facts.xpCeiling, total: 1 },
    ...facts.stages.filter(stage => !stage.skipped && (stage.id === 'review' || stage.id === 'new' || stage.id === 'match')).map(stage => ({
      id: stage.id,
      label: stage.id === 'review'
        ? _({ ...msg({ id: 'today.crystal.goal.review', message: '{count, plural, one {Review # card} other {Review # cards}}' }), values: { count: stage.count } })
        : stage.id === 'new'
          ? _({ ...msg({ id: 'today.crystal.goal.new', message: '{count, plural, one {Meet # new word} other {Meet # new words}}' }), values: { count: stage.count } })
          : _(msg({ id: 'today.crystal.goal.match', message: 'Clear the word match' })),
      xp: stage.id === 'match' ? sessionXpCeiling([stage]) : stage.count * 2,
      total: stage.id === 'match' ? 1 : stage.count,
    })),
  ].slice(0, 3);

  return (
    <section aria-labelledby="daily-today-heading" className="today-crystal" data-today-ready="true">
      <span aria-hidden="true" className="crystal-starfield today-crystal-stars pointer-events-none motion-reduce:animate-none" />
      <div className="today-crystal-left">
        <div className="today-crystal-kicker">
          <p>{_({ ...msg({ id: 'today.crystal.kicker', message: '{weekday} // Week {week}' }), values: { weekday, week: isoWeekNumber(now) } })}</p>
          {streakChip}
        </div>
        <h1 id="daily-today-heading" ref={assignHeading} tabIndex={-1} className="today-crystal-title">
          {_({ ...msg({ id: 'today.crystal.day', message: 'Day {day}' }), values: { day } })}
        </h1>
        <p className="today-crystal-lede">
          {_({ ...msg({ id: 'today.crystal.lede', message: '{count, plural, one {# card is waiting for you.} other {# cards are waiting for you.}} One lesson covers {steps, plural, one {# step} other {all # steps}}.' }), values: { count: facts.readyCount, steps: facts.activeSteps } })}
        </p>
        <p className="sr-only" role="status" aria-live="polite">{model.message}</p>
        <div className="today-crystal-cta">
          <span className="today-crystal-wing today-crystal-wing--left" aria-hidden="true" />
          <span className="today-crystal-wing today-crystal-wing--right" aria-hidden="true" />
          <PrimaryAction model={model} actions={actions} facts={facts} shortcut="Enter" className="today-crystal-start" label="">
            <span className="today-crystal-start-icon" aria-hidden="true"><Star size={22} fill="currentColor" /></span>
            <span className="today-crystal-start-copy">
              <strong>{_(msg({ id: 'today.crystal.start', message: "Start today's lesson" }))}</strong>
              <small>{_({ ...msg({ id: 'today.crystal.start-meta', message: '{minutes} min · {steps, plural, one {# step} other {# steps}} · up to +{xp} XP' }), values: { minutes: facts.minutes, steps: facts.activeSteps, xp: facts.xpCeiling } })}</small>
            </span>
          </PrimaryAction>
        </div>
        {showLumi && (
          <div className="today-crystal-lumi" data-today-lumi="hero">
            <Lumi pose="idle" size={200} eager className="crystal-ornament" />
            <div className="today-crystal-bubble">
              <p className="today-crystal-bubble-kicker">{_(msg({ id: 'today.crystal.lumi-link', message: 'Lumi · Link' }))}</p>
              <p className="today-crystal-bubble-title">
                {name
                  ? _({ ...msg({ id: 'today.crystal.lumi-hi.named', message: '{count, plural, one {Hi {name}! # card is waiting.} other {Hi {name}! # cards are waiting.}}' }), values: { name, count: facts.readyCount } })
                  : _({ ...msg({ id: 'today.crystal.lumi-hi', message: '{count, plural, one {Hi! # card is waiting.} other {Hi! # cards are waiting.}}' }), values: { count: facts.readyCount } })}
              </p>
              <p>{facts.run.studiedToday
                ? _({ ...msg({ id: 'today.crystal.lumi-streak.today', message: '{count, plural, one {Streak # day. Nice work today.} other {Streak # days. Nice work today.}}' }), values: { count: Math.max(model.streak ?? 0, facts.run.days, 1) } })
                : facts.run.days > 0
                  ? _({ ...msg({ id: 'today.crystal.lumi-streak.extend', message: 'Finish today to make it {count} days in a row.' }), values: { count: day } })
                  : _(msg({ id: 'today.crystal.lumi-streak.start', message: 'Finish today to start a new streak.' }))}</p>
            </div>
          </div>
        )}
      </div>
      <div className="today-crystal-right">
        <section className="today-crystal-panel today-crystal-path" aria-labelledby="today-crystal-path-heading">
          <div className="today-crystal-panel-head">
            <h2 id="today-crystal-path-heading">{_(msg({ id: 'today.crystal.path', message: "Today's path" }))}<span> // {_({ ...msg({ id: 'today.crystal.path-steps', message: '{steps, plural, one {# step} other {# steps}}' }), values: { steps: facts.activeSteps } })}</span></h2>
            <span>{_({ ...msg({ id: 'today.crystal.path-minutes', message: '~{minutes} min' }), values: { minutes: facts.minutes } })}</span>
          </div>
          <StageRail model={model} facts={facts} variant="crystal" />
        </section>
        <div className={`today-crystal-row${facts.level ? '' : ' today-crystal-row--single'}`}>
          <section className="today-crystal-panel today-crystal-goals" aria-labelledby="today-crystal-goals-heading">
            <div className="today-crystal-panel-head">
              <h2 id="today-crystal-goals-heading"><span className="today-crystal-diamond" aria-hidden="true" />{_(msg({ id: 'today.crystal.goals', message: 'Daily goals' }))}</h2>
            </div>
            <ul>
              {goals.map((goal, index) => (
                <li key={goal.id} className={`today-crystal-goal today-crystal-goal--${index}`}>
                  <span className="today-crystal-goal-label">{goal.label}</span>
                  {goal.xp > 0 && <span className="today-crystal-goal-xp">+{goal.xp}XP</span>}
                  <span className="today-crystal-goal-bar" aria-hidden="true"><span style={{ width: '0%' }} /></span>
                  <span className="today-crystal-goal-count">0/{goal.total}</span>
                </li>
              ))}
            </ul>
          </section>
          {facts.level && (
            <section className="today-crystal-panel today-crystal-level" aria-labelledby="today-crystal-level-heading">
              <h2 id="today-crystal-level-heading">{_(msg({ id: 'today.crystal.level', message: 'Level' }))}</h2>
              <p className="today-crystal-level-value">{_({ ...msg({ id: 'today.crystal.level-value', message: 'Lv {level}' }), values: { level: facts.level.level } })}</p>
              <p className="today-crystal-level-xp">{number.format(facts.level.xp)} / {number.format(facts.level.next)} XP</p>
              <span className="today-crystal-goal-bar" role="progressbar" aria-label={_(msg({ id: 'today.hero.level-progress', message: 'Level progress' }))} aria-valuemin={0} aria-valuemax={100} aria-valuenow={facts.level.percent}><span style={{ width: `${facts.level.percent}%` }} /></span>
              <p className="today-crystal-level-next">{_({ ...msg({ id: 'today.crystal.level-next', message: '+{xp} XP to Lv {level}' }), values: { xp: number.format(facts.level.remaining), level: facts.level.level + 1 } })}</p>
            </section>
          )}
        </div>
        <section className="today-crystal-panel today-crystal-words" aria-labelledby="today-words-heading" data-today-words="true">
          <WordsPanel
            model={model}
            actions={actions}
            ownerId={ownerId}
            targetLanguage={targetLanguage}
            translationLanguage={translationLanguage}
            render={preview => (
              <>
                <div className="today-crystal-panel-head">
                  <h2 id="today-words-heading">
                    {preview ? _(msg({ id: 'today.crystal.words.web', message: 'Words from the web' })) : _(msg({ id: 'today.crystal.words.session', message: "In today's lesson" }))}
                    <span> // {preview
                      ? _({ ...msg({ id: 'today.crystal.words.web-count', message: '{count} saved · {inSession} in this lesson' }), values: { count: preview.items.length, inSession: model.sessionWebWordCount ?? 0 } })
                      : _({ ...msg({ id: 'today.crystal.words.session-count', message: '{count, plural, one {# word} other {# words}}' }), values: { count: model.plan?.total ?? 0 } })}</span>
                  </h2>
                </div>
                <ul className="today-crystal-chips">
                  {preview
                    ? preview.items.map(card => <li key={card.id}><b lang={card.language}>{card.word}</b><span>{sourceSite(card.source?.url)}</span></li>)
                    : (model.sessionWords ?? []).map(word => <li key={word.id}><b lang={word.language}>{word.word}</b><span lang={word.translationLanguage}>{word.translation}</span></li>)}
                </ul>
                {preview && <button type="button" className="today-crystal-words-link" onClick={openWebWordsRoute}>{_(msg({ id: 'today.words.web.open', message: 'See all with their sentences' }))}<ArrowRight size={13} aria-hidden="true" /></button>}
              </>
            )}
          />
        </section>
      </div>
    </section>
  );
}

export function TodayReadyHero(props: TodayReadyHeroProps & { readonly isCrystal: boolean }) {
  const compact = useCompactLayout();
  if (props.isCrystal) return <CrystalHero {...props} />;
  return compact ? <ClassicCompactHero {...props} /> : <ClassicDesktopHero {...props} />;
}
