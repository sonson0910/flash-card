import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import * as Dialog from '@radix-ui/react-dialog';
import { Flame, X } from 'lucide-react';
import { Lumi } from '../../components/lumi/Lumi';
import { useTheme } from '../theme/ThemeProvider';
import { readLumiEnabled } from '../settings/lumi-preference';
import type { StudyRun, StudyWeekDay } from './todayScreenFacts';
import './streak-dialog.css';

interface StreakChipProps {
  /** Consecutive study days; the chip is hidden below one. */
  readonly streak: number | undefined;
  readonly run?: StudyRun;
  readonly week?: readonly StudyWeekDay[];
  readonly className: string;
}

const weekdayFormat = (locale: string, weekday: 'short' | 'long') => {
  try {
    return new Intl.DateTimeFormat(locale, { weekday, timeZone: 'UTC' });
  } catch {
    return new Intl.DateTimeFormat('en', { weekday, timeZone: 'UTC' });
  }
};

const dayDate = (isoDay: string) => new Date(`${isoDay}T12:00:00.000Z`);

function DayMark({ state }: { readonly state: StudyWeekDay['state'] }) {
  if (state === 'done') return <Flame size={17} fill="currentColor" strokeWidth={0} aria-hidden="true" />;
  if (state === 'missed') return <X size={15} strokeWidth={2.4} aria-hidden="true" />;
  return <span className="streak-dialog-dot" aria-hidden="true" />;
}

function StudyWeek({ week }: { readonly week: readonly StudyWeekDay[] }) {
  const { _, i18n } = useLingui();
  const short = weekdayFormat(i18n.locale, 'short');
  const long = weekdayFormat(i18n.locale, 'long');
  const stateLabel = (day: StudyWeekDay) => {
    if (day.state === 'done') return _(msg({ id: 'today.streak.day.done', message: 'studied' }));
    if (day.state === 'missed') return _(msg({ id: 'today.streak.day.missed', message: 'no study' }));
    if (day.state === 'today') return _(msg({ id: 'today.streak.day.today', message: 'today, not studied yet' }));
    return _(msg({ id: 'today.streak.day.future', message: 'still ahead' }));
  };
  return (
    <ol className="streak-dialog-week" aria-label={_(msg({ id: 'today.streak.week', message: 'This week' }))}>
      {week.map(day => (
        <li key={day.date} data-state={day.state} data-today={day.isToday || undefined} aria-current={day.isToday ? 'date' : undefined} aria-label={`${long.format(dayDate(day.date))}: ${stateLabel(day)}`}>
          <span className="streak-dialog-day-label" aria-hidden="true">{short.format(dayDate(day.date))}</span>
          <span className="streak-dialog-day-mark" aria-hidden="true"><DayMark state={day.state} /></span>
        </li>
      ))}
    </ol>
  );
}

/** The streak chip and its details dialog, built only from the verified streak and XP history. */
export function StreakChip({ streak, run, week, className }: StreakChipProps) {
  const { _, i18n } = useLingui();
  const { family } = useTheme();
  if (streak === undefined || streak < 1) return null;
  const crystal = family === 'crystal';
  const showLumi = crystal && readLumiEnabled();
  const studiedToday = run?.studiedToday ?? true;
  const studyDays = week?.filter(day => day.state === 'done').length ?? 0;
  const weekXp = week?.reduce((total, day) => total + day.xp, 0) ?? 0;
  const number = (value: number) => i18n.number(value);

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button type="button" className={className}>
          <Flame size={16} className="today-streak-flame" aria-hidden="true" />
          {_({ ...msg({ id: 'today.streak.chip', message: '{count, plural, one {# study day} other {# study days}}' }), values: { count: streak } })}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="streak-dialog-overlay" />
        <Dialog.Content className="streak-dialog">
          <span className="streak-dialog-rim" aria-hidden="true" />
          <Dialog.Close className="streak-dialog-close" aria-label={_(msg({ id: 'today.streak.close', message: 'Close streak details' }))}>
            <X size={15} strokeWidth={2.2} aria-hidden="true" />
          </Dialog.Close>
          <div className="streak-dialog-head">
            <div className="streak-dialog-hero">
              {showLumi && <Lumi pose="hint" size={140} className="streak-dialog-lumi" />}
              <span className="streak-dialog-emblem" aria-hidden="true">
                <span className="streak-dialog-emblem-face"><Flame className="streak-dialog-emblem-flame" size={52} fill="currentColor" strokeWidth={0} /></span>
              </span>
            </div>
            <p className="streak-dialog-eyebrow"><Trans {...msg({ id: 'today.streak.eyebrow', message: '{count}-day streak' })} values={{ count: streak }} /></p>
            <Dialog.Title className="streak-dialog-title">
              {studiedToday
                ? <Trans {...msg({ id: 'today.streak.safe-title', message: 'Your streak <0>is safe.</0>' })} components={{ 0: <em /> }} />
                : <Trans {...msg({ id: 'today.streak.open-title', message: 'Keep your streak <0>going.</0>' })} components={{ 0: <em /> }} />}
            </Dialog.Title>
            <Dialog.Description className="streak-dialog-sub">
              {studiedToday
                ? <Trans {...msg({ id: 'today.streak.safe-description', message: 'You studied today, so your {count}-day streak keeps going. Come back tomorrow to make it {next}.' })} values={{ count: streak, next: streak + 1 }} />
                : <Trans {...msg({ id: 'today.streak.open-description', message: 'Study today to keep your {count}-day streak going.' })} values={{ count: streak }} />}
            </Dialog.Description>
          </div>
          {week && week.length === 7 && (
            <div className="streak-dialog-body">
              <StudyWeek week={week} />
              <dl className="streak-dialog-stats">
                <div>
                  <dt><Trans {...msg({ id: 'today.streak.stat.days', message: 'Study days this week' })} /></dt>
                  <dd>{number(studyDays)}</dd>
                </div>
                <div>
                  <dt><Trans {...msg({ id: 'today.streak.stat.xp', message: 'XP this week' })} /></dt>
                  <dd>{number(weekXp)}</dd>
                </div>
              </dl>
            </div>
          )}
          <footer className="streak-dialog-footer">
            <p><Trans {...msg({ id: 'today.streak.note', message: 'A day counts once you earn XP.' })} /></p>
            <Dialog.Close className="streak-dialog-primary">
              <span><Trans {...msg({ id: 'today.streak.keep-going', message: 'Keep it going' })} /></span>
            </Dialog.Close>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
