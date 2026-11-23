import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, X } from 'lucide-react';
import { STREAK_FREEZE_EARN_EVERY_DAYS, STREAK_MILESTONE_XP, STREAK_MILESTONES, type StreakMilestone } from '../../../functions/src/streak-rules';
import { Lumi, type LumiPose } from '../../components/lumi/Lumi';
import type { StreakView, StreakWeekDayState } from '../gamification/streakView';
import { useTheme } from '../theme/ThemeProvider';
import { readLumiEnabled } from '../settings/lumi-preference';
import { stageMinutes, type StreakRunStats, type StudyRun, type StudyWeekDay } from './todayScreenFacts';
import './streak-dialog.css';

interface StreakChipProps {
  /** The server's streak record read for today; the chip falls back to `streak` without it. */
  readonly view?: StreakView;
  /** Totals over the current run, shown on a milestone day. */
  readonly runStats?: StreakRunStats | null;
  /** The moment `view` was built for, so the repair window counts down from the same instant. */
  readonly now?: Date;
  /** Consecutive study days from XP history; used only without `view`, hidden below one. */
  readonly streak: number | undefined;
  readonly run?: StudyRun;
  /** This week of verified XP history; its XP feeds the week total. */
  readonly week?: readonly StudyWeekDay[];
  readonly className: string;
  /** Starts today's session; the dialog only closes without it. */
  readonly onStartSession?: () => void;
}

type DialogState = 'active' | 'frozen' | 'repair' | 'ended' | 'milestone';
type DayState = StreakWeekDayState;
interface DayEntry { readonly day: string; readonly state: DayState; readonly isToday: boolean }

const weekdayFormat = (locale: string, weekday: 'short' | 'long') => {
  try {
    return new Intl.DateTimeFormat(locale, { weekday, timeZone: 'UTC' });
  } catch {
    return new Intl.DateTimeFormat('en', { weekday, timeZone: 'UTC' });
  }
};

const dayDate = (isoDay: string) => new Date(`${isoDay}T12:00:00.000Z`);

const FLAME_PATH = 'M12 2c1 3.5-1.5 5.5-1.5 8.2 0 1.4 1 2.5 2.3 2.5 1.5 0 2.4-1.2 2.2-3 2.3 1.7 3.5 4.3 3.5 6.8C18.5 20 15.6 22 12 22s-6.5-2.3-6.5-5.9c0-4.7 4.3-7 6.5-14.1z';

function FlameIcon({ size, className }: { readonly size: number; readonly className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}><path d={FLAME_PATH} /></svg>;
}

/** The boards' streak-freeze mark; the badge on the hero adds the crystal tips. */
export function FreezeIcon({ size, tips = false, className }: { readonly size: number; readonly tips?: boolean; readonly className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true" className={className}>
      <path d={tips ? 'M12 2v20M4.5 6.5l15 11M19.5 6.5l-15 11M9 3.5l3 2.5 3-2.5M9 20.5l3-2.5 3 2.5' : 'M12 2v20M4.5 6.5l15 11M19.5 6.5l-15 11'} />
    </svg>
  );
}

function ClockIcon() {
  return <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9 2h6" /></svg>;
}

function DayMark({ state }: { readonly state: DayState }) {
  if (state === 'done') return <FlameIcon size={17} />;
  if (state === 'frozen') return <FreezeIcon size={18} />;
  if (state === 'repaired') return <Check size={17} strokeWidth={2.4} aria-hidden="true" />;
  if (state === 'missed') return <X size={15} strokeWidth={2.4} aria-hidden="true" />;
  return <span className="streak-dialog-dot" aria-hidden="true" />;
}

