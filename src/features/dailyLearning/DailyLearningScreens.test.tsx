import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup as renderReactToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LessonScreen } from './LessonScreen';
import { PlacementScreen } from './PlacementScreen';
import { ProgressScreen } from './ProgressScreen';
import { TodayScreen } from './TodayScreen';
import { dailyTodayStatus, isCaughtUpDailyPlan } from './DailyLearningWorkspace';
import type { DailyPlan } from './dailyPlan';
import { messages as enToday } from '../../i18n/locales/en/today.po';
import { messages as viToday } from '../../i18n/locales/vi/today.po';
import { expandPseudoCatalog } from '../../i18n/pseudo';
import { ThemeProvider } from '../theme/ThemeProvider';
import { shouldUseListenPilot } from './dailyLearningPresentation';
import type {
  LessonScreenActions,
  LessonScreenModel,
  PlacementScreenActions,
  PlacementScreenModel,
  ProgressScreenModel,
  TodayScreenActions,
  TodayScreenModel,
} from './dailyLearningPresentation';
import { evidencedStudyStreak, reviewFeedbackCue } from './dailyLearningPresentation';

i18n.load('en', enToday);
i18n.activate('en');

const renderToStaticMarkup = (node: ReactNode) => renderReactToStaticMarkup(<I18nProvider i18n={i18n}>{node}</I18nProvider>);

const todayActions: TodayScreenActions = {
  openVocabulary: vi.fn(),
  openPaths: vi.fn(),
  retry: vi.fn(),
  startSession: vi.fn(),
  continueReview: vi.fn(),
  startDailyPlan: vi.fn(),
  startLesson: vi.fn(),
  startRecommended: vi.fn(),
  startPlacement: vi.fn(),
  openMorePractice: vi.fn(),
};

const readyToday: TodayScreenModel = {
  status: 'ready',
  isOffline: false,
  message: 'Your plan is ready.',
  plan: { total: 12, due: 4, weak: 3, fresh: 5, isShort: false },
  placementAvailable: true,
  recommendation: { activityId: 'activity-1', mode: 'active-recall', reason: 'Review due' },
};

const caughtUpToday: TodayScreenModel = {
  status: 'caught-up',
  isOffline: false,
  message: 'No due or new cards are available in this daily plan.',
  courseLabel: 'English ← Vietnamese',
  plan: { total: 0, due: 0, weak: 0, fresh: 0, isShort: true },
  placementAvailable: false,
  caughtUp: {},
};

const lessonActions: LessonScreenActions = {
  chooseAnswer: vi.fn(),
  changeTextAnswer: vi.fn(),
  toggleSentenceToken: vi.fn(),
  playAudio: vi.fn(),
  submitAnswer: vi.fn(),
  rate: vi.fn(),
  retryRating: vi.fn(),
  exit: vi.fn(),
  finish: vi.fn(),
};

const choiceLesson: LessonScreenModel = {
  status: 'answering',
  mode: 'recognition',
  modeLabel: 'Recognition',
  progress: { current: 1, total: 10 },
  prompt: 'Choose the Vietnamese meaning of “analysis”.',
  promptLanguage: 'en',
  answer: {
    kind: 'choice',
    selectedId: null,
    options: [
      { id: 'a', label: 'sự phân tích', language: 'vi' },
      { id: 'b', label: 'sự tổng hợp', language: 'vi' },
    ],
  },
  canSubmit: false,
  liveMessage: 'Question 1 of 10.',
};

const placementActions: PlacementScreenActions = {
  start: vi.fn(),
  chooseAnswer: vi.fn(),
  submitAnswer: vi.fn(),
  retry: vi.fn(),
  openPaths: vi.fn(),
  exit: vi.fn(),
};

