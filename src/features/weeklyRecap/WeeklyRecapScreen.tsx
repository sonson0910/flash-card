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
  return <div className="space-y-6">
    <header>
      <p className="premium-kicker uppercase tracking-[.16em]"><Trans id="weeklyRecap.kicker" message="Weekly recap" /></p>
      <p className="mt-1 text-lg font-black tracking-tight">{dateRangeLabel}</p>
    </header>

    {!data.hasActivity ? (
      <div className="rounded-2xl border border-dashed border-[var(--sf-border)] bg-[var(--sf-surface)] p-5 text-sm text-[var(--sf-text-muted)]">
        <Trans id="weeklyRecap.empty" message="No study activity yet this week. Come back after a review to see your recap." />
      </div>
    ) : (
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {selection.totalXp && <div className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4"><dt className="text-xs font-black uppercase tracking-[.12em] text-[var(--sf-text-muted)]"><Trans id="weeklyRecap.metric.total-xp" message="XP this week" /></dt><dd className="mt-2 text-2xl font-black tabular-nums">{formatNumber(data.totalXp)}</dd></div>}
        {selection.activeDays && <div className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4"><dt className="text-xs font-black uppercase tracking-[.12em] text-[var(--sf-text-muted)]"><Trans id="weeklyRecap.metric.active-days" message="Active days" /></dt><dd className="mt-2 text-2xl font-black tabular-nums">{formatNumber(data.activeDays)} / {formatNumber(data.days.length)}</dd></div>}
        {selection.bestDay && <div className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4"><dt className="text-xs font-black uppercase tracking-[.12em] text-[var(--sf-text-muted)]"><Trans id="weeklyRecap.metric.best-day" message="Best day" /></dt><dd className="mt-2 text-2xl font-black tabular-nums">{data.bestDay ? formatNumber(data.bestDay.xp) : '—'}</dd></div>}
      </dl>
    )}

    {selection.heatmap && <MiniHeatmap days={data.days} />}

    {selection.milestones && <p className="flex items-center gap-2 text-sm font-bold text-[var(--sf-text)]"><Award size={16} className="text-[var(--sf-brand-text)]" aria-hidden="true" /><Trans id="weeklyRecap.milestones" message="{unlocked} of {total} milestones unlocked (all-time)" values={{ unlocked: milestones.unlocked, total: milestones.total }} /></p>}

    <div className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] p-4 text-sm text-[var(--sf-text-muted)]">
      <Trans id="weeklyRecap.unavailable" message="Word of the week and recall rate need a reliable weekly data source we don't have yet, so they are left out rather than guessed." />
    </div>

    <fieldset className="space-y-2">
      <legend className="text-xs font-black uppercase tracking-[.12em] text-[var(--sf-text-muted)]"><Trans id="weeklyRecap.selection.legend" message="Show on the card" /></legend>
      {WEEKLY_RECAP_SELECTION_KEYS.map(key => <label key={key} className="flex min-h-11 items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={selection[key]} onChange={() => actions.toggleSelection(key)} data-selection-key={key} className="size-4 accent-[var(--sf-brand)]" />
        {_(selectionCopy[key])}
      </label>)}
    </fieldset>

    <label className="block text-sm font-bold" htmlFor="weekly-recap-caption">
      <Trans id="weeklyRecap.caption.label" message="Caption" />
      <textarea
        id="weekly-recap-caption"
        value={caption}
        maxLength={WEEKLY_RECAP_CAPTION_MAX_LENGTH}
        onChange={event => actions.setCaption(event.target.value)}
        rows={3}
        className="glass-field mt-2 w-full rounded-xl p-3 text-sm font-medium focus-visible:outline-2"
      />
      <span className="mt-1 block text-right text-xs text-[var(--sf-text-muted)] tabular-nums">{captionLength} / {WEEKLY_RECAP_CAPTION_MAX_LENGTH}</span>
    </label>

    <p className="text-xs text-[var(--sf-text-muted)]"><Trans id="weeklyRecap.privacy" message="Only what's toggled above appears in the shared image. Private words are never included automatically." /></p>

    {lastOutcome && !exportError && <p role="status" aria-live="polite" className="text-sm font-semibold text-[var(--sf-brand-text)]">{_(outcomeCopy[lastOutcome])}</p>}
    {exportError && <p role="alert" className="text-sm font-semibold text-[var(--sf-danger)]"><Trans id="weeklyRecap.export-error" message="Could not create the image. Please try again." /></p>}

    <div className="flex flex-wrap gap-3">
      <button type="button" onClick={actions.share} disabled={isBusy} className="brand-action min-h-11 inline-flex items-center gap-2 rounded-full bg-[var(--sf-brand)] px-5 py-2.5 text-sm font-extrabold text-[var(--sf-on-brand)] disabled:opacity-60"><Share2 size={16} aria-hidden="true" /><Trans id="weeklyRecap.action.share" message="Share" /></button>
      <button type="button" onClick={actions.download} disabled={isBusy} className="min-h-11 inline-flex items-center gap-2 rounded-full border border-[var(--sf-border)] px-5 py-2.5 text-sm font-bold disabled:opacity-60"><Download size={16} aria-hidden="true" /><Trans id="weeklyRecap.action.download" message="Download PNG" /></button>
    </div>
  </div>;
}
