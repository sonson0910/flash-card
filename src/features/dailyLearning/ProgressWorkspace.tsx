import { lazy, Suspense, useEffect, useState, type RefObject } from 'react';
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { ArrowRight, Award, CalendarDays } from 'lucide-react';
import type { LibraryStatsViewModel } from '../library/libraryViewModel';
import { useTheme } from '../theme/ThemeProvider';
import { ProgressScreen } from './ProgressScreen';
import { AchievementsMatrix } from '../../components/stats/AchievementsMatrix';
import { hasReviewRange, type ReviewRangeDays } from '../../components/stats/ReviewRangeToggle';

const StatsCharts = lazy(() => import('../../components/stats/StatsCharts'));
const WeeklyRecapDialog = lazy(() => import('../weeklyRecap/WeeklyRecapDialog'));

interface ProgressWorkspaceProps {
  readonly ownerId?: string | null;
  readonly targetLanguage?: string;
  readonly darkMode: boolean;
  readonly isOffline: boolean;
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  readonly focusIntent?: number;
  readonly stats: LibraryStatsViewModel;
  readonly isStatsLoading: boolean;
  readonly statsError: string | null;
  readonly continueReview: () => void | Promise<void>;
  readonly openVocabulary: () => void;
  /** Opens the vocabulary filtered to mastered cards; the whole vocabulary opens without it. */
  readonly openMasteredVocabulary?: () => void;
  readonly weeklyRecapRequestOwnerId?: string | null;
  readonly weeklyRecapRequestSettled?: boolean;
  readonly onWeeklyRecapRequestConsumed?: () => void;
}

export const hasProgressActivity = (stats: LibraryStatsViewModel): boolean => stats.reviewed > 0 || stats.xpChartData.some(entry => entry.XP > 0) || Object.values(stats.reviewActivity?.days ?? {}).some(day => day.reviewed > 0);

export const formatLocalMasteredDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
};

const forecastWeekday = (dateKey: string, locale: string): string => {
  const date = new Date(`${dateKey}T12:00:00`);
  return Number.isNaN(date.getTime()) ? dateKey : new Intl.DateTimeFormat(locale === 'pseudo' ? 'en' : locale, { weekday: 'short' }).format(date);
};

const localDateKey = (date: Date): string => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');

function ChartsFallback() {
  return <div className="crystal-chamfer skeleton-sheen min-h-72 rounded-2xl border border-[var(--sf-border)]" role="status"><span className="sr-only"><Trans {...msg({ context: 'progress.charts.loading', message: 'Loading progress charts…' })} /></span></div>;
}

