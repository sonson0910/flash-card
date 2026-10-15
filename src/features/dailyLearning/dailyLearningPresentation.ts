import type { ReactNode, RefObject } from 'react';
import type { HapticStyle } from '../../lib/haptics';

export type LessonMode =
  | 'recognition'
  | 'active-recall'
  | 'listening'
  | 'spelling'
  | 'cloze'
  | 'sentence-building';

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface DailyPlanPresentation {
  readonly total: number;
  readonly due: number;
  readonly weak: number;
  readonly fresh: number;
  readonly isShort: boolean;
}

/** The stored counter advances on read; show it only after actual XP activity today. */
const isoDayInTimeZone = (date: Date, timeZone?: string): string => {
  const format = (zone: string) => new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  let parts: Intl.DateTimeFormatPart[];
  try { parts = format(timeZone || 'UTC'); } catch { parts = format('UTC'); }
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
};

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
  }[];
  readonly placementAvailable: boolean;
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
}

export interface TodayScreenActions {
  readonly openVocabulary: () => void;
  readonly openPaths: () => void;
  readonly retry: () => void;
  /** Launches the sequenced review → new → match → recap session for today's plan. */
  readonly startSession: () => void;
  readonly startLesson: (mode: LessonMode) => void;
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

export interface LessonScreenModel {
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  readonly status: 'answering' | 'feedback' | 'rating-saving' | 'rating-error' | 'complete';
  readonly mode: LessonMode;
  readonly modeLabel: string;
  readonly progress: { readonly current: number; readonly total: number };
  readonly prompt: string;
  readonly promptLanguage?: string;
  readonly answer: LessonAnswerPresentation;
  readonly canSubmit: boolean;
  readonly canPlayAudio?: boolean;
  readonly feedback?: LessonFeedbackPresentation;
  readonly errorMessage?: string;
  readonly audioErrorMessage?: string;
  readonly liveMessage: string;
}

export interface LessonScreenActions {
  readonly chooseAnswer: (choiceId: string) => void;
  readonly changeTextAnswer: (value: string) => void;
  readonly toggleSentenceToken: (occurrenceId: string) => void;
  readonly playAudio: () => void;
  readonly submitAnswer: () => void;
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

export interface SessionBridgeModel {
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  readonly completedStage: SessionBridgeStageId;
  readonly nextStage: SessionBridgeStageId;
  readonly completedLabel: string;
  readonly nextLabel: string;
  readonly nextDescription: string;
  readonly stats: readonly SessionBridgeStat[];
  readonly comboCount: number;
  readonly stages: readonly { id: SessionBridgeStageId; label: string; completed: boolean; current: boolean }[];
  readonly previewCard?: { word: string; translation: string; phonetic: string; category: string; language: string };
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
}

export interface ProgressScreenProps {
  readonly model: ProgressScreenModel;
  readonly actions: {
    readonly startReview: () => void;
    readonly openVocabulary: () => void;
  };
  readonly children?: ReactNode;
}
