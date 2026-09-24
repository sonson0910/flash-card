import { lazy, Suspense, type RefObject } from 'react';
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react';
import type { LibraryStatsViewModel } from '../library/libraryViewModel';
import { ProgressScreen } from './ProgressScreen';
import { AchievementsMatrix } from '../../components/stats/AchievementsMatrix';

const StatsCharts = lazy(() => import('../../components/stats/StatsCharts'));

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

export const hasProgressActivity = (stats: LibraryStatsViewModel): boolean => stats.reviewed > 0 || stats.xpChartData.some(entry => entry.XP > 0);

function ChartsFallback() {
  return <div className="crystal-chamfer skeleton-sheen min-h-72 rounded-2xl border border-[var(--sf-border)]" role="status"><span className="sr-only"><Trans id="progress.charts.loading" message="Loading progress charts…" /></span></div>;
}

export default function ProgressWorkspace({ darkMode, isOffline, headingRef, focusIntent = 0, stats, isStatsLoading, statsError, continueReview, openVocabulary }: ProgressWorkspaceProps) {
  const hasActivity = hasProgressActivity(stats);
  const message = isStatsLoading ? i18n._(msg({ id: 'progress.message.loading', message: 'Refreshing progress; saved metrics remain visible.' }).id) : statsError ? i18n._(msg({ id: 'progress.message.error', message: 'Showing saved progress. {error}' }).id, { error: statsError }) : i18n._(msg({ id: 'progress.message.ready', message: 'Progress is calculated from your learning history.' }).id);
  return <ProgressScreen model={{ headingRef, focusIntent, status: isStatsLoading ? 'loading' : statsError && !hasActivity ? 'error' : hasActivity ? 'ready' : 'empty', message, reviewed: stats.reviewed, mastered: stats.learned, dueToday: stats.dueToday, isOffline, hasVocabulary: stats.total > 0 }} actions={{ startReview: () => void continueReview(), openVocabulary }}>
    {hasActivity && <div className="space-y-6"><Suspense fallback={<ChartsFallback />}><div className="async-content-enter" data-async-content="progress-charts"><StatsCharts darkMode={darkMode} data={stats} /></div></Suspense><AchievementsMatrix stats={stats} /></div>}
  </ProgressScreen>;
}