export default function ProgressWorkspace({ ownerId, targetLanguage, darkMode, isOffline, headingRef, focusIntent = 0, stats, isStatsLoading, statsError, continueReview, openVocabulary, openMasteredVocabulary, weeklyRecapRequestOwnerId, weeklyRecapRequestSettled, onWeeklyRecapRequestConsumed }: ProgressWorkspaceProps) {
  const hasActivity = hasProgressActivity(stats);
  const { i18n: activeI18n } = useLingui();
  const locale = activeI18n.locale || 'en';
  const { family } = useTheme();
  const [reviewRangeDays, setReviewRangeDays] = useState<ReviewRangeDays>(182);
  const showsInsights = hasActivity || (stats.total > 0 && Boolean(stats.dueForecast || stats.recentlyMastered));
  const showsCharts = showsInsights && (hasActivity || Boolean(stats.reviewActivity));
  // The header's range switch drives the activity heatmap, so it appears only with that panel.
  const showsReviewRange = showsCharts && hasReviewRange(stats);
  const today = localDateKey(new Date());
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dueToday = stats.dueAsOfDate === today ? stats.dueToday : null;
  const dueTimeline = dueToday !== null && stats.dueForecast?.[0]?.date === localDateKey(tomorrow)
    ? [{ date: today, count: dueToday }, ...stats.dueForecast] : null;
  const forecastMaximum = Math.max(1, ...(dueTimeline?.map(day => day.count) ?? [0]));
  const recapScope = `${ownerId ?? 'signed-out'}:${targetLanguage ?? 'en'}`;
  const [isRecapOpen, setIsRecapOpen] = useState(false);
  const [openRecapScope, setOpenRecapScope] = useState(recapScope);
  useEffect(() => {
    if (openRecapScope !== recapScope) setIsRecapOpen(false);
  }, [openRecapScope, recapScope]);
  useEffect(() => {
    if (!ownerId || weeklyRecapRequestOwnerId !== ownerId || !weeklyRecapRequestSettled) return;
    setOpenRecapScope(recapScope);
    setIsRecapOpen(true);
    onWeeklyRecapRequestConsumed?.();
  }, [ownerId, weeklyRecapRequestOwnerId, weeklyRecapRequestSettled, onWeeklyRecapRequestConsumed]);
  const [isAchievementsOpen, setIsAchievementsOpen] = useState(false);
  const showAchievements = (open: boolean) => {
    document.querySelector('.claude-workspace')?.scrollTo(0, 0);
    setIsAchievementsOpen(open);
  };
  const message = isStatsLoading ? i18n._(msg({ id: 'progress.message.loading', message: 'Refreshing progress; saved metrics remain visible.' }).id) : statsError ? i18n._(msg({ id: 'progress.message.error', message: 'Showing saved progress. {error}' }).id, { error: statsError }) : i18n._(msg({ id: 'progress.message.ready', message: 'Progress is calculated from your learning history.' }).id);
  if (isAchievementsOpen && hasActivity) return <AchievementsMatrix stats={stats} onBackToProgress={() => showAchievements(false)} />;
  return <><ProgressScreen model={{ headingRef, focusIntent, status: isStatsLoading ? 'loading' : statsError && !hasActivity ? 'error' : hasActivity ? 'ready' : 'empty', message, reviewed: stats.reviewed, mastered: stats.learned, dueToday, isOffline, hasVocabulary: stats.total > 0, ...(showsReviewRange ? { reviewRangeDays } : {}) }} actions={{ startReview: () => { if (!isOffline) void continueReview(); }, openVocabulary, changeReviewRange: setReviewRangeDays }}>
    {showsInsights && <div className="space-y-6">
      {showsCharts && <Suspense fallback={<ChartsFallback />}><div className="async-content-enter" data-async-content="progress-charts"><StatsCharts key={`${ownerId ?? 'signed-out'}:${targetLanguage ?? 'en'}`} darkMode={darkMode} data={stats} section="primary" reviewRangeDays={reviewRangeDays} /></div></Suspense>}
      {(stats.dueForecast || stats.recentlyMastered) && <section className="progress-evidence grid grid-cols-1" aria-label={i18n._(msg({ id: 'progress.evidence.forecast-and-mastery', message: 'Forecast and recently mastered cards' }))}>
        <div className="progress-forecast crystal-chamfer-sm min-w-0">
          <div className="stats-panel-head"><h2 className="stats-panel-title"><Trans {...msg({ context: 'progress.forecast.title', message: 'Coming up' })} /></h2><span className="stats-panel-note"><Trans {...msg({ context: 'progress.forecast.note', message: 'Cards due, next 14 days' })} /></span></div>
          {dueTimeline ? <ol data-due-timeline className="progress-forecast-days">{dueTimeline.map((day, index) => <li key={day.date} data-forecast-day={index === 0 ? 'today' : index === 1 ? 'tomorrow' : undefined}>
            <time dateTime={day.date}>{index === 0 ? <Trans {...msg({ context: 'progress.forecast.today', message: 'Today' })} /> : forecastWeekday(day.date, locale)}</time>
            <span className="progress-forecast-bar" aria-hidden="true"><span style={{ height: `${day.count ? Math.max(8, day.count / forecastMaximum * 100) : 0}%` }} /></span>
            <strong className="progress-forecast-count">{day.count}</strong>
          </li>)}</ol> : <p className="progress-panel-empty"><Trans {...msg({ context: 'progress.forecast.unavailable', message: 'Forecast is unavailable while saved progress is loading.' })} /></p>}
        </div>
        <div className="progress-mastered crystal-chamfer-sm min-w-0">
          <div className="stats-panel-head">
            <h2 className="stats-panel-title">{family === 'crystal'
              ? <Trans {...msg({ context: 'progress.mastered.crystal-title', message: 'New stars' })} />
              : <Trans {...msg({ context: 'progress.mastered.title', message: 'Recently <0>mastered</0>' })} components={{ 0: <span className="progress-accent" /> }} />}</h2>
            {stats.learned > 0 && <button type="button" onClick={openMasteredVocabulary ?? openVocabulary} aria-label={activeI18n._({ ...msg({ id: 'progress.mastered.all-label', message: 'All {count, plural, one {# mastered card} other {# mastered cards}} in Vocabulary' }), values: { count: stats.learned } })} className="progress-mastered-all"><Trans {...msg({ context: 'progress.mastered.all', message: 'All {count}' })} values={{ count: stats.learned }} /><ArrowRight size={14} aria-hidden="true" /></button>}
          </div>
          {stats.recentlyMastered?.length ? <ul className="progress-mastered-cards">{stats.recentlyMastered.map(card => <li key={card.id}>
            {family === 'crystal' && <span className="stats-grade-chip progress-mastered-chip" aria-hidden="true"><Trans {...msg({ context: 'progress.mastered.chip', message: 'Star' })} /></span>}
            <p className="progress-mastered-word">{card.word}</p>
            <p className="progress-mastered-meaning">{card.translation}</p>
            <time dateTime={card.masteredAt} className="progress-mastered-date">{formatLocalMasteredDate(card.masteredAt)}</time>
          </li>)}</ul> : <p className="progress-panel-empty"><Trans {...msg({ context: 'progress.mastered.empty', message: 'No cards have reached mastery yet.' })} /></p>}
        </div>
      </section>}
      {showsCharts && <Suspense fallback={<ChartsFallback />}><div className="async-content-enter"><StatsCharts darkMode={darkMode} data={stats} section="secondary" /></div></Suspense>}
      {hasActivity && <div className="flex justify-end"><button type="button" onClick={() => showAchievements(true)} className="liquid-control crystal-chamfer-sm inline-flex min-h-11 items-center gap-2 rounded-2xl border border-[var(--sf-border)] px-4 py-2 text-sm font-bold text-[var(--sf-text)]"><Award size={16} aria-hidden="true" /><Trans {...msg({ context: 'progress.achievements.open', message: 'View achievements' })} /></button></div>}
      {hasActivity && <div className="flex justify-end">
        <button type="button" onClick={() => { setOpenRecapScope(recapScope); setIsRecapOpen(true); }} className="liquid-control crystal-chamfer-sm inline-flex min-h-11 items-center gap-2 rounded-2xl border border-[var(--sf-border)] px-4 py-2 text-sm font-bold text-[var(--sf-text)]">
          <CalendarDays size={16} aria-hidden="true" />
          <Trans {...msg({ context: 'progress.weeklyRecap.open', message: 'View weekly recap' })} />
        </button>
      </div>}
    </div>}
  </ProgressScreen>{isRecapOpen && openRecapScope === recapScope && <Suspense fallback={null}><WeeklyRecapDialog open={isRecapOpen} onOpenChange={setIsRecapOpen} stats={stats} showingSavedStats={Boolean(statsError)} /></Suspense>}</>;
}