describe('TodayScreen', () => {
  it('explains the connection loss when an offline day has no loaded plan', () => {
    const empty: TodayScreenModel = { status: 'empty', isOffline: true, message: 'No cards are due.', plan: null, placementAvailable: false };
    const html = renderToStaticMarkup(<TodayScreen model={empty} actions={todayActions} />);
    expect(html).toContain("You&#x27;re offline. Reconnect to start today&#x27;s session.");
    expect(html).not.toContain('>Start today&#x27;s session<');
  });

  it('shows sleepy Lumi on an empty Crystal day only when the preference allows it', () => {
    const empty: TodayScreenModel = { status: 'empty', isOffline: false, message: 'No cards are due.', plan: null, placementAvailable: false };
    const renderWithPreference = (family: string, lumi: string) => {
      vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'sonflash_theme_family' ? family : key === 'sonflash_lumi_enabled' ? lumi : null });
      return renderToStaticMarkup(<ThemeProvider><TodayScreen model={empty} actions={todayActions} /></ThemeProvider>);
    };
    try {
      expect(renderWithPreference('crystal', 'true')).toContain('data-lumi-pose="sleepy"');
      expect(renderWithPreference('crystal', 'false')).not.toContain('data-lumi-pose="sleepy"');
      expect(renderWithPreference('classic', 'true')).not.toContain('data-lumi-pose="sleepy"');
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('uses the VOA pilot only for explicit manual or direct listening routes', () => {
    expect(shouldUseListenPilot('listening', false, true)).toBe(false);
    expect(shouldUseListenPilot('listening', true, true)).toBe(true);
    expect(shouldUseListenPilot('listening', true, false)).toBe(false);
  });

  it('keeps the daily action dominant and exposes only three direct practice shortcuts', () => {
    const html = renderToStaticMarkup(<TodayScreen model={readyToday} actions={todayActions} />);

    expect(html).toContain('aria-labelledby="daily-today-heading"');
    expect(html).toContain('<h1');
    expect(html).toContain('Today');
    expect(html).toContain('Today: 12 items ready to remember.');
    expect(html).toContain('4 due');
    expect(html).toContain('3 weak');
    expect(html).toContain('5 new');
    for (const label of ['Recognition', 'Active recall', 'Listening']) {
      expect(html).toContain(label);
    }
    for (const label of ['Spelling', 'Cloze', 'Sentence building']) expect(html).toContain(label);
    expect(html).toContain("Start today&#x27;s session");
    expect(html).toContain('Take placement check');
    expect(html).toContain('data-primary-learning-action="true"');
    expect(html).toContain('More practice');
    expect(html).toContain('More lesson modes');
    expect(html).toContain('Recommended next');
    expect(html).toContain('Review due · Active recall');
    expect(html).toContain('data-recommended-next-action="true"');
    expect(html.match(/data-practice-mode="true"/g)).toHaveLength(3);
    expect(html.match(/data-practice-catalog-mode="true"/g)).toHaveLength(3);
    expect(html).toContain('min-h-24 rounded-xl');
  });

  it('uses the real preview card and planned stage counts without inventing progress metrics', () => {
    const html = renderToStaticMarkup(<TodayScreen model={{
      ...readyToday,
      previewCard: {
        word: 'serendipity',
        translation: 'sự tình cờ thú vị',
        phonetic: '/ˌserənˈdipitē/',
        category: 'Noun',
        imageUrl: 'https://images.example.test/serendipity.jpg',
        language: 'en',
        translationLanguage: 'vi',
      },
      sessionStages: [
        { id: 'review', count: 7, skipped: false },
        { id: 'new', count: 5, skipped: false },
        { id: 'match', count: 4, skipped: false },
        { id: 'recap', count: 0, skipped: false },
      ],
    }} actions={todayActions} />);

    expect(html).toContain('data-today-preview="true"');
    expect(html).toContain('serendipity');
    expect(html).toContain('sự tình cờ thú vị');
    expect(html).toContain('data-stage-id="match" data-stage-count="4"');
    expect(html).toContain('data-stage-id="recap" data-stage-count="0"');
    expect(html).not.toContain('IELTS');
    expect(html).not.toContain('XP');
    expect(html).not.toContain('league');
  });

  it('keeps the Crystal ready state visibly anchored by Lumi and all four stages', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => ({ sonflash_theme_family: 'crystal', sonflash_lumi_enabled: 'true' })[key] ?? null,
    });
    try {
      const html = renderToStaticMarkup(<ThemeProvider><TodayScreen model={{
        ...readyToday,
        sessionStages: [
          { id: 'review', count: 7, skipped: false },
          { id: 'new', count: 5, skipped: false },
          { id: 'match', count: 0, skipped: true },
          { id: 'recap', count: 0, skipped: false },
        ],
      }} actions={todayActions} /></ThemeProvider>);
      expect(html).toContain('data-today-lumi="hero"');
      expect(html).toContain('data-lumi-pose="idle"');
      for (const stage of ['review', 'new', 'match', 'recap']) expect(html).toContain(`data-stage-id="${stage}"`);
      expect(html).toContain('Skipped');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('always launches the sequenced session from the primary action, whether or not reviews are due', () => {
    const html = renderToStaticMarkup(
      <TodayScreen
        model={{ ...readyToday, plan: { total: 6, due: 0, weak: 2, fresh: 4, isShort: true } }}
        actions={todayActions}
      />,
    );

    expect(html).toContain('data-primary-learning-action="true"');
    expect(html).toContain("Start today&#x27;s session");
    expect(html).not.toContain('Continue review');
    expect(html).toContain('data-journey-action="learn"');
  });

  it('keeps the Start branch visible when Match is the only available session stage', () => {
    const dailyPlan = { items: [], counts: { total: 0, due: 0, weak: 0, new: 0 }, isShort: true } satisfies DailyPlan;
    const plan = { total: 0, due: 0, weak: 0, fresh: 0, isShort: true };
    const matchOnlySession = true;
    const caughtUp = isCaughtUpDailyPlan(dailyPlan, true, matchOnlySession);
    const model: TodayScreenModel = {
      ...readyToday,
      status: dailyTodayStatus('ready', dailyPlan, true, matchOnlySession, false),
      plan,
      sessionStages: [
        { id: 'review', count: 0, skipped: true },
        { id: 'new', count: 0, skipped: true },
        { id: 'match', count: 4, skipped: false },
        { id: 'recap', count: 0, skipped: false },
      ],
      ...(caughtUp ? { caughtUp: {} } : {}),
    };

    const html = renderToStaticMarkup(<TodayScreen model={model} actions={todayActions} />);
    expect(model.status).toBe('ready');
    expect(caughtUp).toBe(false);
    expect(html).toContain('data-primary-learning-action="true"');
    expect(html).not.toContain('data-today-caught-up="true"');
    expect(html).toContain('aria-label="Today: 4 items ready to remember."');
    expect(html).toContain('class="today-ready-total" aria-hidden="true">4</span>');
    expect(html).toContain('data-stage-id="match" data-stage-count="4"');
  });

  it('does not call a target-only pool caught up when the active language pair is empty', () => {
    const dailyPlan = { items: [], counts: { total: 0, due: 0, weak: 0, new: 0 }, isShort: true } satisfies DailyPlan;
    const model: TodayScreenModel = {
      ...readyToday,
      status: dailyTodayStatus('ready', dailyPlan, false, false, false),
      message: 'Add vocabulary or return when a reviewed card is due.',
      plan: { total: 0, due: 0, weak: 0, fresh: 0, isShort: true },
    };
    const html = renderToStaticMarkup(<TodayScreen model={model} actions={todayActions} />);

    expect(isCaughtUpDailyPlan(dailyPlan, false, false)).toBe(false);
    expect(model.status).toBe('empty');
    expect(html).toContain('Add vocabulary');
    expect(html).not.toContain('data-primary-learning-action="true"');
  });

  it('offers bounded word-session choices and labels the primary action with the default target', () => {
    const html = renderToStaticMarkup(<TodayScreen model={readyToday} actions={todayActions} />);

    expect(html).toContain('Practice length');
    for (const target of [5, 10, 15]) {
      expect(html).toContain(`>${target}</button>`);
    }
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Start selected practice');
  });

  it('exposes the Learn to Immerse to Communicate journey with existing practice entry points', () => {
    const html = renderToStaticMarkup(<TodayScreen model={readyToday} actions={todayActions} />);

    expect(html).toContain('data-learning-journey="true"');
    expect(html).toContain('Learn');
    expect(html).toContain('Immerse');
    expect(html).toContain('Communicate');
    expect(html).toContain('data-journey-action="learn"');
    expect(html).toContain('data-journey-action="immerse"');
    expect(html).toContain('data-journey-action="communicate"');
    expect(html).toContain('aria-label="Learn: review due words"');
    expect(html).toContain('aria-label="Immerse: start listening practice"');
    expect(html).toContain('aria-label="Communicate: open text, Story, or Shadowing practice"');
    expect(html).toContain('aria-label="Communicate: go to Vocabulary tools for AI Dialogue"');
    expect(html).toContain('Review due words');
    expect(html).toContain('Start listening practice');
    expect(html).toContain('Use a bounded text mission, story, or shadowing practice with your vocabulary.');
    expect(html).toContain('Open communication practice');
    expect(html).toContain('Go to Vocabulary tools for AI Dialogue');
  });

  it('keeps the journey visible for an empty plan without offering unavailable activities', () => {
    const html = renderToStaticMarkup(
      <TodayScreen
        model={{ status: 'empty', isOffline: false, message: 'Add vocabulary to make a plan.', plan: null, placementAvailable: false }}
        actions={todayActions}
      />,
    );

    expect(html).toContain('data-learning-journey="true"');
    expect(html).toContain('aria-label="Learn: add vocabulary"');
    expect(html).toContain('Available after your first plan');
    expect(html).toMatch(/data-journey-action="immerse"[^>]+disabled=""/);
    expect(html).toMatch(/data-journey-action="communicate"[^>]+disabled=""/);
    expect(html).toMatch(/data-journey-action="communicate-ai"[^>]+disabled=""/);
  });

  it('keeps explicitly supplied Listen pilot availability for empty and signed-out Today', () => {
    const html = renderToStaticMarkup(
      <TodayScreen
        model={{ status: 'empty', isOffline: false, message: 'Add vocabulary to make a plan.', plan: null, placementAvailable: false, listenPilotAvailable: true }}
        actions={todayActions}
      />,
    );

    expect(html).toContain('aria-label="Immerse: start listening practice"');
    expect(html).not.toMatch(/data-journey-action="immerse"[^>]+disabled=""/);
    expect(html).toContain('Start listening practice');
  });

  it('keeps Immerse disabled when the Listen pilot is unavailable', () => {
    const html = renderToStaticMarkup(
      <TodayScreen
        model={{ ...readyToday, listenPilotAvailable: false }}
        actions={todayActions}
      />,
    );

    expect(html).toMatch(/data-journey-action="immerse"[^>]+disabled=""/);
    expect(html).toContain('Available after your first plan');
  });

  it.each([
    [{ status: 'empty', isOffline: false, message: 'Add vocabulary to make a plan.', plan: null, placementAvailable: false } satisfies TodayScreenModel, 'Add vocabulary'],
    [{ status: 'error', isOffline: false, message: 'The plan could not be prepared.', plan: null, placementAvailable: false } satisfies TodayScreenModel, 'Try again'],
    [{ ...readyToday, status: 'offline', isOffline: true, message: 'Using your saved practice pool.' } satisfies TodayScreenModel, "You&#x27;re offline. Reconnect to start today&#x27;s session."],
    [{ ...readyToday, plan: { total: 7, due: 3, weak: 2, fresh: 2, isShort: true }, message: 'A shorter plan is ready.' } satisfies TodayScreenModel, 'Short plan'],
  ])('renders the %s outcome honestly', (model, expected) => {
    const html = renderToStaticMarkup(<TodayScreen model={model} actions={todayActions} />);
    expect(html).toContain(expected);
  });

  it('gives an onboarding learner two explicit next steps without focusing on mount', () => {
    const html = renderToStaticMarkup(<TodayScreen
      model={{ status: 'empty', isOffline: false, message: 'Add vocabulary to make a plan.', plan: null, placementAvailable: false }}
      actions={todayActions}
    />);

    expect(html).toContain('Add vocabulary');
    expect(html).toContain('Explore learning paths');
    expect(html).not.toContain('autofocus');
  });

  it.each([
    ['classic', 'light'],
    ['classic', 'dark'],
    ['crystal', 'light'],
    ['crystal', 'dark'],
  ])('renders the caught-up state in the %s %s theme without invented review facts', (family, mode) => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => ({
        sonflash_theme_family: family,
        lingoflash_theme: mode,
        sonflash_lumi_enabled: 'false',
      })[key] ?? null,
    });
    try {
      const html = renderToStaticMarkup(<ThemeProvider><TodayScreen model={caughtUpToday} actions={todayActions} /></ThemeProvider>);

      expect(html).toContain('data-today-caught-up="true"');
      expect(html).toContain('class="today-caught-up-panel');
      expect(html).toContain('All caught');
      expect(html).toContain('No due or new cards are available in this daily plan.');
      expect(html).toContain('Add vocabulary');
      expect(html).not.toContain('disabled=""');
      expect(html).toContain('aria-describedby="today-caught-up-learn-reason"');
      expect(html).toContain('id="today-caught-up-learn-reason"');
      expect(html).toContain('Browse paths');
      expect(html).not.toContain('Next review');
      expect(html).not.toContain('8 cards');
      expect(html).not.toContain('data-lumi-pose="happy"');
      if (family === 'crystal') {
        expect(html).toContain('today-caught-up-panel--crystal');
        expect(html).toContain('viewBox="0 0 100 100"');
        expect(html).toContain('fill="#7a0820"');
        expect(html).toContain('today-caught-up-gold');
      }
      else {
        expect(html).toContain(`today-caught-up-${mode}-accent`);
        expect(html).toContain('today-caught-up-seal');
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('renders next-review metadata only when an explicit complete-pool fixture supplies it', () => {
    const html = renderToStaticMarkup(<TodayScreen
      model={{ ...caughtUpToday, caughtUp: { nextReview: { label: 'tomorrow, 08:00', cardCount: 8 } } }}
      actions={todayActions}
    />);

    expect(html).toContain('Next review tomorrow, 08:00 · 8 cards');
    expect(html).toContain('No new cards are available in this daily plan.');
  });

  it('keeps the crystal completion message and actions available when Lumi is enabled with reduced-motion-safe decoration', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => ({ sonflash_theme_family: 'crystal', sonflash_lumi_enabled: 'true' })[key] ?? null,
    });
    try {
      const html = renderToStaticMarkup(<ThemeProvider><TodayScreen model={caughtUpToday} actions={todayActions} /></ThemeProvider>);

      expect(html).toContain('data-lumi-pose="happy"');
      expect(html).toContain('motion-reduce:animate-none');
      expect(html).toContain('No due or new cards are available in this daily plan.');
      expect(html).toContain('Browse paths');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('LessonScreen', () => {
  it('exposes the active immersive lesson shell, controls, and progress semantics', () => {
    const html = renderToStaticMarkup(<LessonScreen model={choiceLesson} actions={lessonActions} />);

    expect(html).toContain('data-session-shell="lesson"');
    expect(html).toContain('Exit lesson');
    expect(html).toContain('Switch light and dark mode');
    expect(html).toContain('aria-label="Lesson progress"');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="10"');
    expect(html).toContain('aria-valuenow="1"');
  });

  it('keeps the immersive shell through the completion action', () => {
    const html = renderToStaticMarkup(<LessonScreen model={{ ...choiceLesson, status: 'complete' }} actions={lessonActions} />);
    expect(html).toContain('aria-labelledby="daily-lesson-heading"');
    expect(html).not.toContain('data-session-shell="lesson"');
    expect(html).toContain('Back to Today');
  });

  it('wires text-answer submissions through the shared IME guard', () => {
    const source = readFileSync(fileURLToPath(new URL('./LessonScreen.tsx', import.meta.url)), 'utf8');

    expect(source).toContain("import { createImeSubmitGuard } from '../../lib/imeSubmitGuard'");
    expect(source).toContain('shouldBlockSubmit(event.nativeEvent');
    expect(source).toContain('onCompositionEnd={imeSubmitGuard.onCompositionEnd}');
    expect(source).toContain('shouldBlockKeyDown(event.nativeEvent)');
    expect(source).toContain('onPointerDown={() => { pointerSubmit.current = true;');
  });

  it('keeps study guidance visible when Lumi is disabled', () => {
    vi.stubGlobal('localStorage', { getItem: (key: string) => ({ sonflash_theme_family: 'crystal', sonflash_lumi_enabled: 'false' })[key] ?? null });
    try {
      const html = renderToStaticMarkup(<ThemeProvider><LessonScreen model={choiceLesson} actions={lessonActions} /></ThemeProvider>);

      expect(html).toContain('Take your time. One clear answer at a time.');
      expect(html).not.toContain('data-lumi-pose=');
      expect(html).toContain('Submit answer');
      expect(html).toContain('Switch light and dark mode');
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('shows a new-card introduction with explicit guided and test-now actions', () => {
    const html = renderToStaticMarkup(<LessonScreen
      model={{
        ...choiceLesson,
        status: 'introduction',
        mode: 'active-recall',
        modeLabel: 'Introduction',
        card: { word: 'allocate', translation: 'phân bổ', explanation: 'Set aside for a purpose.' },
        answer: { kind: 'text', value: '', label: 'Vocabulary' },
        canSubmit: false,
        liveMessage: 'Learn this word before recalling it.',
      }}
      actions={lessonActions}
    />);

    expect(html).toContain('allocate');
    expect(html).toContain('phân bổ');
    expect(html).toContain('I don&#x27;t know this yet');
    expect(html).toContain('I already know it — test me');
    expect(html).not.toContain('Submit answer');
  });

  it('renders introduction audio only when the card has usable audio', () => {
    const model: LessonScreenModel = {
      ...choiceLesson,
      status: 'introduction',
      mode: 'listening',
      modeLabel: 'Introduction',
      card: { word: 'listen', translation: 'nghe' },
      answer: { kind: 'text', value: '', label: 'Vocabulary' },
      canSubmit: false,
      canPlayAudio: true,
      liveMessage: 'Learn this word before recalling it.',
    };
    const withAudio = renderToStaticMarkup(<LessonScreen model={model} actions={lessonActions} />);
    const withoutAudio = renderToStaticMarkup(<LessonScreen model={{ ...model, canPlayAudio: false }} actions={lessonActions} />);

    expect(withAudio).toContain('Play audio');
    expect(withoutAudio).not.toContain('Play audio');
  });

  it('shows guided card support and continues to independent recall without ratings', () => {
    const html = renderToStaticMarkup(<LessonScreen
      model={{
        ...choiceLesson,
        status: 'guided',
        mode: 'listening',
        modeLabel: 'Guided practice',
        card: { word: 'listen', translation: 'nghe', exampleSentence: 'Listen carefully.' },
        answer: { kind: 'text', value: '', label: 'Guided practice' },
        canSubmit: false,
        liveMessage: 'Review the word, then continue to recall.',
      }}
      actions={lessonActions}
    />);

    expect(html).toContain('Guided practice');
    expect(html).toContain('Listen carefully.');
    expect(html).toContain('Continue to independent recall');
    expect(html).not.toContain('How well did you remember?');
  });

  it('does not expose answer correctness or the expected answer before submission', () => {
    const html = renderToStaticMarkup(<LessonScreen model={choiceLesson} actions={lessonActions} />);

    expect(html).toContain('Question 1 of 10');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('Submit answer');
    expect(html).not.toContain('Correct answer');
    expect(html).not.toContain('Not quite');
    expect(html).not.toContain('Again');
  });

  it('asks for an explicit FSRS rating only after feedback and identifies correctness with text', () => {
    const model: LessonScreenModel = {
      ...choiceLesson,
      status: 'feedback',
      feedback: {
        outcome: 'incorrect',
        message: 'Not quite.',
        expectedAnswer: 'sự phân tích',
        answerLanguage: 'vi',
        explanation: 'Analysis means a careful study.',
      },
      canSubmit: false,
      liveMessage: 'Not quite. Review the answer, then rate your recall.',
    };
    const html = renderToStaticMarkup(<LessonScreen model={model} actions={lessonActions} />);

    expect(html).toContain('role="status"');
    expect(html).toContain('Not quite.');
    expect(html).toContain('Correct answer');
    expect(html).toContain('lang="vi"');
    expect(html).toContain('How well did you remember?');
    expect(html).toContain('<fieldset class="mt-6" disabled="">');
    expect(html).toContain('<fieldset class="mt-5">');
    for (const rating of ['Again', 'Hard', 'Good', 'Easy']) expect(html).toContain(rating);
    expect(html).not.toContain('>Next<');
  });

  it('keeps rating failures actionable without advancing the item', () => {
    const html = renderToStaticMarkup(
      <LessonScreen
        model={{
          ...choiceLesson,
          status: 'rating-error',
          feedback: { outcome: 'correct', message: 'Correct.', expectedAnswer: 'sự phân tích', answerLanguage: 'vi' },
          errorMessage: 'Your rating was not saved. This question is still open.',
          canSubmit: false,
          liveMessage: 'Rating save failed.',
        }}
        actions={lessonActions}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('This question is still open.');
    expect(html).toContain('Retry saving rating');
  });

  it('renders text and repeated sentence-token controls with labels and occurrence ids', () => {
    const textHtml = renderToStaticMarkup(
      <LessonScreen
        model={{ ...choiceLesson, mode: 'spelling', modeLabel: 'Spelling', answer: { kind: 'text', value: '', label: 'Type the word' } }}
        actions={lessonActions}
      />,
    );
    const sentenceHtml = renderToStaticMarkup(
      <LessonScreen
        model={{
          ...choiceLesson,
          mode: 'sentence-building',
          modeLabel: 'Sentence building',
          answer: {
            kind: 'sentence',
            tokens: [
              { occurrenceId: 'the-1', label: 'the', isSelected: false },
              { occurrenceId: 'word-1', label: 'word', isSelected: true },
              { occurrenceId: 'the-2', label: 'the', isSelected: false },
            ],
            selectedOrder: [{ occurrenceId: 'word-1', label: 'word', isSelected: true }],
          },
        }}
        actions={lessonActions}
      />,
    );

    expect(textHtml).toContain('<label');
    expect(textHtml).toContain('Type the word');
    expect(sentenceHtml).toContain('data-occurrence-id="the-1"');
    expect(sentenceHtml).toContain('data-occurrence-id="the-2"');
    expect(sentenceHtml).toContain('aria-pressed="true"');
    expect(sentenceHtml).toContain('Your sentence');
    expect(sentenceHtml).toContain('1. word');
  });

  it('gives every question and its reveal a GSAP entrance, collapsed for reduced motion', () => {
    const questionHtml = renderToStaticMarkup(<LessonScreen model={choiceLesson} actions={lessonActions} />);
    expect(questionHtml).toContain('data-gsap-entrance="step"');
    expect(questionHtml).not.toContain('data-gsap-entrance="feedback"');

    const feedbackHtml = renderToStaticMarkup(<LessonScreen model={{
      ...choiceLesson,
      status: 'feedback',
      feedback: { outcome: 'correct', message: 'Correct.', expectedAnswer: 'sự phân tích', answerLanguage: 'vi' },
      canSubmit: false,
    }} actions={lessonActions} />);
    expect(feedbackHtml).toContain('data-gsap-entrance="step"');
    expect(feedbackHtml).toContain('data-gsap-entrance="feedback"');
  });

  it('routes the reveal cue and the rating tap through the shared, already-gated haptics/sound helpers', () => {
    // No jsdom/testing-library in this repo's toolchain (see AppShellMotion.test.ts for the
    // same pattern), so this proves the wiring exists without bypassing the gated helpers —
    // the actual sound-off/haptics-off/reduced-motion gating is covered where those helpers
    // live: haptics.test.ts, interactionSounds.test.ts and motion.test.ts.
    const source = readFileSync(fileURLToPath(new URL('./LessonScreen.tsx', import.meta.url)), 'utf8');
    expect(source).toContain("import { triggerHaptic } from '../../lib/haptics'");
    expect(source).toContain("import { playSuccessSound } from '../../lib/interactionSounds'");
    expect(source).toContain('const cue = reviewFeedbackCue(model.feedback.outcome)');
    expect(source).toContain('if (cue.playSound) playSuccessSound()');
    expect(source).toContain('triggerHaptic(cue.haptic)');
    expect(source).toContain("triggerHaptic('light'); actions.rate(rating.id)");
    expect(source).not.toContain('navigator.vibrate');
  });
});

describe('PlacementScreen', () => {
  it('keeps the diagnostic guidance visible when Lumi is disabled', () => {
    vi.stubGlobal('localStorage', { getItem: (key: string) => ({ sonflash_theme_family: 'crystal', sonflash_lumi_enabled: 'false' })[key] ?? null });
    const model: PlacementScreenModel = {
      status: 'question',
      message: 'Question 1 of 8.',
      current: 1,
      total: 8,
      prompt: 'Choose the closest meaning.',
      promptLanguage: 'en',
      selectedId: null,
      options: [{ id: 'a', label: 'First meaning' }, { id: 'b', label: 'Second meaning' }],
    };
    try {
      const html = renderToStaticMarkup(<ThemeProvider><PlacementScreen model={model} actions={placementActions} /></ThemeProvider>);

      expect(html).toContain('There is no score here. Choose what feels most familiar.');
      expect(html).not.toContain('data-lumi-pose=');
      expect(html).toContain('Submit answer');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports insufficient evidence without manufacturing a tier', () => {
    const model: PlacementScreenModel = {
      status: 'insufficient',
      message: 'At least 6 unique words with CEFR evidence are required.',
      eligibleCount: 4,
      requiredCount: 6,
    };
    const html = renderToStaticMarkup(<PlacementScreen model={model} actions={placementActions} />);

    expect(html).toContain('Not enough evidence');
    expect(html).toContain('4 of 6 eligible words');
    expect(html).not.toMatch(/Recommended path.*Foundation|Recommended path.*Core|Recommended path.*Advanced/s);
    expect(html).toContain('Open Paths');
  });

  it('presents a diagnostic recommendation and confidence without claiming an official score', () => {
    const model: PlacementScreenModel = {
      status: 'result',
      message: 'Your answers suggest starting here.',
      recommendation: 'core',
      recommendationLabel: 'Core',
      confidence: 'medium',
      answeredCount: 8,
      correctCount: 6,
    };
    const html = renderToStaticMarkup(<PlacementScreen model={model} actions={placementActions} />);

    expect(html).toContain('Recommended path');
    expect(html).toContain('Core');
    expect(html).toContain('Medium confidence');
    expect(html).toContain('diagnostic guide');
    expect(html).toContain('does not change your review history');
    expect(html).not.toMatch(/official IELTS|official TOEIC/i);
  });
});

describe('ProgressScreen', () => {
  it('provides an accessible lazy workspace boundary for existing progress content', () => {
    const model: ProgressScreenModel = {
      status: 'ready',
      message: 'Progress is calculated from your learning history.',
      reviewed: 42,
      mastered: 12,
      dueToday: 5,
      isOffline: true,
      hasVocabulary: true,
    };
    const html = renderToStaticMarkup(
      <ProgressScreen model={model} actions={{ startReview: vi.fn(), openVocabulary: vi.fn() }}><div data-testid="existing-insights">Existing insights</div></ProgressScreen>,
    );

    expect(html).toContain('aria-labelledby="daily-progress-heading"');
    expect(html).toContain('Progress');
    expect(html).toContain('Reviewed');
    expect(html).toContain('Mastered');
    expect(html).toContain('Due today');
    expect(html).toContain('<span class="sr-only">42</span>');
    expect(html).toContain('Review 5 due words');
    expect(html).toContain('data-primary-learning-action="true"');
    expect(html).toContain('You’re offline. Reconnect to review and save your progress.');
    expect(html).toContain('Existing insights');
  });

  it('keeps progress metrics as supporting evidence beneath the next action', () => {
    const html = renderToStaticMarkup(
      <ProgressScreen
        model={{ status: 'ready', message: 'Progress is calculated from your learning history.', reviewed: 42, mastered: 12, dueToday: 5, isOffline: false, hasVocabulary: true }}
        actions={{ startReview: vi.fn(), openVocabulary: vi.fn() }}
      />,
    );

    expect(html).toContain('data-progress-evidence="true"');
    expect(html).toContain('Supporting evidence');
    expect(html).not.toContain('bento-stat-card');
    expect(html.indexOf('data-primary-learning-action="true"')).toBeLessThan(html.indexOf('data-progress-evidence="true"'));
  });
});

describe('daily learning presentation boundaries', () => {
  it('shows a study streak only with activity recorded on the current day', () => {
    const now = new Date('2026-10-03T00:30:00.000Z');
    const today = '2026-10-03';
    const yesterday = '2026-10-02';
    expect(evidencedStudyStreak(1, [], now)).toBe(0);
    expect(evidencedStudyStreak(4, [{ date: yesterday, XP: 20 }], now)).toBe(0);
    expect(evidencedStudyStreak(4, [{ date: today, XP: 0 }], now)).toBe(0);
    expect(evidencedStudyStreak(4, [{ date: today, XP: 20 }], now)).toBe(4);
  });

  it('uses the learner reward timezone for ISO XP history dates', () => {
    const now = new Date('2026-10-03T00:30:00.000Z');
    const history = [{ date: '2026-10-02', XP: 20 }];
    expect(evidencedStudyStreak(4, history, now, 'America/Los_Angeles')).toBe(4);
    expect(evidencedStudyStreak(4, history, now)).toBe(0);
  });

  it('rewards a correct reveal with sound and a success haptic, and a wrong one with a haptic nudge only', () => {
    expect(reviewFeedbackCue('correct')).toEqual({ playSound: true, haptic: 'success' });
    expect(reviewFeedbackCue('incorrect')).toEqual({ playSound: false, haptic: 'warning' });
  });

  it.each([
    ['en', enToday],
    ['vi', viToday],
    ['en-XA', expandPseudoCatalog(enToday)],
  ])('renders the daily count with the %s UI catalog', (locale, messages) => {
    i18n.load(locale, messages);
    i18n.activate(locale);
    try {
      const html = renderToStaticMarkup(<TodayScreen model={readyToday} actions={todayActions} />);
      expect(html).toContain(`aria-label="${i18n._('today.title')}: 12 ${i18n._('today.canvas.ready', { count: 12 })}"`);
      expect(html).toContain('data-primary-learning-action="true"');
      if (locale === 'vi') expect(html).not.toContain('12 items are sequenced');
      if (locale === 'en-XA') expect(html).toContain('[');
    } finally {
      i18n.activate('en');
    }
  });

  it.each(['ja', 'ko'])('keeps %s target text language separate from the UI locale', language => {
    const html = renderToStaticMarkup(<LessonScreen model={{
      ...choiceLesson,
      prompt: language === 'ja' ? '日本語' : '한국어',
      promptLanguage: language,
      answer: { kind: 'text', label: 'Type the word', value: '', language },
    }} actions={lessonActions} />);
    expect(html).toContain(`lang="${language}"`);
    expect(html).toContain('Lesson');
  });

  it('encodes target size, reflow, focus and reduced-motion safeguards without runtime imports', () => {
    const sources = ['TodayScreen.tsx', 'LessonScreen.tsx', 'PlacementScreen.tsx', 'ProgressScreen.tsx', 'dailyLearningPresentation.ts']
      .map((file) => readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8'))
      .join('\n');

    expect(sources).toContain('min-h-11');
    expect(sources).toContain('grid-cols-1');
    expect(sources).toContain('focus-visible:');
    expect(sources).toContain('motion-reduce:');
    expect(sources).not.toContain('outline-none');
    expect(sources).not.toMatch(/firebase|firestore|catalogCache|IndexedDB|dailyPlanEngine|lessonReducer/i);
  });
});
