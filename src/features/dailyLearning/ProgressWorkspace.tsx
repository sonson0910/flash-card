import { lazy, Suspense, type RefObject } from 'react';
import type { LibraryStatsViewModel } from '../library/libraryViewModel';
import { ProgressScreen } from './ProgressScreen';
import { AchievementsMatrix } from '../../components/stats/AchievementsMatrix';
import './dailyLearningAtelier.css';

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

export const hasProgressActivity = (stats: LibraryStatsViewModel): boolean => (
  stats.reviewed > 0 || stats.xpChartData.some(entry => entry.XP > 0)
);

export default function ProgressWorkspace({ darkMode, isOffline, headingRef, focusIntent = 0, stats, isStatsLoading, statsError, continueReview, openVocabulary }: ProgressWorkspaceProps) {
  const hasActivity = hasProgressActivity(stats);
  return (
    <ProgressScreen model={{
      headingRef,
      focusIntent,
      status: isStatsLoading ? 'loading' : statsError && !hasActivity ? 'error' : hasActivity ? 'ready' : 'empty',
      message: isStatsLoading ? 'Refreshing progress; saved metrics remain visible.'
        : statsError ? `Showing saved progress. ${statsError}`
          : 'Progress is calculated from your learning history.',
      reviewed: stats.reviewed,
      mastered: stats.learned,
      dueToday: stats.dueToday,
      isOffline,
      hasVocabulary: stats.total > 0,
    }} actions={{ startReview: () => void continueReview(), openVocabulary }}>
      {hasActivity && (
        <div className="space-y-6" data-progress-insights="true">
          <Suspense fallback={<div className="skeleton-sheen min-h-72 rounded-2xl border border-[var(--sf-border)]" role="status">Loading progress charts…</div>}>
            <StatsCharts darkMode={darkMode} data={stats} />
          </Suspense>
          <AchievementsMatrix stats={stats} />
        </div>
      )}
    </ProgressScreen>
  );
}
