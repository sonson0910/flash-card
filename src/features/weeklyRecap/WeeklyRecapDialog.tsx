import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useMemo, useState } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { X } from 'lucide-react';
import { computeAchievementBadgeStats } from '../../components/stats/AchievementsMatrix';
import type { LibraryStatsViewModel } from '../library/libraryViewModel';
import { computeWeeklyRecap } from './weeklyRecapModel';
import {
  buildSuggestedWeeklyRecapCaption,
  clampWeeklyRecapCaption,
  defaultWeeklyRecapSelection,
  toggleWeeklyRecapSelection,
  type WeeklyRecapSelectionKey,
} from './weeklyRecapSelection';
import { resolveWeeklyRecapExportTheme } from './weeklyRecapTheme';
import { downloadWeeklyRecapPng, shareWeeklyRecapPng, type WeeklyRecapShareOutcome } from './weeklyRecapShare';
import { WeeklyRecapScreen } from './WeeklyRecapScreen';
import './weekly-recap-dialog.css';

export interface WeeklyRecapDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly stats: LibraryStatsViewModel;
  /** Injectable for deterministic tests; defaults to the real clock. */
  readonly now?: () => Date;
}

const localDateFromKey = (dateKey: string): Date => new Date(`${dateKey}T12:00:00`);

export default function WeeklyRecapDialog({ open, onOpenChange, stats, now = () => new Date() }: WeeklyRecapDialogProps) {
  const { _, i18n: activeI18n } = useLingui();
  const data = useMemo(() => computeWeeklyRecap(stats.xpChartData, now()), [stats.xpChartData, now]);
  const milestones = useMemo(() => {
    const badgeStats = computeAchievementBadgeStats(stats);
    return { unlocked: badgeStats.filter(badge => badge.unlocked).length, total: badgeStats.length };
  }, [stats]);

  const [selection, setSelection] = useState(defaultWeeklyRecapSelection);
  const [caption, setCaption] = useState(() => buildSuggestedWeeklyRecapCaption(data));
  const [isBusy, setIsBusy] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<WeeklyRecapShareOutcome | null>(null);
  const [exportError, setExportError] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCaption(buildSuggestedWeeklyRecapCaption(data));
    setLastOutcome(null);
    setExportError(false);
    // Reset only when the recap opens or the underlying week changes identity, not on every caption keystroke.
  }, [open, data.rangeStart, data.rangeEnd, data.totalXp, data.activeDays]);

  const locale = activeI18n.locale || 'en';
  const dateFormatter = new Intl.DateTimeFormat(locale === 'pseudo' ? 'en' : locale, { month: 'short', day: 'numeric' });
  const dateRangeLabel = `${dateFormatter.format(localDateFromKey(data.rangeStart))} – ${dateFormatter.format(localDateFromKey(data.rangeEnd))}`;
  const filename = `sonflash-weekly-recap-${data.rangeStart}-to-${data.rangeEnd}.png`;

  const renderBlob = async (): Promise<Blob> => {
    const { renderWeeklyRecapPng } = await import('./weeklyRecapExport');
    return renderWeeklyRecapPng({
      data,
      selection,
      caption: clampWeeklyRecapCaption(caption),
      milestones,
      dateRangeLabel,
      theme: resolveWeeklyRecapExportTheme(),
    });
  };

  const runExport = async (deliver: (blob: Blob) => Promise<WeeklyRecapShareOutcome>) => {
    if (isBusy) return;
    setIsBusy(true);
    setExportError(false);
    try {
      const blob = await renderBlob();
      setLastOutcome(await deliver(blob));
    } catch {
      setExportError(true);
      setLastOutcome(null);
    } finally {
      setIsBusy(false);
    }
  };

  const actions = {
    toggleSelection: (key: WeeklyRecapSelectionKey) => setSelection(current => toggleWeeklyRecapSelection(current, key)),
    setCaption: (value: string) => setCaption(clampWeeklyRecapCaption(value)),
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
          <WeeklyRecapScreen
            data={data}
            dateRangeLabel={dateRangeLabel}
            selection={selection}
            caption={caption}
            milestones={milestones}
            isBusy={isBusy}
            lastOutcome={lastOutcome}
            exportError={exportError}
            actions={actions}
          />
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
