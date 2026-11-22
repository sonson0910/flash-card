import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import '../../src/index.css';
import '../../src/styles/app-bootstrap.css';
import { I18nProvider, useUiLocale } from '../../src/i18n/I18nProvider';
import { loadCatalog } from '../../src/i18n/loadCatalog';
import { ThemeProvider } from '../../src/features/theme/ThemeProvider';
import { AchievementsMatrix } from '../../src/components/stats/AchievementsMatrix';
import { AchievementsLearnerProvider, type AchievementsLearnerLevel } from '../../src/components/stats/AchievementsMatrixLearner';
import type { LibraryStatsViewModel } from '../../src/features/library/libraryViewModel';
import { levelProgress } from '../../src/features/gamification/achievementsView';
import {
  achievementsFixture,
  stateFromFixture,
  streakFixtures,
  studyTimeFixture,
  type VerifiedStatsFixture,
} from '../../src/features/gamification/testing/verifiedStatsFixtures';

// The board for three accounts the emulator journey cannot reach yet, built from the stored
// documents in the shape the verified-action transaction writes them.
//   ?account=earned  a month of study: most badges earned on their recorded days, a title held
//   ?account=new     the first verified action after recording started: six badges earned by that day
//   ?account=empty   recording started, no study yet: every badge not started

const counters = (fields: Record<string, unknown>) => ({
  activeDays: 0, lastXpDay: null, lastXpDayXp: 0, bestDayXp: 0, reviewedCards: 0, masteredWords: 0, lateReviews: 0, spellingCorrect: 0, ...fields,
});

const earned: VerifiedStatsFixture = {
  now: studyTimeFixture.now,
  stats: {
    ...streakFixtures.safeAtMilestone.stats,
    verifiedXp: 2_210,
    studyTimeV1: studyTimeFixture.stats.studyTimeV1,
    achievementsV1: {
      catalogVersion: 1,
      recordingStartedOn: '2026-10-21',
      counters: counters({ activeDays: 30, lastXpDay: '2026-11-19', lastXpDayXp: 40, bestDayXp: 180, reviewedCards: 412, masteredWords: 64, lateReviews: 6, spellingCorrect: 50 }),
      badges: {
        'first-review': { on: '2026-10-21', exact: false },
        'active-days-3': { on: '2026-10-21', exact: false },
        'active-days-5': { on: '2026-10-23', exact: true },
        'reviewed-10': { on: '2026-10-21', exact: false },
        'day-xp-100': { on: '2026-10-26', exact: true },
        'streak-7': { on: '2026-10-27', exact: true },
        'spelling-50': { on: '2026-11-12', exact: true },
        'xp-500': { on: '2026-10-29', exact: true },
        'mastered-50': { on: '2026-11-15', exact: true },
        'web-wanderer': { on: '2026-11-19', exact: true },
      },
      titles: { 'word-keeper': { on: '2026-11-08', exact: true } },
    },
  },
  rewards: { ...streakFixtures.safeAtMilestone.rewards, ownedTitleIds: ['word-keeper'] },
};

const empty: VerifiedStatsFixture = {
  now: achievementsFixture.now,
  stats: {
    ...achievementsFixture.stats,
    verifiedXp: 0, verifiedStreak: 0, lastVerifiedStudyDay: null,
    achievementsV1: { catalogVersion: 1, recordingStartedOn: '2026-11-27', counters: counters({}), badges: {}, titles: {} },
  },
  rewards: { ownedTitleIds: [] },
};

const accounts: Record<string, { fixture: VerifiedStatsFixture; library: LibraryStatsViewModel }> = {
  earned: {
    fixture: earned,
    library: {
      total: 449, reviewed: 412, learned: 97, learning: 138, dueToday: 18, categoryChart: [], categoryChartIsPartial: false,
      difficultyChart: [{ name: 'Not reviewed', value: 214 }, { name: 'Learning', value: 138 }, { name: 'Mastered', value: 97 }],
      xpChartData: [{ date: '2026-11-16', XP: 80 }, { date: '2026-11-17', XP: 60 }, { date: '2026-11-18', XP: 90 }, { date: '2026-11-19', XP: 40 }],
    },
  },
  new: {
    fixture: achievementsFixture,
    library: {
      total: 52, reviewed: 37, learned: 13, learning: 24, dueToday: 9, categoryChart: [], categoryChartIsPartial: false,
      difficultyChart: [{ name: 'Not reviewed', value: 15 }, { name: 'Learning', value: 24 }, { name: 'Mastered', value: 13 }],
      xpChartData: [{ date: '2026-11-27', XP: 2 }],
    },
  },
  empty: {
    fixture: empty,
    library: { total: 0, reviewed: 0, learned: 0, learning: 0, dueToday: 0, categoryChart: [], categoryChartIsPartial: false, difficultyChart: [], xpChartData: [] },
  },
};

const account = accounts[new URLSearchParams(window.location.search).get('account') ?? 'earned'] ?? accounts.earned;
const gamification = stateFromFixture(account.fixture);
const learner: AchievementsLearnerLevel = {
  level: levelProgress(gamification.xp).level,
  xp: gamification.xp,
  gamification,
  identity: { status: 'authenticated', displayName: 'Khánh Bùi', email: null, photoUrl: null },
};

function AchievementsFixture() {
  const locale = useUiLocale();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void loadCatalog(locale, 'progress').then(() => setReady(true));
  }, [locale]);
  if (!ready) return null;

  return <main className="p-4 sm:p-8" data-achievements-fixture>
    <AchievementsLearnerProvider learner={learner}>
      <AchievementsMatrix stats={account.library} onBackToProgress={() => undefined} now={account.fixture.now} />
    </AchievementsLearnerProvider>
  </main>;
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <I18nProvider>
      <AchievementsFixture />
    </I18nProvider>
  </ThemeProvider>,
);
