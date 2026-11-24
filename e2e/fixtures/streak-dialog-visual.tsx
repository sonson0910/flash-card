import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import '../../src/index.css';
import '../../src/styles/themes/crystal-motion.css';
import '../../src/styles/app-bootstrap.css';
import '../../src/features/dailyLearning/today-ready-hero.css';
import { StreakChip } from '../../src/features/dailyLearning/StreakDialog';
import { streakRunStats } from '../../src/features/dailyLearning/todayScreenFacts';
import { buildStreakView } from '../../src/features/gamification/streakView';
import { stateFromFixture, streakFixtures, type VerifiedStatsFixture } from '../../src/features/gamification/testing/verifiedStatsFixtures';
import { ThemeProvider } from '../../src/features/theme/ThemeProvider';
import { I18nProvider, useUiLocale } from '../../src/i18n/I18nProvider';
import { loadCatalog } from '../../src/i18n/loadCatalog';

// Each state is a stored stats document the verified-action transaction writes. The milestone
// state adds review counters and verified XP for its 30 days, so the run totals can be shown; the
// word counts only keep the last two weeks, so a 30-day run shows XP in place of new words.
const runDays = (from: string, count: number) =>
  Array.from({ length: count }, (_, index) => new Date(Date.parse(`${from}T00:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10));
const milestoneDays = runDays('2026-10-21', 30);
const milestone: VerifiedStatsFixture = {
  ...streakFixtures.safeAtMilestone,
  stats: {
    ...streakFixtures.safeAtMilestone.stats,
    reviewActivityV1: {
      coverageStartedOnByLanguage: { en: '2026-10-01' },
      daysByLanguage: {
        en: Object.fromEntries(milestoneDays.map((day, index) => {
          const reviewed = 36 + (index * 7) % 15;
          const again = 2 + index % 4;
          const hard = 4 + index % 3;
          const easy = 2 + index % 2;
          return [day, { reviewed, again, hard, good: reviewed - again - hard - easy, easy }];
        })),
      },
    },
  },
  history: { verifiedByDayV1: Object.fromEntries(milestoneDays.map((day, index) => [day, 80 + (index * 11) % 40])) },
};
const fixtures = {
  active: streakFixtures.legacyOpen,
  frozen: streakFixtures.frozenOneDay,
  repair: streakFixtures.repairAvailable,
  'repair-progress': streakFixtures.repairInProgress,
  milestone,
} as const;
type FixtureState = keyof typeof fixtures;

function StreakDialogFixture() {
  const locale = useUiLocale();
  const [ready, setReady] = useState(false);
  const requested = new URLSearchParams(location.search).get('state');
  const state: FixtureState = requested && requested in fixtures ? requested as FixtureState : 'active';
  useEffect(() => { void loadCatalog(locale, 'today').then(() => setReady(true)); }, [locale]);
  if (!ready) return null;
  const fixture = fixtures[state];
  const gamification = stateFromFixture(fixture);
  const view = buildStreakView(gamification, fixture.now);
  const runStats = streakRunStats(gamification.reviewActivityByLanguage, gamification.wordWeeks, gamification.xpHistory, view.today, view.length);
  return <main className="today-ready-page" data-streak-dialog-visual-view={state} style={{ minHeight: '100dvh', padding: 24, boxSizing: 'border-box' }}>
    <StreakChip view={view} runStats={runStats} now={fixture.now} streak={gamification.streak} className="today-chip today-chip--button" onStartSession={() => undefined} />
  </main>;
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider><I18nProvider><StreakDialogFixture /></I18nProvider></ThemeProvider>,
);