function StudyWeek({ days }: { readonly days: readonly DayEntry[] }) {
  const { _, i18n } = useLingui();
  const short = weekdayFormat(i18n.locale, 'short');
  const long = weekdayFormat(i18n.locale, 'long');
  const stateLabel = (state: DayState) => {
    if (state === 'done') return _(msg({ id: 'today.streak.day.done', message: 'studied' }));
    if (state === 'frozen') return _(msg({ id: 'today.streak.day.frozen', message: 'streak freeze used' }));
    if (state === 'repaired') return _(msg({ id: 'today.streak.day.repaired', message: 'repaired' }));
    if (state === 'missed') return _(msg({ id: 'today.streak.day.missed', message: 'no study' }));
    if (state === 'today') return _(msg({ id: 'today.streak.day.today', message: 'today, not studied yet' }));
    return _(msg({ id: 'today.streak.day.future', message: 'still ahead' }));
  };
  return (
    <ol className="streak-dialog-week" aria-label={_(msg({ id: 'today.streak.week', message: 'This week' }))}>
      {days.map(day => (
        <li key={day.day} data-state={day.state} data-today={day.isToday || undefined} aria-current={day.isToday ? 'date' : undefined} aria-label={`${long.format(dayDate(day.day))}: ${stateLabel(day.state)}`}>
          <span className="streak-dialog-day-label" aria-hidden="true">{short.format(dayDate(day.day))}</span>
          <span className="streak-dialog-day-mark" aria-hidden="true"><DayMark state={day.state} /></span>
        </li>
      ))}
    </ol>
  );
}

function FreezeRow({ view, crystal }: { readonly view: StreakView; readonly crystal: boolean }) {
  const { _ } = useLingui();
  const { held, max, nextEarnIn } = view.freezes;
  const every = STREAK_FREEZE_EARN_EVERY_DAYS;
  const full = held >= max;
  const detail = full
    ? crystal
      ? _({ ...msg({ id: 'today.streak.freezes.full.crystal', message: 'Earn one every {every}-day streak · you hold the most' }), values: { every } })
      : _({ ...msg({ id: 'today.streak.freezes.full', message: 'Earn one every {every}-day run · you hold the most' }), values: { every } })
    : crystal
      ? _({ ...msg({ id: 'today.streak.freezes.earn.crystal', message: '{count, plural, one {Earn one every {every}-day streak · next in # day} other {Earn one every {every}-day streak · next in # days}}' }), values: { every, count: nextEarnIn } })
      : _({ ...msg({ id: 'today.streak.freezes.earn', message: '{count, plural, one {Earn one every {every}-day run · next in # day} other {Earn one every {every}-day run · next in # days}}' }), values: { every, count: nextEarnIn } });
  return (
    <div className="streak-dialog-freezes">
      <span className="streak-dialog-freeze-slots" aria-hidden="true">
        {Array.from({ length: max }, (_slot, index) => (
          <span key={index} className="streak-dialog-freeze-slot" data-held={index >= max - held || undefined}>
            {index >= max - held && <FreezeIcon size={crystal ? 15 : 16} />}
          </span>
        ))}
      </span>
      <span className="streak-dialog-freeze-copy">
        <strong>{held > 0
          ? _({ ...msg({ id: 'today.streak.freezes.left', message: '{held} of {max} freezes left' }), values: { held, max } })
          : _(msg({ id: 'today.streak.freezes.none', message: 'No freezes left' }))}</strong>
        <span>{detail}</span>
      </span>
    </div>
  );
}

