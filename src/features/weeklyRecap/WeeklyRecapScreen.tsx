import { Award, Download, Share2 } from 'lucide-react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import type { ReactNode } from 'react';
import { Lumi } from '../../components/lumi/Lumi';
import { formatNumber } from '../../lib/format';
import { heatmapLevelForXp } from '../../components/stats/ActivityHeatmap';
import { readLumiEnabled } from '../settings/lumi-preference';
import { useTheme } from '../theme/ThemeProvider';
import type { WeeklyRecapData } from './weeklyRecapModel';
import {
  WEEKLY_RECAP_CAPTION_MAX_LENGTH,
  WEEKLY_RECAP_SELECTION_KEYS,
  type WeeklyRecapSelection,
  type WeeklyRecapSelectionKey,
} from './weeklyRecapSelection';
import type { WeeklyRecapShareOutcome } from './weeklyRecapShare';

export interface WeeklyRecapMilestones {
  readonly unlocked: number;
  readonly total: number;
}

export interface WeeklyRecapScreenActions {
  toggleSelection(key: WeeklyRecapSelectionKey): void;
  setCaption(value: string): void;
  share(): void;
  download(): void;
}

export interface WeeklyRecapScreenProps {
  readonly data: WeeklyRecapData;
  readonly dateRangeLabel: string;
  readonly selection: WeeklyRecapSelection;
  readonly caption: string;
  readonly milestones: WeeklyRecapMilestones;
  readonly isBusy: boolean;
  readonly lastOutcome: WeeklyRecapShareOutcome | null;
  readonly exportError: boolean;
  readonly actions: WeeklyRecapScreenActions;
}

const selectionCopy: Record<WeeklyRecapSelectionKey, ReturnType<typeof msg>> = {
  totalXp: msg({ id: 'weeklyRecap.toggle.total-xp', message: 'Total XP' }),
  reviewed: msg({ id: 'weeklyRecap.toggle.reviews', message: 'Reviews this week' }),
  activeDays: msg({ id: 'weeklyRecap.toggle.active-days', message: 'Active days' }),
  bestDay: msg({ id: 'weeklyRecap.toggle.best-day', message: 'Best day' }),
  heatmap: msg({ id: 'weeklyRecap.toggle.heatmap', message: 'Day-by-day heatmap' }),
  milestones: msg({ id: 'weeklyRecap.toggle.milestones', message: 'Milestones unlocked' }),
};

const outcomeCopy: Record<WeeklyRecapShareOutcome, ReturnType<typeof msg>> = {
  shared: msg({ id: 'weeklyRecap.outcome.shared', message: 'Shared.' }),
  copied: msg({ id: 'weeklyRecap.outcome.copied', message: 'Copied to your clipboard.' }),
  downloaded: msg({ id: 'weeklyRecap.outcome.downloaded', message: 'Downloaded.' }),
  failed: msg({ id: 'weeklyRecap.outcome.failed', message: 'Sharing was cancelled.' }),
};

export const weeklyRecapCopy = {
  weeklyRecap: msg({ id: 'weeklyRecap.kicker', message: 'Weekly recap' }),
  title: msg({ id: 'weeklyRecap.dialog.title', message: 'Your weekly recap' }),
  xpThisWeek: msg({ id: 'weeklyRecap.metric.total-xp', message: 'XP this week' }),
  reviewsThisWeek: msg({ id: 'weeklyRecap.metric.reviews', message: 'Reviews this week' }),
  noStudyActivity: msg({ id: 'weeklyRecap.empty', message: 'No study activity yet this week. Come back after a review to see your recap.' }),
  activeDays: msg({ id: 'weeklyRecap.metric.active-days', message: 'Active days' }),
  bestDay: msg({ id: 'weeklyRecap.metric.best-day', message: 'Best day' }),
  dailyXp: msg({ id: 'weeklyRecap.heatmap.label', message: 'Daily XP for the last 7 days' }),
  milestones: msg({ id: 'weeklyRecap.milestones', message: '{unlocked} of {total} milestones unlocked (all-time)' }),
  privacy: msg({ id: 'weeklyRecap.privacy', message: 'The image includes the selected metrics and your caption. Private words are never added automatically.' }),
};

