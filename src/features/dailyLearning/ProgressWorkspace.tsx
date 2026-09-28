import { lazy, Suspense, useState, type RefObject } from 'react';
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react';
import { Award, CalendarDays } from 'lucide-react';
import type { LibraryStatsViewModel } from '../library/libraryViewModel';
import { ProgressScreen } from './ProgressScreen';
import { AchievementsMatrix } from '../../components/stats/AchievementsMatrix';

const StatsCharts = lazy(() => import('../../components/stats/StatsCharts'));
const WeeklyRecapDialog = lazy(() => import('../weeklyRecap/WeeklyRecapDialog'));

interface ProgressWorkspaceProps {
  readonly darkMode: boolean;
  readonly isOffline: boolean;
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  readonly focusIntent?: number;
  readonly stats: LibraryStatsViewModel;
  readonly isStatsLoading: boolean;
  readonly statsError: string | null;
  readonly continueReview: () => void | Promise<void>;
  readonly openVocabulary: () => void;
}

export const hasProgressActivity = (stats: LibraryStatsViewModel): boolean => stats.reviewed > 0 || stats.xpChartData.some(entry => entry.XP > 0) || Object.values(stats.reviewActivity?.days ?? {}).some(day => day.reviewed > 0);

export const formatLocalMasteredDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
};

function ChartsFallback() {
  return <div className="crystal-chamfer skeleton-sheen min-h-72 rounded-2xl border border-[var(--sf-border)]" role="status"><span className="sr-only"><Trans id="progress.charts.loading" message="Loading progress charts…" /></span></div>;
}

export default function ProgressWorkspace({ darkMode, isOffline, headingRef, focusIntent = 0, stats, isStatsLoading, statsError, continueReview, openVocabulary }: ProgressWorkspaceProps) {
  const hasActivity = hasProgressActivity(stats);
  const forecastMaximum = Math.max(1, ...(stats.dueForecast?.map(day => day.count) ?? [0]));
  const [isRecapOpen, setIsRecapOpen] = useState(false);
  const [isAchievementsOpen, setIsAchievementsOpen] = useState(false);
  const showAchievements = (open: boolean) => {
    document.querySelector('.claude-workspace')?.scrollTo(0, 0);
    setIsAchievementsOpen(open);
  };
  const message = isStatsLoading ? i18n._(msg({ id: 'progress.message.loading', message: 'Refreshing progress; saved metrics remain visible.' }).id) : statsError ? i18n._(msg({ id: 'progress.message.error', message: 'Showing saved progress. {error}' }).id, { error: statsError }) : i18n._(msg({ id: 'progress.message.ready', message: 'Progress is calculated from your learning history.' }).id);
  if (isAchievementsOpen && hasActivity) return <AchievementsMatrix stats={stats} onBackToProgress={() => showAchievements(false)} />;
  return <ProgressScreen model={{ headingRef, focusIntent, status: isStatsLoading ? 'loading' : statsError && !hasActivity ? 'error' : hasActivity ? 'ready' : 'empty', message, reviewed: stats.reviewed, mastered: stats.learned, dueToday: stats.dueToday, isOffline, hasVocabulary: stats.total > 0 }} actions={{ startReview: () => void continueReview(), openVocabulary }}>
    {(hasActivity || (stats.total > 0 && (stats.dueForecast || stats.recentlyMastered))) && <div className="space-y-6">
      {(hasActivity || stats.reviewActivity) && <Suspense fallback={<ChartsFallback />}><div className="async-content-enter" data-async-content="progress-charts"><StatsCharts darkMode={darkMode} data={stats} /></div></Suspense>}
      {(stats.dueForecast || stats.recentlyMastered) && <section className="grid gap-4 lg:grid-cols-2" aria-label={i18n._(msg({ id: 'progress.evidence.forecast-and-mastery', message: 'Forecast and recently mastered cards' }))}>
        <div className="crystal-chamfer-sm min-w-0 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] p-5"><h2 className="text-lg font-black"><Trans id="progress.forecast.title" message="Due over the next 13 days" /></h2>{stats.dueForecast ? <ol className="mt-4 grid grid-cols-7 gap-2 text-center">{stats.dueForecast.map(day => <li key={day.date} className="grid min-w-0 gap-1" style={{ gridTemplateRows: 'auto 4.5rem auto' }}><time dateTime={day.date} className="truncate text-xs text-[var(--sf-text-muted)]">{day.date.slice(5)}</time><span aria-hidden="true" className="flex items-end border-b border-[var(--sf-border)]"><span className="w-full rounded-t bg-[var(--sf-brand)]" style={{ height: `${day.count ? Math.max(8, day.count / forecastMaximum * 100) : 0}%` }} /></span><strong className="tabular-nums">{day.count}</strong></li>)}</ol> : <p className="mt-3 text-sm text-[var(--sf-text-muted)]"><Trans id="progress.forecast.unavailable" message="Forecast is unavailable while saved progress is loading." /></p>}</div>
        <div className="crystal-chamfer-sm min-w-0 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] p-5"><h2 className="text-lg font-black"><Trans id="progress.mastered.title" message="Recently mastered" /></h2>{stats.recentlyMastered?.length ? <ul className="mt-3 grid grid-cols-2 gap-2">{stats.recentlyMastered.map(card => <li key={card.id} className="min-w-0 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-3"><p className="truncate font-bold">{card.word}</p><p className="truncate text-sm text-[var(--sf-text-muted)]">{card.translation}</p><time dateTime={card.masteredAt} className="mt-3 block text-xs text-[var(--sf-text-muted)]">{formatLocalMasteredDate(card.masteredAt)}</time></li>)}</ul> : <p className="mt-3 text-sm text-[var(--sf-text-muted)]"><Trans id="progress.mastered.empty" message="No cards have reached mastery yet." /></p>}</div>
      </section>}
      {hasActivity && <div className="flex justify-end"><button type="button" onClick={() => showAchievements(true)} className="liquid-control crystal-chamfer-sm inline-flex min-h-11 items-center gap-2 rounded-2xl border border-[var(--sf-border)] px-4 py-2 text-sm font-bold text-[var(--sf-text)]"><Award size={16} aria-hidden="true" /><Trans id="progress.achievements.open" message="View achievements" /></button></div>}
      {hasActivity && <div className="flex justify-end">
        <button type="button" onClick={() => setIsRecapOpen(true)} className="liquid-control crystal-chamfer-sm inline-flex min-h-11 items-center gap-2 rounded-2xl border border-[var(--sf-border)] px-4 py-2 text-sm font-bold text-[var(--sf-text)]">
          <CalendarDays size={16} aria-hidden="true" />
          <Trans id="progress.weeklyRecap.open" message="View weekly recap" />
        </button>
      </div>}
      {isRecapOpen && <Suspense fallback={null}><WeeklyRecapDialog open={isRecapOpen} onOpenChange={setIsRecapOpen} stats={stats} /></Suspense>}
    </div>}
  </ProgressScreen>;
}
