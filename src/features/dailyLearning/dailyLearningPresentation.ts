import type { ReactNode, RefObject } from 'react';
import type { HapticStyle } from '../../lib/haptics';
import type { DailyGoalsSource } from '../dailyGoals/dailyGoalsModel';
import type { StreakView } from '../gamification/streakView';
import type { StreakRunStats, StudyWeekDay } from './todayScreenFacts';

export type LessonMode =
  | 'recognition'
  | 'active-recall'
  | 'listening'
  | 'spelling'
  | 'cloze'
  | 'sentence-building';

export type DailySessionTarget = 5 | 10 | 15;

export const shouldUseListenPilot = (
  mode: LessonMode | 'placement' | 'session' | null,
  allowListenPilot: boolean,
  pilotAvailable: boolean,
): boolean => mode === 'listening' && allowListenPilot && pilotAvailable;

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface DailyPlanPresentation {
  readonly total: number;
  readonly due: number;
  readonly weak: number;
  readonly fresh: number;
  readonly isShort: boolean;
}

/** Calendar day (yyyy-mm-dd) of `date` in the learner's reward timezone. */
export const isoDayInTimeZone = (date: Date, timeZone?: string): string => {
  const format = (zone: string) => new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  let parts: Intl.DateTimeFormatPart[];
  try { parts = format(timeZone || 'UTC'); } catch { parts = format('UTC'); }
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
};

/** The stored counter advances on read; show it only after actual XP activity today. */
export const evidencedStudyStreak = (
  streak: number,
  xpHistory: readonly { readonly date: string; readonly XP: number }[],
  now = new Date(),
  rewardTimeZone?: string,
): number => {
  const day = isoDayInTimeZone(now, rewardTimeZone);
  return xpHistory.some(entry => entry.date === day && entry.XP > 0) ? streak : 0;
};

/**
 * What the "reveal" transition should do when a lesson question's feedback first appears.
 * A pure decision so the reduced-motion/sound-off/haptics-off gating stays exclusively inside
 * `triggerHaptic`/`playSuccessSound` (no duplicate device checks here); this only decides which
 * of those already-gated helpers apply to a correct vs. an incorrect answer. Incorrect answers
 * get a haptic nudge but no chime, matching the established pattern for wrong answers elsewhere
 * in the app (`ShadowingView.tsx`, `StudyView.tsx`): a sound cue is a reward, not a penalty.
 */
export const reviewFeedbackCue = (outcome: 'correct' | 'incorrect'): { readonly playSound: boolean; readonly haptic: HapticStyle } => (
  outcome === 'correct' ? { playSound: true, haptic: 'success' } : { playSound: false, haptic: 'warning' }
);
export interface TodayRecommendationPresentation {
  readonly activityId: string;
  readonly mode: LessonMode;
  readonly reason: string;
}

export interface TodayLearnerFacts {
  readonly name?: string;
  readonly xp?: number;
  /** The active course goal; the label is already localized. */
  readonly goal?: { readonly label: string; readonly level: string | null; readonly targetDate: string | null };
}

export interface TodaySessionWord {
  readonly id: string;
  readonly word: string;
  readonly translation: string;
  readonly reason: 'due' | 'weak' | 'new';
  readonly language?: string;
  readonly translationLanguage?: string;
  readonly sourceUrl?: string;
  readonly sourceContext?: string;
}

export interface TodayScreenModel {
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  readonly status: 'loading' | 'empty' | 'caught-up' | 'ready' | 'offline' | 'error';
  readonly isOffline: boolean;
  readonly message: string;
  /** Optional until the course context reaches the daily-learning workspace. */
  readonly courseLabel?: string;
  /** Consecutive study days, when the existing learning overview has one. */
  readonly streak?: number;
  readonly plan: DailyPlanPresentation | null;
  /** The first card in today's actual plan, used for a grounded preview. */
  readonly previewCard?: {
    readonly word: string;
    readonly translation: string;
    readonly phonetic?: string;
    readonly category?: string;
    readonly imageUrl?: string | null;
    readonly language?: string;
    readonly translationLanguage?: string;
  };
  /** The planned session rail. A skipped stage has no eligible content. */
  readonly sessionStages?: readonly {
    readonly id: 'review' | 'new' | 'match' | 'recap';
    readonly count: number;
    readonly skipped: boolean;
    /** Cards in this stage that were captured from the web. */
    readonly webCount?: number;
  }[];
  readonly placementAvailable: boolean;
  /** Facts about the signed-in learner; each one is shown only when present. */
  readonly learner?: TodayLearnerFacts;
  /** The run of study days from verified XP history, used for the streak line. */
  readonly studyRun?: { readonly studiedToday: boolean; readonly days: number };
  /** Verified XP of recent study days, oldest first, used to estimate sessions to the next level. */
  readonly recentStudyXp?: readonly number[];
  /** Monday to Sunday of the current reward-time-zone week, for the streak details. */
  readonly studyWeek?: readonly StudyWeekDay[];
  /** The server's streak record read for today; absent until the account has a verified study day. */
  readonly streakView?: StreakView;
  /** The moment `streakView` was built for. */
  readonly streakNow?: Date;
  /** Run totals the server counters cover, for the milestone details. */
  readonly streakRunStats?: StreakRunStats | null;
  /** Words planned for today's session, in plan order (a bounded slice). */
  readonly sessionWords?: readonly TodaySessionWord[];
  /** Planned cards that were captured from the web. */
  readonly sessionWebWordCount?: number;
  /**
   * Present when the loaded pool has cards but none are due, weak or new; the
   * plan takes every new card, so the only way forward is adding vocabulary.
   * Next-review facts require a complete pool.
   */
  readonly caughtUp?: {
    readonly nextReview?: {
      readonly label: string;
      readonly cardCount: number;
    };
  };
  readonly recommendation?: TodayRecommendationPresentation;
  /** The verified goal counters for the Daily goals panel; the panel is left out without them. */
  readonly dailyGoals?: DailyGoalsSource & { readonly rewardTimeZone?: string };
  /** Release B pilot availability; absent keeps the existing plan-gated behavior in callers. */
  readonly listenPilotAvailable?: boolean;
}