function RepairTile({ repair }: { readonly repair: NonNullable<StreakView['repair']> }) {
  const { _ } = useLingui();
  const half = repair.cardsNeeded / 2;
  const fill = (start: number) => Math.min(1, Math.max(0, (repair.cardsDone - start) / half));
  const minutes = stageMinutes({ id: 'review', count: Math.max(1, repair.cardsNeeded - repair.cardsDone), skipped: false });
  return (
    <div className="streak-dialog-repair">
      <p className="streak-dialog-repair-kicker">{_(msg({ id: 'today.streak.repair.kicker', message: 'Repair' }))}</p>
      <p className="streak-dialog-repair-title">{_({ ...msg({ id: 'today.streak.repair.title', message: '{count, plural, one {Review # card} other {Review # cards}}' }), values: { count: repair.cardsNeeded } })}</p>
      <div
        className="streak-dialog-repair-track"
        role="progressbar"
        aria-label={_(msg({ id: 'today.streak.repair.progress-label', message: 'Repair progress' }))}
        aria-valuemin={0}
        aria-valuemax={repair.cardsNeeded}
        aria-valuenow={repair.cardsDone}
      >
        {[0, half].map(start => <span key={start}><span style={{ transform: `scaleX(${fill(start)})` }} /></span>)}
      </div>
      <p className="streak-dialog-repair-meta">{_({ ...msg({ id: 'today.streak.repair.progress', message: '{done} / {total} · ≈ {minutes} min' }), values: { done: repair.cardsDone, total: repair.cardsNeeded, minutes } })}</p>
    </div>
  );
}

function RepairWindow({ endsAt, now }: { readonly endsAt: Date; readonly now: Date }) {
  const left = Math.max(0, Math.floor((endsAt.getTime() - now.getTime()) / 60_000));
  return (
    <div className="streak-dialog-window">
      <span className="streak-dialog-window-left">
        <ClockIcon />
        <Trans {...msg({ id: 'today.streak.repair.window', message: 'Repair window: <0>{hours} h {minutes} min</0>' })} values={{ hours: Math.floor(left / 60), minutes: left % 60 }} components={{ 0: <span className="streak-dialog-window-time" /> }} />
      </span>
      <span><Trans {...msg({ id: 'today.streak.repair.safe', message: 'Your XP and words are safe either way.' })} /></span>
    </div>
  );
}

const confetti = Array.from({ length: 14 }, (_piece, index) => ({
  left: `${(index * 37 + 7) % 96}%`, top: 20 + (index * 53) % 220, width: 6 + (index % 3) * 2, height: 10 + (index % 2) * 4,
  transform: `rotate(${(index * 47) % 180}deg)`, background: `var(--sf-confetti-${index % 5})`,
}));

const dialogStateFor = (view: StreakView): DialogState | null => {
  if (view.repair) return 'repair';
  if (view.status === 'ended') return 'ended';
  if (view.status === 'frozen') return 'frozen';
  if (view.status === 'safe' && (STREAK_MILESTONES as readonly number[]).includes(view.length)
    && view.milestones[`${view.length as StreakMilestone}`] === view.today) return 'milestone';
  if (view.status === 'safe' || view.status === 'open') return 'active';
  return null;
};

