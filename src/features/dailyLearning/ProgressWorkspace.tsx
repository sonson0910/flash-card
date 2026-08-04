import { lazy, Suspense, useEffect, type RefObject } from 'react';
import type { LibraryStatsViewModel } from '../library/libraryViewModel';
import { ProgressScreen } from './ProgressScreen';

const StatsCharts = lazy(() => import('../../components/stats/StatsCharts'));

interface ProgressWorkspaceProps {
  readonly darkMode: boolean;
  readonly isOffline: boolean;
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  readonly stats: LibraryStatsViewModel;
  readonly isStatsLoading: boolean;
  readonly statsError: string | null;
}

export const hasProgressActivity = (stats: LibraryStatsViewModel): boolean => (
  stats.reviewed > 0
);

export default function ProgressWorkspace({ darkMode, isOffline, headingRef, stats, isStatsLoading, statsError }: ProgressWorkspaceProps) {
  useEffect(() => { headingRef?.current?.focus(); }, [headingRef]);
  const hasActivity = hasProgressActivity(stats);
  return (
    <ProgressScreen model={{
      headingRef,
      status: isStatsLoading ? 'loading' : statsError && !hasActivity ? 'error' : hasActivity ? 'ready' : 'empty',
      message: isStatsLoading ? 'Refreshing progress; saved metrics remain visible.'
        : statsError ? `Showing saved progress. ${statsError}`
          : 'Progress is calculated from your learning history.',
      reviewed: stats.reviewed,
      mastered: stats.learned,
      dueToday: stats.dueToday,
      isOffline,
    }}>
      {hasActivity && (
        <Suspense fallback={<div className="skeleton-sheen min-h-72 rounded-2xl border border-[var(--sf-border)]" role="status">Loading progress charts…</div>}>
          <StatsCharts darkMode={darkMode} data={stats} />
        </Suspense>
      )}
    </ProgressScreen>
  );
}