export interface TodayScreenActions {
  readonly openVocabulary: () => void;
  readonly openPaths: () => void;
  readonly retry: () => void;
  /** Launches the sequenced review → new → match → recap session for today's plan. */
  readonly startSession: () => void;
  readonly continueReview: () => void;
  readonly startDailyPlan: (target: DailySessionTarget) => void;
  readonly startLesson: (mode: LessonMode) => void;
  readonly startRecommended: () => void;
  readonly startPlacement: () => void;
  readonly openMorePractice: (opener: HTMLButtonElement) => void;
}

export interface LessonChoicePresentation {
  readonly id: string;
  readonly label: string;
  readonly language?: string;
}

export interface SentenceTokenPresentation {
  readonly occurrenceId: string;
  readonly label: string;
  readonly language?: string;
  readonly isSelected: boolean;
}

export type LessonAnswerPresentation =
  | {
      readonly kind: 'choice';
      readonly selectedId: string | null;
      readonly options: readonly LessonChoicePresentation[];
    }
  | {
      readonly kind: 'text';
      readonly value: string;
      readonly label: string;
      readonly language?: string;
      readonly inputMode?: 'text' | 'search';
    }
  | {
      readonly kind: 'sentence';
      readonly tokens: readonly SentenceTokenPresentation[];
      readonly selectedOrder: readonly SentenceTokenPresentation[];
    };

export interface LessonFeedbackPresentation {
  readonly outcome: 'correct' | 'incorrect';
  readonly message: string;
  readonly expectedAnswer: string;
  readonly answerLanguage?: string;
  readonly explanation?: string;
}

export interface LessonCardPresentation {
  readonly language?: string;
  readonly translationLanguage?: string;
  readonly word: string;
  readonly translation: string;
  readonly explanation?: string;
  readonly phonetic?: string;
  readonly exampleSentence?: string;
  readonly exampleTranslation?: string;
  readonly audioUrl?: string | null;
}

export interface LessonScreenModel {
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  readonly status: 'introduction' | 'guided' | 'answering' | 'feedback' | 'rating-saving' | 'rating-sync-pending' | 'rating-error' | 'complete';
  readonly mode: LessonMode;
  readonly modeLabel: string;
  readonly progress: { readonly current: number; readonly total: number };
  readonly prompt: string;
  readonly promptLanguage?: string;
  readonly answer: LessonAnswerPresentation;
  readonly card?: LessonCardPresentation;
  readonly canSubmit: boolean;
  readonly canPlayAudio?: boolean;
  readonly feedback?: LessonFeedbackPresentation;
  readonly errorMessage?: string;
  readonly audioErrorMessage?: string;
  readonly syncPendingReviewCount?: number;
  readonly liveMessage: string;
}

export interface LessonScreenActions {
  readonly chooseAnswer: (choiceId: string) => void;
  readonly changeTextAnswer: (value: string) => void;
  readonly toggleSentenceToken: (occurrenceId: string) => void;
  readonly playAudio: () => void;
  readonly submitAnswer: () => void;
  readonly chooseIntroduction?: (choice: 'guided' | 'independent-recall') => void;
  readonly continueGuided?: () => void;
  readonly requestGuidance?: () => void;
  readonly rate: (rating: ReviewRating) => void;
  readonly retryRating: () => void;
  readonly exit: () => void;
  readonly finish: () => void;
}

export type SessionBridgeStageId = 'review' | 'new' | 'match' | 'recap';

export interface SessionBridgeStat {
  readonly label: string;
  readonly value: string;
}

export interface SessionBridgeRailStage {
  readonly id: SessionBridgeStageId;
  readonly label: string;
  readonly completed: boolean;
  readonly current: boolean;
  /** Committed and planned items, e.g. "6/6"; empty for the recap. */
  readonly meta: string;
}