/** The streak chip and its details dialog, built from the server's streak record, or from the verified streak and XP history without one. */
export function StreakChip({ view, runStats, now, streak, run, week, className, onStartSession }: StreakChipProps) {
  const { _, i18n } = useLingui();
  const { family } = useTheme();
  const state: DialogState | null = view ? dialogStateFor(view) : streak !== undefined && streak >= 1 ? 'active' : null;
  if (!state) return null;
  const crystal = family === 'crystal';
  const showLumi = crystal && readLumiEnabled();
  const number = (value: number) => i18n.number(value);
  const length = view ? view.length : streak ?? 0;
  const previous = view?.previousLength ?? length;
  const studiedToday = view ? view.status === 'safe' : run?.studiedToday ?? true;
  const xpByDay = new Map(week?.map(day => [day.date, day.xp]) ?? []);
  const days: readonly DayEntry[] | undefined = view
    ? view.week.map(day => ({ day: day.day, state: day.state, isToday: day.day === view.today }))
    : week?.length === 7 ? week.map(day => ({ day: day.date, state: day.state, isToday: day.isToday })) : undefined;
  const studyDays = days?.filter(day => day.state === 'done').length ?? 0;
  const weekXp = days && xpByDay.size > 0 ? days.reduce((total, day) => total + (xpByDay.get(day.day) ?? 0), 0) : null;
  const held = view?.freezes.held ?? 0;
  const showFreezes = Boolean(view) && (state === 'active' || state === 'frozen');
  const milestoneXp = state === 'milestone' ? STREAK_MILESTONE_XP[length as StreakMilestone] : undefined;
  const lumiPose: LumiPose = state === 'milestone' ? 'cheer' : state === 'repair' || state === 'ended' ? 'sad' : 'hint';
  const runEnded = state === 'repair' || state === 'ended';
  const startsSession = onStartSession && (state === 'repair' || (state !== 'milestone' && !studiedToday));
  const em = <em />;

  const chip = view?.repair
    ? <><FlameIcon size={16} className="today-streak-flame" />{_(msg({ id: 'today.streak.chip.repair', message: 'Repair your streak' }))}</>
    : state === 'ended'
      ? <><FlameIcon size={16} className="today-streak-flame" />{_(msg({ id: 'today.streak.chip.ended', message: 'Streak ended' }))}</>
      : held > 0
        ? <><FreezeIcon size={14} className="today-streak-freeze" />{_({ ...msg({ id: 'today.streak.chip.freezes', message: '{count, plural, one {# streak freeze} other {# streak freezes}}' }), values: { count: held } })}</>
        : <><FlameIcon size={16} className="today-streak-flame" />{_({ ...msg({ id: 'today.streak.chip', message: '{count, plural, one {# study day} other {# study days}}' }), values: { count: length } })}</>;

  const eyebrow = runEnded
    ? <Trans {...msg({ id: 'today.streak.ended-eyebrow', message: '{count} → 0' })} values={{ count: previous }} />
    : state === 'milestone'
      ? length === 30
        ? <Trans {...msg({ id: 'today.streak.milestone.badge-eyebrow', message: 'Badge unlocked · Web Wanderer' })} />
        : <Trans {...msg({ id: 'today.streak.milestone.eyebrow', message: 'Streak milestone' })} />
      : <Trans {...msg({ id: 'today.streak.eyebrow', message: '{count}-day streak' })} values={{ count: length }} />;

  const title = runEnded
    ? <Trans {...msg({ id: 'today.streak.ended-title', message: 'Your {count}-day streak <0>ended.</0>' })} values={{ count: previous }} components={{ 0: em }} />
    : state === 'milestone'
      ? crystal
        ? <Trans {...msg({ id: 'today.streak.milestone.title.crystal', message: '{count} days <0>in a row!</0>' })} values={{ count: length }} components={{ 0: em }} />
        : <Trans {...msg({ id: 'today.streak.milestone.title', message: '{count} days <0>in a row.</0>' })} values={{ count: length }} components={{ 0: em }} />
      : studiedToday || state === 'frozen'
        ? <Trans {...msg({ id: 'today.streak.safe-title', message: 'Your streak <0>is safe.</0>' })} components={{ 0: em }} />
        : <Trans {...msg({ id: 'today.streak.open-title', message: 'Keep your streak <0>going.</0>' })} components={{ 0: em }} />;

  const description = state === 'ended'
    ? <Trans {...msg({ id: 'today.streak.ended-description', message: 'Start a new run today. Your XP and words are safe.' })} />
    : state === 'repair'
    ? crystal
      ? <Trans {...msg({ id: 'today.streak.repair-description.crystal', message: 'Life happens. You can still bring it back — repair it before the window closes, or simply start fresh today.' })} />
      : <Trans {...msg({ id: 'today.streak.repair-description', message: 'Life happens. You can still bring it back — repair it before the window closes, or simply start a new run today.' })} />
    : state === 'frozen'
      ? crystal
        ? <Trans {...msg({ id: 'today.streak.frozen-description.crystal', message: '{count, plural, one {You missed yesterday, so a streak freeze stepped in.} other {You missed the last # days, so # streak freezes stepped in.}} Study today and the streak keeps going.' })} values={{ count: view?.freezes.usingNow ?? 1 }} />
        : <Trans {...msg({ id: 'today.streak.frozen-description', message: '{count, plural, one {You missed yesterday, so a streak freeze stepped in.} other {You missed the last # days, so # streak freezes stepped in.}} Study today and the run keeps going.' })} values={{ count: view?.freezes.usingNow ?? 1 }} />
      : state === 'milestone'
        ? length === 30
          ? <Trans {...msg({ id: 'today.streak.milestone.month', message: 'A whole month of showing up. That is how words stick for good.' })} />
          : <Trans {...msg({ id: 'today.streak.milestone.description', message: '{count} days of showing up. That is how words stick for good.' })} values={{ count: length }} />
        : studiedToday
          ? <Trans {...msg({ id: 'today.streak.safe-description', message: 'You studied today, so your {count}-day streak keeps going. Come back tomorrow to make it {next}.' })} values={{ count: length, next: length + 1 }} />
          : <Trans {...msg({ id: 'today.streak.open-description', message: 'Study today to keep your {count}-day streak going.' })} values={{ count: length }} />;

  const note = state === 'repair'
    ? <Trans {...msg({ id: 'today.streak.repair.note', message: 'No penalty if you let it go.' })} />
    : milestoneXp
      ? <Trans {...msg({ id: 'today.streak.milestone.xp', message: '+{xp} XP added' })} values={{ xp: milestoneXp }} />
      : showFreezes
        ? <Trans {...msg({ id: 'today.streak.freezes.note', message: 'Freezes are used automatically.' })} />
        : <Trans {...msg({ id: 'today.streak.note', message: 'A day counts once you review a card.' })} />;

  // The board shows three run totals; a total the counters cannot cover gives its place to the next.
  const runTiles = state === 'milestone' && runStats ? [
    ...(runStats.reviews !== null ? [{ key: 'reviews', label: <Trans {...msg({ id: 'today.streak.stat.reviews', message: 'Reviews' })} />, value: number(runStats.reviews) }] : []),
    ...(runStats.newWords !== null ? [{ key: 'new-words', label: <Trans {...msg({ id: 'today.streak.stat.new-words', message: 'New words' })} />, value: number(runStats.newWords) }] : []),
    ...(runStats.recallPercent !== null ? [{ key: 'recall', label: <Trans {...msg({ id: 'today.streak.stat.recall', message: 'Recall' })} />, value: i18n.number(runStats.recallPercent / 100, { style: 'percent' }) }] : []),
    ...(runStats.xp !== null ? [{ key: 'xp', label: <Trans {...msg({ id: 'today.streak.stat.run-xp', message: 'XP' })} />, value: number(runStats.xp) }] : []),
  ].slice(0, 3) : null;
  const weekTiles = [
    ...(days ? [{ key: 'days', label: <Trans {...msg({ id: 'today.streak.stat.days', message: 'Study days this week' })} />, value: number(studyDays) }] : []),
    ...(weekXp !== null ? [{ key: 'xp', label: <Trans {...msg({ id: 'today.streak.stat.xp', message: 'XP this week' })} />, value: number(weekXp) }] : []),
    ...(view?.best ? [{ key: 'best', label: <Trans {...msg({ id: 'today.streak.stat.best', message: 'Best streak' })} />, value: _({ ...msg({ id: 'today.streak.stat.best-value', message: '{count, plural, one {# day} other {# days}}' }), values: { count: view.best.length } }) }] : []),
  ];
  const tiles = state === 'repair' || state === 'frozen' ? [] : runTiles ?? weekTiles;
  const primaryLabel = state === 'repair'
    ? view?.repair?.state === 'in-progress'
      ? <Trans {...msg({ id: 'today.streak.repair.continue', message: 'Keep repairing' })} />
      : <Trans {...msg({ id: 'today.streak.repair.start', message: 'Start a session' })} />
    : state === 'ended' && startsSession
      ? <Trans {...msg({ id: 'today.streak.repair.start', message: 'Start a session' })} />
      : state === 'milestone' || state === 'ended'
        ? <Trans {...msg({ id: 'today.streak.continue', message: 'Continue' })} />
        : <Trans {...msg({ id: 'today.streak.keep-going', message: 'Keep it going' })} />;

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button type="button" className={className} data-streak-chip={state}>{chip}</button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="streak-dialog-overlay" />
        <Dialog.Content className="streak-dialog" data-family={family} data-streak-state={state}>
          <span className="streak-dialog-rim" aria-hidden="true" />
          {state === 'milestone' && (
            <span className="streak-dialog-confetti" aria-hidden="true">
              {confetti.map((piece, index) => <span key={index} style={piece} />)}
            </span>
          )}
          <Dialog.Close className="streak-dialog-close" aria-label={_(msg({ id: 'today.streak.close', message: 'Close streak details' }))}>
            <X size={15} strokeWidth={2.2} aria-hidden="true" />
          </Dialog.Close>
          <div className="streak-dialog-head">
            <div className="streak-dialog-hero">
              {showLumi && <Lumi pose={lumiPose} size={140} className="streak-dialog-lumi" />}
              <span className="streak-dialog-emblem" aria-hidden="true">
                {crystal && state === 'milestone' ? (
                  <>
                    <svg className="streak-dialog-star" viewBox="0 0 100 100"><path d="M50 4 62 36 96 37 69 59 78 91 50 72 22 91 31 59 4 37 38 36Z" /></svg>
                    <span className="streak-dialog-star-count">{number(length)}</span>
                  </>
                ) : (
                  <span className="streak-dialog-emblem-face"><FlameIcon className="streak-dialog-emblem-flame" size={52} /></span>
                )}
                {state === 'frozen' && <span className="streak-dialog-badge"><FreezeIcon size={crystal ? 22 : 20} tips={!crystal} /></span>}
                {state === 'milestone' && !crystal && <span className="streak-dialog-gold-chip">{number(length)}</span>}
                {runEnded && crystal && (
                  <svg className="streak-dialog-crack" viewBox="0 0 150 168" preserveAspectRatio="none"><path d="M78 10 L66 60 L86 84 L62 118 L74 158" /></svg>
                )}
              </span>
            </div>
            <p className="streak-dialog-eyebrow">{eyebrow}</p>
            <Dialog.Title className="streak-dialog-title">{title}</Dialog.Title>
            <Dialog.Description className="streak-dialog-sub">{description}</Dialog.Description>
          </div>
          {(days || showFreezes || state === 'repair' || tiles.length > 0) && (
            <div className="streak-dialog-body">
              {days && <StudyWeek days={days} />}
              {view && showFreezes && <FreezeRow view={view} crystal={crystal} />}
              {view?.repair && (
                <>
                  <RepairTile repair={view.repair} />
                  <RepairWindow endsAt={view.repair.endsAt} now={now ?? new Date()} />
                </>
              )}
              {tiles.length > 0 && (
                <dl className="streak-dialog-stats" data-count={tiles.length}>
                  {tiles.map(tile => (
                    <div key={tile.key} data-stat={tile.key}>
                      <dt>{tile.label}</dt>
                      <dd>{tile.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}
          <footer className="streak-dialog-footer">
            <p>{note}</p>
            {state === 'repair' && (
              <Dialog.Close className="streak-dialog-secondary">
                <span><Trans {...msg({ id: 'today.streak.repair.start-fresh', message: 'Start fresh' })} /></span>
              </Dialog.Close>
            )}
            {startsSession ? (
              <Dialog.Close className="streak-dialog-primary" onClick={onStartSession}><span>{primaryLabel}</span></Dialog.Close>
            ) : state !== 'repair' ? (
              <Dialog.Close className="streak-dialog-primary"><span>{primaryLabel}</span></Dialog.Close>
            ) : null}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
