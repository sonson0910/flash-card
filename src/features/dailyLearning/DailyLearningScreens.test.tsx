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
import { messages as enToday } from '../../i18n/locales/en/today.po';
import { messages as viToday } from '../../i18n/locales/vi/today.po';
import { expandPseudoCatalog } from '../../i18n/pseudo';
import { ThemeProvider } from '../theme/ThemeProvider';
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

i18n.load('en', {});
i18n.activate('en');

const renderToStaticMarkup = (node: ReactNode) => renderReactToStaticMarkup(<I18nProvider i18n={i18n}>{node}</I18nProvider>);

const todayActions: TodayScreenActions = {
  openVocabulary: vi.fn(),
  openPaths: vi.fn(),
  retry: vi.fn(),
  startSession: vi.fn(),
  startLesson: vi.fn(),
  startPlacement: vi.fn(),
  openMorePractice: vi.fn(),
};

const readyToday: TodayScreenModel = {
  status: 'ready',
  isOffline: false,
  message: 'Your plan is ready.',
  plan: { total: 12, due: 4, weak: 3, fresh: 5, isShort: false },
  placementAvailable: true,
};

const caughtUpToday: TodayScreenModel = {
  status: 'caught-up',
  isOffline: false,
  message: 'No due or new cards are available in this daily plan.',
  courseLabel: 'English ← Vietnamese',
  plan: { total: 0, due: 0, weak: 0, fresh: 0, isShort: true },
  placementAvailable: false,
  caughtUp: { availableNewCount: 0 },
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

  it('keeps the daily action dominant and exposes only three direct practice shortcuts', () => {
    const html = renderToStaticMarkup(<TodayScreen model={readyToday} actions={todayActions} />);

    expect(html).toContain('aria-labelledby="daily-today-heading"');
    expect(html).toContain('<h1');
    expect(html).toContain('Today');
    expect(html).toContain('12 items');
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
    expect(html.match(/data-practice-mode="true"/g)).toHaveLength(3);
    expect(html.match(/data-practice-catalog-mode="true"/g)).toHaveLength(3);
    expect(html).toContain('min-h-24 rounded-xl');
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
    expect(html).not.toContain('Start recognition lesson');
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
      expect(html).toContain('Learn 5 new');
      expect(html).toContain('disabled=""');
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
      model={{ ...caughtUpToday, caughtUp: { availableNewCount: 0, nextReview: { label: 'tomorrow, 08:00', cardCount: 8 } } }}
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
  it('keeps study guidance visible when Lumi is disabled', () => {
    vi.stubGlobal('localStorage', { getItem: (key: string) => ({ sonflash_theme_family: 'crystal', sonflash_lumi_enabled: 'false' })[key] ?? null });
    try {
      const html = renderToStaticMarkup(<ThemeProvider><LessonScreen model={choiceLesson} actions={lessonActions} /></ThemeProvider>);

      expect(html).toContain('Take your time. One clear answer at a time.');
      expect(html).not.toContain('data-lumi-pose=');
      expect(html).toContain('Submit answer');
    } finally {
      vi.unstubAllGlobals();
    }
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
    expect(html).toContain('Offline — this may be out of date.');
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
    const now = new Date(2026, 8, 24, 12);
    const today = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const yesterday = new Date(2026, 8, 23, 12).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    expect(evidencedStudyStreak(1, [], now)).toBe(0);
    expect(evidencedStudyStreak(4, [{ date: yesterday, XP: 20 }], now)).toBe(0);
    expect(evidencedStudyStreak(4, [{ date: today, XP: 0 }], now)).toBe(0);
    expect(evidencedStudyStreak(4, [{ date: today, XP: 20 }], now)).toBe(4);
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
      expect(html).toContain(i18n._('today.plan.sequence', { count: 12 }));
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
