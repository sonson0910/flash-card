import { useId, useMemo } from 'react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { readDailyPace } from '../settings/dailyPacePreference';
import { useTheme } from '../theme/ThemeProvider';
import { buildDailyGoals, type DailyGoal, type DailyGoalsSource } from './dailyGoalsModel';
import { resolveStudyTimeZone } from './studyDayCountdown';
import { useMinuteClock } from './useMinuteClock';
import './daily-goals-panel.css';

const UNKNOWN_PROGRESS = '—';

export interface DailyGoalsPanelProps {
  /** The verified gamification state (`useVerifiedGamification`); only server-written fields are read. */
  readonly gamification: DailyGoalsSource & { readonly rewardTimeZone?: string };
  /** Whether today's plan has a Word Match stage. */
  readonly planHasMatch: boolean;
  /** Cards per day; defaults to the saved daily pace setting. */
  readonly dailyPace?: number;
  /** A fixed clock for fixtures and tests; the panel otherwise ticks every minute. */
  readonly now?: Date;
}

function GoalRow({ goal }: { readonly goal: DailyGoal }) {
  const { _ } = useLingui();
  const label = goal.id === 'study-cards'
    ? _({ ...msg({ id: 'daily-goals.goal.study-cards', message: '{count, plural, one {Study # card} other {Study # cards}}' }), values: { count: goal.cards } })
    : goal.id === 'win-match'
      ? _(msg({ id: 'daily-goals.goal.win-match', message: 'Win a word match' }))
      : goal.streakDays > 0
        ? _({ ...msg({ id: 'daily-goals.goal.keep-streak', message: 'Keep your {days}-day streak' }), values: { days: goal.streakDays } })
        : _(msg({ id: 'daily-goals.goal.start-streak', message: 'Start a streak' }));
  const xp = goal.id === 'keep-streak' ? null : goal.xp;
  const { progress } = goal;
  return (
    <li className={`daily-goal daily-goal--${goal.id}`}>
      <span className="daily-goal__label">{label}</span>
      {xp !== null && (
        <span className="daily-goal__xp">{_({ ...msg({ id: 'daily-goals.xp', message: '+{xp} XP' }), values: { xp } })}</span>
      )}
      {progress.state === 'counted' ? (
        <span
          className="daily-goal__bar"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={progress.target}
          aria-valuenow={progress.done}
          aria-valuetext={_({ ...msg({ id: 'daily-goals.progress-value', message: '{done} of {target}' }), values: { done: progress.done, target: progress.target } })}
        >
          <span className="daily-goal__fill" style={{ width: `${progress.percent}%` }} />
        </span>
      ) : (
        <span className="daily-goal__bar" aria-hidden="true"><span className="daily-goal__fill" style={{ width: '0%' }} /></span>
      )}
      {progress.state === 'counted' ? (
        <span className="daily-goal__count" aria-hidden="true">{`${progress.done}/${progress.target}`}</span>
      ) : (
        <span className="daily-goal__count">
          <span aria-hidden="true">{UNKNOWN_PROGRESS}</span>
          <span className="sr-only">{_(msg({ id: 'daily-goals.not-counted', message: 'Not counted yet today' }))}</span>
        </span>
      )}
    </li>
  );
}

/**
 * Today's goals with only the XP the server grants, progress from the server's day counters, and
 * a countdown to the end of the study day in the reward time zone.
 */
export function DailyGoalsPanel({ gamification, planHasMatch, dailyPace, now: fixedNow }: DailyGoalsPanelProps) {
  const { _ } = useLingui();
  const { family } = useTheme();
  const headingId = useId();
  const now = useMinuteClock(fixedNow);
  const pace = useMemo(() => dailyPace ?? readDailyPace(), [dailyPace]);
  const timeZone = resolveStudyTimeZone(gamification.rewardTimeZone);
  const model = buildDailyGoals({
    now,
    timeZone,
    dailyPace: pace,
    planHasMatch,
    xpHistory: gamification.xpHistory,
    streak: gamification.streak,
    lastStudyDay: gamification.lastStudyDay,
    dailyGoals: gamification.dailyGoals,
    streakState: gamification.streakState,
    rewards: gamification.rewards,
  });
  return (
    <section className={`daily-goals-panel daily-goals-panel--${family} crystal-chamfer`} aria-labelledby={headingId} data-daily-goals="true">
      <div className="daily-goals-panel__head">
        <h2 id={headingId} className="daily-goals-panel__title">
          <span className="daily-goals-panel__mark" aria-hidden="true" />
          {_(msg({ id: 'daily-goals.heading', message: 'Daily goals' }))}
        </h2>
        <span className="daily-goals-panel__separator" aria-hidden="true">{'·'}</span>
        <span className="daily-goals-panel__reset">
          {_({ ...msg({ id: 'daily-goals.resets-in', message: 'Resets in {hours} h {minutes} min' }), values: { hours: model.resetsIn.hours, minutes: model.resetsIn.minutes } })}
        </span>
      </div>
      <ul className="daily-goals-panel__list">
        {model.goals.map(goal => <GoalRow key={goal.id} goal={goal} />)}
      </ul>
    </section>
  );
}
