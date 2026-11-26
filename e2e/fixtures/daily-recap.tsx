import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import '../../src/index.css';
import '../../src/styles/themes/crystal-motion.css';
import '../../src/styles/themes/classic-motion.css';
import '../../src/styles/app-bootstrap.css';
// The app always loads the shell stylesheet (AppRuntime); the recap board takes its Midnight Aurora glow from it.
import '../../src/styles/shell.css';
import { I18nProvider, useUiLocale } from '../../src/i18n/I18nProvider';
import { loadCatalog } from '../../src/i18n/loadCatalog';
import { SessionRecapModal } from '../../src/features/practice/SessionRecapModal';
import type { SessionRecapReminder, SessionRecapReminderPort } from '../../src/features/practice/session-recap-reminder';
import type { ReminderSettings } from '../../src/features/reminders/reminderService';
import { IeltsGoalPanelView } from '../../src/features/examProgress/IeltsGoalPanel';
import { buildIeltsGoalModel, type IeltsGoalModelInput } from '../../src/features/examProgress/ieltsGoalModel';
import { IELTS_GOAL_KIND } from '../../functions/src/course-profile-contract';
import { ThemeProvider } from '../../src/features/theme/ThemeProvider';
import instantImage from '../../src/assets/landing/anime-instant.jpg';
import immediateImage from '../../src/assets/landing/anime-immediate.jpg';
import spellingImage from '../../src/assets/landing/anime-spelling.jpg';

const weakCards = [
  { id: 'recap-weak-1', word: 'meticulous', normalizedWord: 'meticulous', translation: 'tỉ mỉ', explanation: '', phonetic: '', emoji: '📝', category: 'Visual acceptance', audioUrl: null, imageUrl: null, language: 'en' },
  { id: 'recap-weak-2', word: 'resilient', normalizedWord: 'resilient', translation: 'kiên cường', explanation: '', phonetic: '', emoji: '💪', category: 'Visual acceptance', audioUrl: null, imageUrl: null, language: 'en' },
  { id: 'recap-weak-3', word: 'nuance', normalizedWord: 'nuance', translation: 'sắc thái', explanation: '', phonetic: '', emoji: '🎨', category: 'Visual acceptance', audioUrl: null, imageUrl: null, language: 'en' },
];

const promotedCard = (id: string, word: string, translation: string, imageUrl: string) => ({
  id, word, normalizedWord: word, translation, explanation: '', phonetic: '', emoji: '', category: 'Visual acceptance', audioUrl: null, imageUrl, language: 'en',
});

const promotions = [
  { card: promotedCard('recap-up-1', 'Instant', 'Khoảnh khắc', instantImage), from: 'learning', to: 'mastered' },
  { card: promotedCard('recap-up-2', 'Immediate', 'Ngay lập tức', immediateImage), from: 'new', to: 'learning' },
  { card: promotedCard('recap-up-3', 'Spelling', 'Cách đánh vần', spellingImage), from: 'new', to: 'learning' },
] as const;

// The recap reads tomorrow's due count through its loader; the fixture answers it the way the
// signed-in learner's library would, so the Next review slot shows a ready count.
const loadTomorrowDue = () => Promise.resolve(8);

// `?goal=` picks the exam goal the learner has: an IELTS goal with enough history for a pace
// ("ready"), an IELTS goal just started ("little"), or none ("none", the default), where the
// panel renders nothing. The counts stand in for the path progress the app reads.
const ieltsGoals: Record<string, IeltsGoalModelInput> = {
  ready: {
    counts: { total: 100, started: 86, mastered: 78, masteredLast7: 2 },
    goal: { kind: IELTS_GOAL_KIND, level: '7.0', targetDate: '2026-12-19' },
    latestScore: '6.5', today: '2026-11-19',
  },
  little: {
    counts: { total: 100, started: 4, mastered: 0, masteredLast7: 0 },
    goal: { kind: IELTS_GOAL_KIND, level: '7.0', targetDate: null },
    latestScore: null, today: '2026-11-19',
  },
};
const goalInput = ieltsGoals[new URLSearchParams(window.location.search).get('goal') ?? 'none'];
const goalModel = goalInput ? buildIeltsGoalModel(goalInput) : null;

// `?variant=next` shows the "What next?" row. The reminder stands in for the learner's saved
// settings (on at 08:00 unless `?reminder=off`), and every action is recorded on the page so a test
// can see which one a click reached.
const params = new URLSearchParams(window.location.search);
const variantNext = params.get('variant') === 'next';
const recordAction = (action: string) => {
  const actions = (document.body.dataset.recapActions ?? '').split(' ').filter(Boolean);
  document.body.dataset.recapActions = [...actions, action].join(' ');
};
const reminderSettings = (push: boolean): ReminderSettings => ({
  days: [1, 2, 3, 4, 5, 6, 0], sendAtLocal: '08:00', timezone: 'Asia/Saigon', locale: 'en', quietHours: null,
  onlyIfNotStudiedToday: true, channels: { push, emailDigest: false },
});
const reminderSnapshot = (push: boolean): SessionRecapReminder => ({ enabled: push, sendAtLocal: '08:00', canEnable: true, settings: reminderSettings(push) });
const fixtureReminder: SessionRecapReminderPort = {
  load: () => Promise.resolve(reminderSnapshot(params.get('reminder') !== 'off')),
  setEnabled: (_current, enabled) => {
    recordAction(enabled ? 'reminder-on' : 'reminder-off');
    return Promise.resolve(reminderSnapshot(enabled));
  },
};

function RecapFixture() {
  const locale = useUiLocale();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void Promise.all([loadCatalog(locale, 'practice'), loadCatalog(locale, 'today')]).then(() => setReady(true));
  }, [locale]);
  if (!ready) return null;

  return <SessionRecapModal
    open
    onClose={() => undefined}
    onRetryWeak={() => recordAction('retry')}
    onViewWeeklyRecap={() => recordAction('weekly')}
    totalCards={12}
    goodCount={10}
    againCount={2}
    xpEarned={175}
    weakCards={weakCards}
    promotions={promotions}
    streakDays={13}
    bestRun={9}
    returnsToToday
    loadTomorrowDue={loadTomorrowDue}
    goalPanel={goalModel ? <IeltsGoalPanelView model={goalModel} onOpenPath={() => undefined} /> : null}
    {...(variantNext ? { variant: 'next' as const, wordMatchCount: 6, onPlayWordMatch: () => recordAction('match'), reminder: fixtureReminder } : {})}
  />;
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <I18nProvider>
      <RecapFixture />
    </I18nProvider>
  </ThemeProvider>,
);
