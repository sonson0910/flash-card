import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { X } from 'lucide-react';
import { useVerifiedStats } from '../../components/stats/VerifiedStatsContext';
import type { LibraryStatsViewModel } from '../library/libraryViewModel';
import {
  availableWeeklyRecapSelectionKeys,
  buildWeeklyRecapCardContent,
  weeklyRecapRangeLabel,
  type WeeklyRecapWordOfWeek,
} from './weeklyRecapCard';
import type { WeeklyRecapExportCopy } from './weeklyRecapExport';
import { computeWeeklyRecap, computeWeeklyRecapStats } from './weeklyRecapModel';
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

/** The word of the week's card: read once, and only after the learner chooses to show it. */
type WordOfWeekCard =
  | { readonly cardId: string; readonly status: 'loading' }
  | { readonly cardId: string; readonly status: 'found'; readonly word: string }
  | { readonly cardId: string; readonly status: 'missing' };

export interface WeeklyRecapDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly stats: LibraryStatsViewModel;
  readonly showingSavedStats?: boolean;
  /** Injectable for deterministic tests; defaults to the real clock. */
  readonly now?: () => Date;
}
const defaultNow = (): Date => new Date();

export default function WeeklyRecapDialog({ open, onOpenChange, stats, showingSavedStats = false, now = defaultNow }: WeeklyRecapDialogProps) {
  const { _, i18n: activeI18n } = useLingui();
  const verified = useVerifiedStats();
  const data = useMemo(
    () => computeWeeklyRecap(stats.xpChartData, now(), stats.reviewActivity, verified?.state?.rewardTimeZone ?? stats.rewardTimeZone),
    [stats.xpChartData, stats.reviewActivity, stats.rewardTimeZone, verified?.state?.rewardTimeZone, now],
  );
  const recapStats = useMemo(
    () => (verified?.state ? computeWeeklyRecapStats(verified.state, verified.language, now()) : null),
    [verified?.state, verified?.language, now],
  );

  const [selection, setSelection] = useState(defaultWeeklyRecapSelection);
  const [caption, setCaption] = useState(() => buildSuggestedWeeklyRecapCaption(data, recapStats, selection));
  const [wordCard, setWordCard] = useState<WordOfWeekCard | null>(null);
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
      setCaption(buildSuggestedWeeklyRecapCaption(data, recapStats, defaultWeeklyRecapSelection()));
    } else if (!captionCustomized.current) {
      setCaption(buildSuggestedWeeklyRecapCaption(data, recapStats, selection));
    }
    if (resetRecap) {
      exportGeneration.current += 1;
      setIsBusy(false);
      setExportResult(null);
    }
    // A new opening or week resets the recap; same-week refreshes only update an untouched suggestion.
  }, [open, data.rangeStart, data.rangeEnd, data.totalXp, data.activeDays, data.reviewedCount, recapStats]);

  // The card is read only once the learner turns the word on: one document read, never on open.
  const pick = recapStats?.wordOfWeek ?? null;
  const loadCard = verified?.loadCard;
  const requestedCardId = useRef<string | null>(null);
  const pickCardId = pick?.cardId ?? null;
  useEffect(() => {
    if (!open || !selection.wordOfWeek || !pickCardId || !loadCard || requestedCardId.current === pickCardId) return;
    requestedCardId.current = pickCardId;
    const settle = (next: WordOfWeekCard) => setWordCard(current => (current?.cardId === pickCardId ? next : current));
    setWordCard({ cardId: pickCardId, status: 'loading' });
    loadCard(pickCardId).then(
      card => settle(card ? { cardId: pickCardId, status: 'found', word: card.word } : { cardId: pickCardId, status: 'missing' }),
      () => settle({ cardId: pickCardId, status: 'missing' }),
    );
  }, [open, selection.wordOfWeek, pickCardId, loadCard]);
  const wordMissing = wordCard?.cardId === pick?.cardId && wordCard?.status === 'missing';
  const wordOfWeek: WeeklyRecapWordOfWeek | null = pick && wordCard?.cardId === pick.cardId && wordCard.status === 'found'
    ? { word: wordCard.word, reviews: pick.reviews }
    : null;
  const shownSelection = wordMissing ? { ...selection, wordOfWeek: false } : selection;

  const locale = activeI18n.locale || 'en';
  const content = buildWeeklyRecapCardContent({ data, stats: recapStats, selection: shownSelection, wordOfWeek, locale });
  const selectionKeys = availableWeeklyRecapSelectionKeys(data, recapStats, Boolean(loadCard) && !wordMissing);
  const dateRangeLabel = weeklyRecapRangeLabel(data.rangeStart, data.rangeEnd, locale);
  const filename = `sonflash-weekly-recap-${data.rangeStart}-to-${data.rangeEnd}.png`;
  const exportCopy: WeeklyRecapExportCopy = {
    weeklyRecap: _(weeklyRecapCopy.weeklyRecap),
    privacy: _(weeklyRecapCopy.privacy),
  };

  const renderBlob = async (): Promise<Blob> => {
    const { renderWeeklyRecapPng } = await import('./weeklyRecapExport');
    return renderWeeklyRecapPng({
      content,
      caption: clampWeeklyRecapCaption(caption),
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
      setCaption(captionAfterWeeklyRecapSelectionChange(data, recapStats, nextSelection, caption, captionCustomized.current));
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
      <Dialog.Content className="weekly-recap-dialog">
        <div className="weekly-recap-dialog__header">
          <Dialog.Title className="weekly-recap-dialog__title"><Trans {...msg({ id: 'weeklyRecap.dialog.title', message: 'Your weekly recap' })} /></Dialog.Title>
          <Dialog.Close aria-label={_(msg({ id: 'weeklyRecap.dialog.close', message: 'Close' }))} className="weekly-recap-dialog__close liquid-control"><X size={18} /></Dialog.Close>
        </div>
        <div className="weekly-recap-dialog__body">
          {showingSavedStats && <p role="status" className="mb-3 rounded-xl [html:not([data-theme-family=crystal])_&]:rounded-[var(--sf-panel-radius,18px)] border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-3 text-sm text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'weeklyRecap.saved-warning', message: 'Showing saved recap. Recent reviews may not be included.' })} /></p>}
          <WeeklyRecapScreen
            content={content}
            intro={{
              bestWeek: recapStats?.bestWeek ?? null,
              aheadOfLastWeek: recapStats?.aheadOfLastWeek ?? null,
              countedSince: recapStats?.words?.since ?? null,
            }}
            dateRangeLabel={dateRangeLabel}
            selection={shownSelection}
            selectionKeys={selectionKeys}
            heroIsXp={!recapStats?.words}
            caption={caption}
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
