import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { X } from 'lucide-react';
import { computeAchievementBadgeStats } from '../../components/stats/AchievementsMatrix';
import type { LibraryStatsViewModel } from '../library/libraryViewModel';
import type { WeeklyRecapExportCopy } from './weeklyRecapExport';
import { computeWeeklyRecap } from './weeklyRecapModel';
import {
  buildSuggestedWeeklyRecapCaption,
  captionAfterWeeklyRecapSelectionChange,
  clampWeeklyRecapCaption,
  defaultWeeklyRecapSelection,
  toggleWeeklyRecapSelection,
  type WeeklyRecapSelectionKey,
} from './weeklyRecapSelection';
import { resolveWeeklyRecapExportTheme } from './weeklyRecapTheme';
import { downloadWeeklyRecapPng, shareWeeklyRecapPng, type WeeklyRecapShareOutcome } from './weeklyRecapShare';
import { WeeklyRecapScreen, weeklyRecapCopy } from './WeeklyRecapScreen';
import './weekly-recap-dialog.css';

export interface WeeklyRecapDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly stats: LibraryStatsViewModel;
  readonly showingSavedStats?: boolean;
  /** Injectable for deterministic tests; defaults to the real clock. */
  readonly now?: () => Date;
}

const localDateFromKey = (dateKey: string): Date => new Date(`${dateKey}T12:00:00`);

export default function WeeklyRecapDialog({ open, onOpenChange, stats, showingSavedStats = false, now = () => new Date() }: WeeklyRecapDialogProps) {
  const { _, i18n: activeI18n } = useLingui();
  const data = useMemo(
    () => computeWeeklyRecap(stats.xpChartData, now(), stats.reviewActivity, stats.rewardTimeZone),
    [stats.xpChartData, stats.reviewActivity, stats.rewardTimeZone, now],
  );
  const milestones = useMemo(() => {
    const badgeStats = computeAchievementBadgeStats(stats);
    return { unlocked: badgeStats.filter(badge => badge.unlocked).length, total: badgeStats.length };
  }, [stats]);

  const [selection, setSelection] = useState(defaultWeeklyRecapSelection);
  const [caption, setCaption] = useState(() => buildSuggestedWeeklyRecapCaption(data, selection));
  const captionCustomized = useRef(false);
  const [isBusy, setIsBusy] = useState(false);
  const [exportResult, setExportResult] = useState<WeeklyRecapShareOutcome | 'error' | null>(null);
  const openRecapRange = useRef<string | null>(null);
  const exportGeneration = useRef(0);

  useLayoutEffect(() => () => { exportGeneration.current += 1; }, []);

  useEffect(() => {
    if (!open) {
      openRecapRange.current = null;
      exportGeneration.current += 1;
      setIsBusy(false);
      return;
    }
    const range = `${data.rangeStart}:${data.rangeEnd}`;
    const resetRecap = openRecapRange.current !== range;
    openRecapRange.current = range;
    if (resetRecap) {
      setSelection(defaultWeeklyRecapSelection);
      captionCustomized.current = false;
      setCaption(buildSuggestedWeeklyRecapCaption(data, defaultWeeklyRecapSelection()));
    } else if (!captionCustomized.current) {
      setCaption(buildSuggestedWeeklyRecapCaption(data, selection));
    }
    if (resetRecap) {
      exportGeneration.current += 1;
      setIsBusy(false);
      setExportResult(null);
    }
    // A new opening or week resets the recap; same-week refreshes only update an untouched suggestion.
  }, [open, data.rangeStart, data.rangeEnd, data.totalXp, data.activeDays, data.reviewedCount]);

  const locale = activeI18n.locale || 'en';
  const dateFormatter = new Intl.DateTimeFormat(locale === 'pseudo' ? 'en' : locale, { month: 'short', day: 'numeric' });
  const dateRangeLabel = `${dateFormatter.format(localDateFromKey(data.rangeStart))} – ${dateFormatter.format(localDateFromKey(data.rangeEnd))}`;
  const filename = `sonflash-weekly-recap-${data.rangeStart}-to-${data.rangeEnd}.png`;
  const exportCopy: WeeklyRecapExportCopy = {
    weeklyRecap: _(weeklyRecapCopy.weeklyRecap),
    xpThisWeek: _(weeklyRecapCopy.xpThisWeek),
    reviewsThisWeek: _(weeklyRecapCopy.reviewsThisWeek),
    noStudyActivity: _(weeklyRecapCopy.noStudyActivity),
    activeDays: _(weeklyRecapCopy.activeDays),
    bestDay: _(weeklyRecapCopy.bestDay),
    dailyXp: _(weeklyRecapCopy.dailyXp),
    milestones: (unlocked, total) => activeI18n._(weeklyRecapCopy.milestones.id, { unlocked, total }),
    privacy: _(weeklyRecapCopy.privacy),
  };

  const renderBlob = async (): Promise<Blob> => {
    const { renderWeeklyRecapPng } = await import('./weeklyRecapExport');
    return renderWeeklyRecapPng({
      data,
      selection,
      caption: clampWeeklyRecapCaption(caption),
      milestones,
      dateRangeLabel,
      locale,
      copy: exportCopy,
      theme: resolveWeeklyRecapExportTheme(),
    });
  };

  const runExport = async (deliver: (blob: Blob) => Promise<WeeklyRecapShareOutcome>) => {
    if (isBusy) return;
    const generation = ++exportGeneration.current;
    setIsBusy(true);
    setExportResult(null);
    try {
      const blob = await renderBlob();
      if (generation !== exportGeneration.current) return;
      const result = await deliver(blob);
      if (generation === exportGeneration.current) setExportResult(result);
    } catch {
      if (generation === exportGeneration.current) setExportResult('error');
    } finally {
      if (generation === exportGeneration.current) setIsBusy(false);
    }
  };

  const actions = {
    toggleSelection: (key: WeeklyRecapSelectionKey) => {
      const nextSelection = toggleWeeklyRecapSelection(selection, key);
      setSelection(nextSelection);
      setCaption(captionAfterWeeklyRecapSelectionChange(data, nextSelection, caption, captionCustomized.current));
    },
    setCaption: (value: string) => {
      setCaption(clampWeeklyRecapCaption(value));
      captionCustomized.current = true;
    },
    share: () => { void runExport(blob => shareWeeklyRecapPng(blob, filename, caption)); },
    download: () => { void runExport(blob => downloadWeeklyRecapPng(blob, filename)); },
  };

  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="weekly-recap-dialog-overlay" />
      <Dialog.Content className="weekly-recap-dialog crystal-chamfer">
        <div className="weekly-recap-dialog__header">
          <Dialog.Title className="weekly-recap-dialog__title"><Trans id="weeklyRecap.dialog.title" message="Your weekly recap" /></Dialog.Title>
          <Dialog.Close aria-label={_(msg({ id: 'weeklyRecap.dialog.close', message: 'Close' }))} className="weekly-recap-dialog__close liquid-control"><X size={18} /></Dialog.Close>
        </div>
        <div className="weekly-recap-dialog__body">
          {showingSavedStats && <p role="status" className="mb-3 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-3 text-sm text-[var(--sf-text-muted)]"><Trans id="weeklyRecap.saved-warning" message="Showing saved recap. Recent reviews may not be included." /></p>}
          <WeeklyRecapScreen
            data={data}
            dateRangeLabel={dateRangeLabel}
            selection={selection}
            caption={caption}
            milestones={milestones}
            isBusy={isBusy}
            lastOutcome={exportResult === 'error' ? null : exportResult}
            exportError={exportResult === 'error'}
            actions={actions}
          />
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