const metric = (label: string, value: ReactNode) => <div><dt>{label}</dt><dd>{value}</dd></div>;

function MiniHeatmap({ days }: { readonly days: WeeklyRecapData['days'] }) {
  const { i18n: activeI18n } = useLingui();
  const locale = activeI18n.locale === 'pseudo' ? 'en' : activeI18n.locale || 'en';
  const weekdayFormatter = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  return <div className="weekly-recap-card__heatmap-grid" role="list" aria-label={activeI18n._(weeklyRecapCopy.dailyXp)}>
    {days.map(day => {
      const weekday = weekdayFormatter.format(new Date(`${day.dateKey}T12:00:00`));
      return <div key={day.dateKey} role="listitem" className="weekly-recap-card__heatmap-day">
        <span role="img" className="weekly-recap-card__heatmap-cell" style={{ backgroundColor: `var(--weekly-recap-heat-${heatmapLevelForXp(day.xp)})` }} title={`${day.dateKey}: ${formatNumber(day.xp)} XP`} aria-label={`${weekday}, ${day.dateKey}: ${formatNumber(day.xp)} XP`} />
        <small aria-hidden="true">{weekday.slice(0, 2)}</small>
      </div>;
    })}
  </div>;
}

export function WeeklyRecapScreen({
  data, dateRangeLabel, selection, caption, milestones, isBusy, lastOutcome, exportError, actions,
}: WeeklyRecapScreenProps) {
  const { _ } = useLingui();
  const isCrystal = useTheme().family === 'crystal';
  const showLumi = isCrystal && readLumiEnabled();
  const visibleCaption = caption.trim();
  const reviewedCount = data.reviewedCount ?? null;
  const hasXp = data.totalXp > 0;
  const selectionKeys = WEEKLY_RECAP_SELECTION_KEYS.filter(key =>
    (key !== 'reviewed' || reviewedCount !== null)
    && (hasXp || key === 'reviewed' || key === 'milestones'),
  );
  const bestDayLabel = data.bestDay
    ? `${data.bestDay.dateKey} · ${formatNumber(data.bestDay.xp)} XP`
    : '—';
  return <div className="weekly-recap-screen">
    <section className={`weekly-recap-card${isCrystal ? ' weekly-recap-card--crystal' : ''}${showLumi ? ' weekly-recap-card--with-companion' : ''}`} aria-label={_(weeklyRecapCopy.title)}>
      {isCrystal && <span className="weekly-recap-card__stack" aria-hidden="true" />}
      {showLumi && <Lumi pose="proud" size={104} className="weekly-recap-card__companion" />}
      <header className="weekly-recap-card__header">
        <div className="weekly-recap-card__brand-line">
          <span className="weekly-recap-card__brand-mark" aria-hidden="true">S</span>
          <p className="premium-kicker uppercase tracking-[.16em]">{_(weeklyRecapCopy.weeklyRecap)}</p>
        </div>
        <p className="weekly-recap-card__range">{dateRangeLabel}</p>
      </header>

      {!data.hasActivity ? (
        <div className="weekly-recap-card__empty">
          {_(weeklyRecapCopy.noStudyActivity)}
          {selection.reviewed && reviewedCount !== null && <dl className="weekly-recap-card__metrics">{metric(_(weeklyRecapCopy.reviewsThisWeek), formatNumber(reviewedCount))}</dl>}
        </div>
      ) : (
        <>
          {selection.totalXp && hasXp && <div className="weekly-recap-card__hero-metric">
            <strong>{formatNumber(data.totalXp)}</strong>
            <span>{_(weeklyRecapCopy.xpThisWeek)}</span>
          </div>}
          <dl className="weekly-recap-card__metrics">
            {selection.reviewed && reviewedCount !== null && metric(_(weeklyRecapCopy.reviewsThisWeek), formatNumber(reviewedCount))}
            {selection.activeDays && hasXp && metric(_(weeklyRecapCopy.activeDays), <>{formatNumber(data.activeDays)} / {formatNumber(data.days.length)}</>)}
            {selection.bestDay && hasXp && metric(_(weeklyRecapCopy.bestDay), bestDayLabel)}
          </dl>
        </>
      )}

      {selection.heatmap && hasXp && <div className="weekly-recap-card__heatmap"><MiniHeatmap days={data.days} /></div>}
      {visibleCaption && <p className="weekly-recap-card__range">{visibleCaption}</p>}
      {selection.milestones && <p className="weekly-recap-card__milestones"><span className="weekly-recap-card__garden" aria-hidden="true"><i /><i /><i /></span><Award size={16} aria-hidden="true" /><Trans id="weeklyRecap.milestones" message="{unlocked} of {total} milestones unlocked (all-time)" values={{ unlocked: milestones.unlocked, total: milestones.total }} /></p>}
    </section>

    <section className="weekly-recap-controls">
      <header className="weekly-recap-controls__intro">
        <p className="premium-kicker uppercase tracking-[.16em]">{_(weeklyRecapCopy.weeklyRecap)}</p>
        <h1>{_(weeklyRecapCopy.title)}</h1>
        <p className="weekly-recap-controls__date">{dateRangeLabel}</p>
      </header>
      <div className="weekly-recap-controls__unavailable">
        <Trans id="weeklyRecap.unavailable" message="Word of the week, words learned, recall rate, study time, and streak need a reliable weekly data source we don't have yet, so they are left out rather than guessed." />
        {reviewedCount === null && <p><Trans id="weeklyRecap.reviews-unavailable" message="Reviews this week are unavailable until activity covers all seven days." /></p>}
      </div>

      <fieldset className="weekly-recap-controls__selection">
        <legend><Trans id="weeklyRecap.selection.legend" message="Show on the card" /></legend>
        <div>{selectionKeys.map(key => <label key={key} className={selection[key] ? 'is-selected' : undefined}>
          <input type="checkbox" checked={selection[key]} onChange={() => actions.toggleSelection(key)} data-selection-key={key} />
          {_(selectionCopy[key])}
        </label>)}</div>
      </fieldset>

      <label className="weekly-recap-controls__caption" htmlFor="weekly-recap-caption">
        <Trans id="weeklyRecap.caption.label" message="Caption" />
        <textarea id="weekly-recap-caption" value={caption} maxLength={WEEKLY_RECAP_CAPTION_MAX_LENGTH} onChange={event => actions.setCaption(event.target.value)} rows={3} className="glass-field" />
        <span>{caption.length} / {WEEKLY_RECAP_CAPTION_MAX_LENGTH}</span>
      </label>

      <p className="weekly-recap-controls__privacy">{_(weeklyRecapCopy.privacy)}</p>
      {lastOutcome && !exportError && <p role="status" aria-live="polite" className="weekly-recap-controls__outcome">{_(outcomeCopy[lastOutcome])}</p>}
      {exportError && <p role="alert" className="weekly-recap-controls__error"><Trans id="weeklyRecap.export-error" message="Could not create the image. Please try again." /></p>}

      <div className="weekly-recap-controls__actions">
        <button type="button" onClick={actions.share} disabled={isBusy} className="brand-action"><Share2 size={16} aria-hidden="true" /><Trans id="weeklyRecap.action.share" message="Share" /></button>
        <button type="button" onClick={actions.download} disabled={isBusy}><Download size={16} aria-hidden="true" /><Trans id="weeklyRecap.action.download" message="Download PNG" /></button>
      </div>
    </section>
  </div>;
}
