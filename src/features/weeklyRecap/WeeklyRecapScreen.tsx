import { Award, Download, Share2 } from 'lucide-react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { formatNumber } from '../../lib/format';
import { heatmapLevelForXp } from '../../components/stats/ActivityHeatmap';
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

function MiniHeatmap({ days }: { readonly days: WeeklyRecapData['days'] }) {
  const { i18n: activeI18n } = useLingui();
  return <div className="flex gap-1.5" role="img" aria-label={activeI18n._(msg({ id: 'weeklyRecap.heatmap.label', message: 'Daily XP for the last 7 days' }))}>
    {days.map(day => {
      const level = heatmapLevelForXp(day.xp);
      return <span key={day.dateKey} className="size-6 rounded-[4px] border border-[var(--sf-border)]" style={{ backgroundColor: `var(--sf-heat-${level})` }} title={`${day.dateKey}: ${formatNumber(day.xp)} XP`} />;
    })}
  </div>;
}

export function WeeklyRecapScreen({
  data, dateRangeLabel, selection, caption, milestones, isBusy, lastOutcome, exportError, actions,
}: WeeklyRecapScreenProps) {
  const { _ } = useLingui();
  const captionLength = caption.length;
  return <div className="weekly-recap-screen">
    <section className="weekly-recap-card">
      <header className="weekly-recap-card__header">
        <p className="premium-kicker uppercase tracking-[.16em]"><Trans id="weeklyRecap.kicker" message="Weekly recap" /></p>
        <p className="weekly-recap-card__range">{dateRangeLabel}</p>
      </header>

      {!data.hasActivity ? (
        <div className="weekly-recap-card__empty">
          <Trans id="weeklyRecap.empty" message="No study activity yet this week. Come back after a review to see your recap." />
        </div>
      ) : (
        <dl className="weekly-recap-card__metrics">
          {selection.totalXp && <div><dt><Trans id="weeklyRecap.metric.total-xp" message="XP this week" /></dt><dd>{formatNumber(data.totalXp)}</dd></div>}
          {selection.activeDays && <div><dt><Trans id="weeklyRecap.metric.active-days" message="Active days" /></dt><dd>{formatNumber(data.activeDays)} / {formatNumber(data.days.length)}</dd></div>}
          {selection.bestDay && <div><dt><Trans id="weeklyRecap.metric.best-day" message="Best day" /></dt><dd>{data.bestDay ? formatNumber(data.bestDay.xp) : '—'}</dd></div>}
        </dl>
      )}

      {selection.heatmap && <div className="weekly-recap-card__heatmap"><MiniHeatmap days={data.days} /></div>}
      {selection.milestones && <p className="weekly-recap-card__milestones"><Award size={16} aria-hidden="true" /><Trans id="weeklyRecap.milestones" message="{unlocked} of {total} milestones unlocked (all-time)" values={{ unlocked: milestones.unlocked, total: milestones.total }} /></p>}
    </section>

    <section className="weekly-recap-controls">
      <div className="weekly-recap-controls__unavailable">
        <Trans id="weeklyRecap.unavailable" message="Word of the week and recall rate need a reliable weekly data source we don't have yet, so they are left out rather than guessed." />
      </div>

      <fieldset className="weekly-recap-controls__selection">
        <legend><Trans id="weeklyRecap.selection.legend" message="Show on the card" /></legend>
        <div>{WEEKLY_RECAP_SELECTION_KEYS.map(key => <label key={key}>
          <input type="checkbox" checked={selection[key]} onChange={() => actions.toggleSelection(key)} data-selection-key={key} />
          {_(selectionCopy[key])}
        </label>)}</div>
      </fieldset>

      <label className="weekly-recap-controls__caption" htmlFor="weekly-recap-caption">
        <Trans id="weeklyRecap.caption.label" message="Caption" />
        <textarea id="weekly-recap-caption" value={caption} maxLength={WEEKLY_RECAP_CAPTION_MAX_LENGTH} onChange={event => actions.setCaption(event.target.value)} rows={3} className="glass-field" />
        <span>{captionLength} / {WEEKLY_RECAP_CAPTION_MAX_LENGTH}</span>
      </label>

      <p className="weekly-recap-controls__privacy"><Trans id="weeklyRecap.privacy" message="Only what's toggled above appears in the shared image. Private words are never included automatically." /></p>
      {lastOutcome && !exportError && <p role="status" aria-live="polite" className="weekly-recap-controls__outcome">{_(outcomeCopy[lastOutcome])}</p>}
      {exportError && <p role="alert" className="weekly-recap-controls__error"><Trans id="weeklyRecap.export-error" message="Could not create the image. Please try again." /></p>}

      <div className="weekly-recap-controls__actions">
        <button type="button" onClick={actions.share} disabled={isBusy} className="brand-action"><Share2 size={16} aria-hidden="true" /><Trans id="weeklyRecap.action.share" message="Share" /></button>
        <button type="button" onClick={actions.download} disabled={isBusy}><Download size={16} aria-hidden="true" /><Trans id="weeklyRecap.action.download" message="Download PNG" /></button>
      </div>
    </section>
  </div>;
}
