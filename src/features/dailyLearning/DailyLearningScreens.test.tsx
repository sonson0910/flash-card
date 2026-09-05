import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LessonScreen } from './LessonScreen';
import { PlacementScreen } from './PlacementScreen';
import { ProgressScreen } from './ProgressScreen';
import { TodayScreen } from './TodayScreen';
import type {
  LessonScreenActions,
  LessonScreenModel,
  PlacementScreenActions,
  PlacementScreenModel,
  ProgressScreenModel,
  TodayScreenActions,
  TodayScreenModel,
} from './dailyLearningPresentation';

const todayActions: TodayScreenActions = {
  openVocabulary: vi.fn(),
  openPaths: vi.fn(),
  retry: vi.fn(),
  continueReview: vi.fn(),
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
    expect(html).toContain('Continue review');
    expect(html).toContain('Take placement check');
    expect(html).toContain('data-primary-learning-action="true"');
    expect(html).toContain('More practice');
    expect(html).toContain('More lesson modes');
    expect(html.match(/data-practice-mode="true"/g)).toHaveLength(3);
    expect(html.match(/data-practice-catalog-mode="true"/g)).toHaveLength(3);
    expect(html).toContain('min-h-24 rounded-xl');
  });

  it('starts an honest recognition lesson when the plan has no due reviews', () => {
    const html = renderToStaticMarkup(
      <TodayScreen
        model={{ ...readyToday, plan: { total: 6, due: 0, weak: 2, fresh: 4, isShort: true } }}
        actions={todayActions}
      />,
    );

    expect(html).toContain('data-primary-learning-action="true"');
    expect(html).toContain('Start recognition lesson');
    expect(html).not.toContain('Continue review');
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
    expect(html).toContain('aria-label="Communicate: open Story and Shadowing practice"');
    expect(html).toContain('aria-label="Communicate: go to Vocabulary tools for AI Dialogue"');
    expect(html).toContain('Review due words');
    expect(html).toContain('Start listening practice');
    expect(html).toContain('Open Story and Shadowing');
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

  it('keeps the reviewed Listen pilot available for empty and signed-out Today', () => {
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

  it('keeps Immerse disabled when the reviewed pilot is unavailable', () => {
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
    [{ ...readyToday, status: 'offline', isOffline: true, message: 'Using your saved practice pool.' } satisfies TodayScreenModel, 'Available offline'],
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
});

describe('LessonScreen', () => {
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
    expect(html).toContain('<fieldset class="mt-5" disabled="">');
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
});

describe('PlacementScreen', () => {
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
    expect(html).toContain('Learning progress');
    expect(html).toContain('42 reviewed');
    expect(html).toContain('12 mastered');
    expect(html).toContain('5 due today');
    expect(html).toContain('Review 5 due words');
    expect(html).toContain('data-primary-learning-action="true"');
    expect(html).toContain('Available offline');
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
