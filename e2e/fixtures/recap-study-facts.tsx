import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import '../../src/index.css';
import '../../src/styles/themes/crystal-motion.css';
import '../../src/styles/app-bootstrap.css';
// The app always loads the shell stylesheet (AppRuntime); the recap board takes its Midnight Aurora glow from it.
import '../../src/styles/shell.css';
import { I18nProvider, useUiLocale } from '../../src/i18n/I18nProvider';
import { loadCatalog } from '../../src/i18n/loadCatalog';
import { ThemeProvider, useTheme } from '../../src/features/theme/ThemeProvider';
import { VerifiedStatsProvider, type VerifiedStatsSource } from '../../src/components/stats/VerifiedStatsContext';
import { ProgressLearningSince, ProgressStudiedTime, StudyPaceFact } from '../../src/components/stats/ProgressStudyFacts';
import StatsCharts from '../../src/components/stats/StatsCharts';
import WeeklyRecapDialog from '../../src/features/weeklyRecap/WeeklyRecapDialog';
import { SessionRecapModal } from '../../src/features/practice/SessionRecapModal';
import type { LibraryStatsViewModel } from '../../src/features/library/libraryViewModel';
import {
  FIXTURE_TIME_ZONE,
  stateFromFixture,
  streakFixtures,
  studyTimeFixture,
  wordWeeksFixture,
} from '../../src/features/gamification/testing/verifiedStatsFixtures';

// Renders the study-time, weekly-word and best-streak elements from the shared verified-stats
// fixtures, which hold the documents in the shape the server writes them; the client view
// models read them exactly as they read Firestore. The spec fixes the clock at the fixtures'
// "now", Thursday 19 Nov 2026 at 20:05 in Ho Chi Minh City.
//   ?view=weekly&state=counted|ship|empty   the weekly recap dialog
//   ?view=session                           the session recap with its duration and estimate
//   ?view=stats                             Learning since, studied time, pace, best streak, ranges
const params = new URLSearchParams(window.location.search);
const view = params.get('view') ?? 'weekly';
const weekState = params.get('state') ?? 'counted';
const now = wordWeeksFixture.now;

const wordWeeks = wordWeeksFixture.stats.wordWeeksV1 as Record<string, unknown>;
const studyTime = studyTimeFixture.stats.studyTimeV1 as Record<string, unknown>;
const studyDays = studyTime.days as Record<string, unknown>;
const streak = streakFixtures.frozenOneDay.stats.streakV1;
const reviewActivity = wordWeeksFixture.stats.reviewActivityV1 as { daysByLanguage: { en: Record<string, unknown> } };

const weekStats: Record<string, Record<string, unknown>> = {
  counted: { ...wordWeeksFixture.stats, studyTimeV1: studyTime },
  // Counting began on Tuesday for an account that studied before: no best week, no comparison.
  ship: {
    ...wordWeeksFixture.stats,
    wordWeeksV1: {
      ...wordWeeks,
      coverageStartedOn: '2026-11-17',
      daysByLanguage: { en: { '2026-11-17': { started: 45, mastered: 2 }, '2026-11-19': { started: 40, mastered: 5 } } },
      bestWeekByLanguage: {},
      wordOfWeekByLanguage: {},
    },
    studyTimeV1: {
      ...studyTime, coverageStartedOn: '2026-11-17', totalMs: 855_000,
      days: Object.fromEntries(Object.entries(studyDays).filter(([day]) => day >= '2026-11-17')),
    },
  },
  // Nothing studied since last week.
  empty: {
    ...wordWeeksFixture.stats,
    verifiedStreak: 0,
    lastVerifiedStudyDay: '2026-11-12',
    reviewActivityV1: { coverageStartedOnByLanguage: { en: '2026-09-28' }, daysByLanguage: { en: {} } },
    wordWeeksV1: { ...wordWeeks, daysByLanguage: { en: {} }, wordOfWeekByLanguage: {} },
  },
};

// The stats board also shows the best streak the server recorded.
const statsDocument = view === 'weekly' ? weekStats[weekState] ?? weekStats.counted
  : view === 'stats' ? { ...weekStats.counted, streakV1: streak } : weekStats.counted;
const verifiedState = {
  ...stateFromFixture({ now, stats: statsDocument }),
  ...(view === 'stats' ? { xpHistory: { '2026-06-02': 15, '2026-09-28': 40, '2026-11-19': 60 } } : {}),
};
const words: Record<string, string> = { 'word-immediate': 'immediate' };
const source: VerifiedStatsSource = {
  state: verifiedState,
  language: 'en',
  loadCard: cardId => Promise.resolve(words[cardId] ? { id: cardId, word: words[cardId] } : null),
};

const reviewDays = reviewActivity.daysByLanguage.en as NonNullable<LibraryStatsViewModel['reviewActivity']>['days'];
const libraryStats: LibraryStatsViewModel = {
  total: 146, reviewed: 130, learned: 21, learning: 109, dueToday: 24,
  categoryChart: [], categoryChartIsPartial: false,
  difficultyChart: [{ name: 'Mastered', value: 21 }, { name: 'Learning', value: 109 }, { name: 'Not reviewed', value: 16 }],
  xpChartData: weekState === 'empty' && view === 'weekly' ? [] : [{ date: '2026-11-16', XP: 120 }, { date: '2026-11-17', XP: 80 }, { date: '2026-11-19', XP: 60 }],
  reviewActivity: weekState === 'empty' && view === 'weekly' ? { coverageStartedOn: '2026-09-28', days: {} } : { coverageStartedOn: '2026-09-28', days: reviewDays },
  rewardTimeZone: FIXTURE_TIME_ZONE,
};

function StatsBoard() {
  const { mode } = useTheme();
  return <main className="progress-board" data-study-facts-board style={{ padding: 16, maxWidth: 1180, margin: '0 auto' }}>
    <header className="progress-board-header">
      <h1>Progress</h1>
      <p data-fact="learning-since"><ProgressLearningSince variant="subtitle" /></p>
      <p data-fact="learning-since-kicker"><ProgressLearningSince variant="kicker" /></p>
      <p data-fact="studied"><ProgressStudiedTime /></p>
      <dl data-fact="pace"><StudyPaceFact /></dl>
    </header>
    <StatsCharts darkMode={mode === 'dark'} section="primary" data={libraryStats} />
  </main>;
}

function Fixture() {
  const locale = useUiLocale();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void Promise.all([loadCatalog(locale, 'progress'), loadCatalog(locale, 'practice'), loadCatalog(locale, 'today')]).then(() => setReady(true));
  }, [locale]);
  if (!ready) return null;

  return <VerifiedStatsProvider source={source}>
    {view === 'weekly' && <WeeklyRecapDialog open onOpenChange={() => undefined} stats={libraryStats} now={() => now} />}
    {view === 'session' && <SessionRecapModal
      open
      onClose={() => undefined}
      onRetryWeak={() => undefined}
      onViewWeeklyRecap={() => undefined}
      totalCards={12}
      goodCount={10}
      againCount={2}
      xpEarned={175}
      weakCards={[]}
      promotions={[]}
      streakDays={12}
      bestRun={9}
      returnsToToday
      loadTomorrowDue={() => Promise.resolve(24)}
      studyTimeMs={4 * 60_000 + 5_400}
    />}
    {view === 'stats' && <StatsBoard />}
  </VerifiedStatsProvider>;
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <I18nProvider>
      <Fixture />
    </I18nProvider>
  </ThemeProvider>,
);
