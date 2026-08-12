import type { ReactNode, RefObject } from 'react';

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

export interface TodayScreenModel {
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  readonly status: 'loading' | 'empty' | 'ready' | 'offline' | 'error';
  readonly isOffline: boolean;
  readonly message: string;
  readonly plan: DailyPlanPresentation | null;
  readonly placementAvailable: boolean;
}

export interface TodayScreenActions {
  readonly openVocabulary: () => void;
  readonly openPaths: () => void;
  readonly retry: () => void;
  readonly continueReview: () => void;
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
  readonly dueToday: number;
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