export interface SessionBridgePreviewCard {
  readonly word: string;
  readonly translation: string;
  readonly phonetic: string;
  readonly category: string;
  readonly language: string;
  readonly translationLanguage?: string;
  readonly partOfSpeech?: string;
  /** Host name of the page the word was captured from. */
  readonly sourceSite?: string;
  readonly exampleSentence?: string;
}

export interface SessionBridgeModel {
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  readonly completedStage: SessionBridgeStageId;
  readonly nextStage: SessionBridgeStageId;
  /** The finished stage and its committed count, e.g. "Review done · 6 of 6". */
  readonly completedLabel: string;
  readonly nextLabel: string;
  /** The upcoming part in the four-part session, e.g. "Part 2 of 4". */
  readonly stepLabel: string;
  readonly nextDescription: string;
  /** What the upcoming part holds, e.g. "5 words · 2 from the web". */
  readonly nextSummary?: string;
  /** Shown when the combo is hidden; the combo already carries the committed count. */
  readonly stats: readonly SessionBridgeStat[];
  /** The longest run of remembered cards in the finished stage. */
  readonly comboCount: number;
  /** The finished stage's last answers, oldest first: true when the card was remembered. */
  readonly recentAnswers: readonly boolean[];
  /** Verified XP awarded so far in this session. */
  readonly xpEarned: number;
  readonly stages: readonly SessionBridgeRailStage[];
  readonly previewCard?: SessionBridgePreviewCard;
  /** Set when the upcoming stage has no eligible content and will be skipped automatically. */
  readonly skipReason?: string;
  /** True when the upcoming stage has real content the learner may voluntarily bypass. */
  readonly canSkipNextStage: boolean;
  readonly liveMessage: string;
}

export interface SessionBridgeActions {
  readonly continue: () => void;
  readonly skip: () => void;
  readonly exit: () => void;
}

export type PlacementScreenModel =
  | {
      readonly headingRef?: RefObject<HTMLHeadingElement | null>;
      readonly status: 'loading';
      readonly message: string;
    }
  | {
      readonly headingRef?: RefObject<HTMLHeadingElement | null>;
      readonly status: 'intro';
      readonly message: string;
      readonly eligibleCount: number;
    }
  | {
      readonly headingRef?: RefObject<HTMLHeadingElement | null>;
      readonly status: 'question';
      readonly message: string;
      readonly current: number;
      readonly total: number;
      readonly prompt: string;
      readonly promptLanguage?: string;
      readonly selectedId: string | null;
      readonly options: readonly LessonChoicePresentation[];
      /** The word being asked about; `prompt` is then the question about it. */
      readonly word?: string;
      readonly phonetic?: string;
      readonly canPlayAudio?: boolean;
      /** The running estimate; absent until there are enough answers to evaluate. */
      readonly estimate?: { readonly tier: 'foundation' | 'core' | 'advanced'; readonly confidence: 'low' | 'medium' | 'high' };
    }
  | {
      readonly headingRef?: RefObject<HTMLHeadingElement | null>;
      readonly status: 'insufficient';
      readonly message: string;
      readonly eligibleCount: number;
      readonly requiredCount: number;
    }
  | {
      readonly headingRef?: RefObject<HTMLHeadingElement | null>;
      readonly status: 'result';
      readonly message: string;
      readonly recommendation: 'foundation' | 'core' | 'advanced';
      readonly recommendationLabel: string;
      readonly confidence: 'low' | 'medium' | 'high';
      readonly answeredCount: number;
      readonly correctCount: number;
    }
  | {
      readonly headingRef?: RefObject<HTMLHeadingElement | null>;
      readonly status: 'error';
      readonly message: string;
    };

export interface PlacementScreenActions {
  readonly start: () => void;
  readonly chooseAnswer: (choiceId: string) => void;
  readonly submitAnswer: () => void;
  readonly retry: () => void;
  readonly openPaths: () => void;
  readonly exit: () => void;
  /** Counts the current question as not known and moves on. */
  readonly markUnsure?: () => void;
  readonly playAudio?: () => void;
}

export interface ProgressScreenModel {
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  readonly focusIntent?: number;
  readonly status: 'loading' | 'ready' | 'empty' | 'error';
  readonly message: string;
  readonly reviewed: number;
  readonly mastered: number;
  readonly dueToday: number | null;
  readonly isOffline: boolean;
  readonly hasVocabulary: boolean;
  /** The review activity range; the header shows the range switch only with it. */
  readonly reviewRangeDays?: 30 | 182;
}

export interface ProgressScreenProps {
  readonly model: ProgressScreenModel;
  readonly actions: {
    readonly startReview: () => void;
    readonly openVocabulary: () => void;
    readonly changeReviewRange?: (days: 30 | 182) => void;
  };
  readonly children?: ReactNode;
}
