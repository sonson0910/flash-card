import type { CardData } from '../../types/card';
import { buildDailyPlan, type DailyPlanReason } from '../dailyLearning/dailyPlan';
import {
  getEligibleExerciseModes,
  type ExerciseMode,
} from '../dailyLearning/exerciseEngine';
import {
  ADAPTIVE_SESSION_TARGETS,
  parseCourseItemV1,
  type CourseItemV1,
  type LearningFocusV1,
  type SessionSizeV1,
} from '../courses/courseModel';
import type { SkillStateV4 } from '../skillEvidence/skillEvidenceModel';

export type AdaptiveActivityModeV1 = ExerciseMode | 'immerse';
export type AdaptiveRecommendationReasonKindV1 = 'due' | 'weak' | 'new' | 'skill-gap' | 'next';

export interface AdaptiveCandidateV1 {
  readonly courseId: string;
  readonly scenarioId: string;
  readonly item: CourseItemV1;
  readonly card: CardData;
  readonly skillState: SkillStateV4 | null;
  readonly context: {
    readonly chunkIds: readonly string[];
    readonly hasExample: boolean;
  };
  readonly media: {
    readonly licensedAudio: boolean;
    readonly clipId: string | null;
    readonly transcriptReady: boolean;
    readonly availableOffline: boolean;
  };
}

export interface AdaptiveRecommendationOptions {
  readonly activeCourseId: string;
  readonly activeScenarioId: string;
  readonly now: Date;
  readonly focus: LearningFocusV1;
  readonly sessionSize: SessionSizeV1;
  readonly isOffline: boolean;
  readonly recentModes: readonly AdaptiveActivityModeV1[];
  readonly skippedActivityIds: ReadonlySet<string>;
}

export interface AdaptiveRecommendationWindowV1 {
  readonly targetActivities: 5 | 10 | 15;
  readonly maximumNewItems: 8;
}

export type AdaptiveRecommendationV1 =
  | {
      readonly kind: 'empty';
      readonly reason: 'no-content' | 'no-eligible-activity';
      readonly window: AdaptiveRecommendationWindowV1;
    }
  | {
      readonly kind: 'course-complete';
      readonly courseId: string;
      readonly scenarioId: string;
      readonly window: AdaptiveRecommendationWindowV1;
    }
  | {
      readonly kind: 'exercise';
      readonly activityId: string;
      readonly courseId: string;
      readonly scenarioId: string;
      readonly lexemeId: string;
      readonly card: CardData;
      readonly mode: ExerciseMode;
      readonly reason: {
        readonly kind: AdaptiveRecommendationReasonKindV1;
        readonly label: string;
      };
      readonly window: AdaptiveRecommendationWindowV1;
      readonly fallbackFrom?: LearningFocusV1;
    }
  | {
      readonly kind: 'immerse';
      readonly activityId: string;
      readonly courseId: string;
      readonly scenarioId: string;
      readonly lexemeId: string;
      readonly clipId: string;
      readonly reason: {
        readonly kind: AdaptiveRecommendationReasonKindV1;
        readonly label: string;
      };
      readonly window: AdaptiveRecommendationWindowV1;
    };

export class AdaptiveRecommendationValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'AdaptiveRecommendationValidationError';
  }
}

const MAXIMUM_CANDIDATES = 10_000;
const REASON_LABELS: Readonly<Record<AdaptiveRecommendationReasonKindV1, string>> = {
  due: 'Review due',
  weak: 'Strengthen a weak item',
  new: 'Learn a new item',
  'skill-gap': 'Practice an unobserved skill',
  next: 'Continue the scenario',
};
const MODES_BY_DIMENSION: Readonly<Record<'listening' | 'context' | 'recognition' | 'production', readonly ExerciseMode[]>> = {
  listening: ['listening'],
  context: ['cloze', 'sentence-building'],
  recognition: ['recognition'],
  production: ['active-recall', 'spelling'],
};
const DIMENSIONS = ['listening', 'context', 'recognition', 'production'] as const;

type AdaptiveDimension = typeof DIMENSIONS[number];
type CandidateWithModes = {
  readonly candidate: AdaptiveCandidateV1;
  readonly modes: readonly ExerciseMode[];
};

const windowFor = (sessionSize: SessionSizeV1): AdaptiveRecommendationWindowV1 => ({
  targetActivities: ADAPTIVE_SESSION_TARGETS[sessionSize],
  maximumNewItems: 8,
});

const candidateId = (candidate: AdaptiveCandidateV1): string => JSON.stringify([
  candidate.courseId,
  candidate.scenarioId,
  candidate.item.lexemeId,
]);

export const createAdaptiveCandidateId = candidateId;

const compareCandidates = (left: CandidateWithModes, right: CandidateWithModes): number => (
  left.candidate.item.rank - right.candidate.item.rank
  || left.candidate.item.lexemeId.localeCompare(right.candidate.item.lexemeId)
  || left.candidate.item.id.localeCompare(right.candidate.item.id)
);

const validFocus = (value: LearningFocusV1): value is LearningFocusV1 => (
  value === 'balanced' || value === 'learn' || value === 'hear' || value === 'speak'
);

const validSessionSize = (value: SessionSizeV1): value is SessionSizeV1 => (
  value === 'short' || value === 'standard' || value === 'deep'
);

const validateOptions = (options: AdaptiveRecommendationOptions): void => {
  if (!validFocus(options.focus)) throw new AdaptiveRecommendationValidationError('focus: unsupported value');
  if (!validSessionSize(options.sessionSize)) {
    throw new AdaptiveRecommendationValidationError('sessionSize: unsupported value');
  }
  if (!(options.now instanceof Date) || !Number.isFinite(options.now.getTime())) {
    throw new AdaptiveRecommendationValidationError('now: expected a valid date');
  }
  if (typeof options.isOffline !== 'boolean') {
    throw new AdaptiveRecommendationValidationError('isOffline: expected boolean');
  }
}

const validateCandidate = (
  candidate: AdaptiveCandidateV1,
  index: number,
  options: AdaptiveRecommendationOptions,
): void => {
  try {
    parseCourseItemV1(candidate.item);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid course item';
    throw new AdaptiveRecommendationValidationError(`candidates[${index}].item: ${message}`);
  }
  if (
    candidate.item.courseId !== candidate.courseId
    || candidate.item.scenarioId !== candidate.scenarioId
    || candidate.item.lexemeId !== candidate.card.id
  ) {
    throw new AdaptiveRecommendationValidationError(
      `candidates[${index}]: item and card identities do not match`,
    );
  }
  if (candidate.courseId !== options.activeCourseId || candidate.scenarioId !== options.activeScenarioId) {
    throw new AdaptiveRecommendationValidationError(
      `candidates[${index}]: active course and scenario must be filtered before selection`,
    );
  }
  if (typeof candidate.media.licensedAudio !== 'boolean'
    || typeof candidate.media.transcriptReady !== 'boolean'
    || typeof candidate.media.availableOffline !== 'boolean'
    || (candidate.media.clipId !== null && typeof candidate.media.clipId !== 'string')) {
    throw new AdaptiveRecommendationValidationError(`candidates[${index}].media: invalid capability`);
  }
  if (typeof candidate.context.hasExample !== 'boolean' || !Array.isArray(candidate.context.chunkIds)) {
    throw new AdaptiveRecommendationValidationError(`candidates[${index}].context: invalid context`);
  }
};

const mediaCanImmerse = (
  candidate: AdaptiveCandidateV1,
  isOffline: boolean,
): candidate is AdaptiveCandidateV1 & { readonly media: { readonly clipId: string } } => (
  candidate.media.licensedAudio
  && Boolean(candidate.media.clipId)
  && candidate.media.transcriptReady
  && (!isOffline || candidate.media.availableOffline)
);

const modeForDimension = (
  dimension: AdaptiveDimension,
  modes: readonly ExerciseMode[],
): ExerciseMode | null => (
  MODES_BY_DIMENSION[dimension].find(mode => modes.includes(mode)) ?? null
);

const lastUse = (mode: AdaptiveActivityModeV1, recentModes: readonly AdaptiveActivityModeV1[]): number => {
  for (let index = recentModes.length - 1; index >= 0; index -= 1) {
    if (recentModes[index] === mode) return index;
  }
  return -1;
};

const chooseLeastRecent = (
  modes: readonly ExerciseMode[],
  recentModes: readonly AdaptiveActivityModeV1[],
): ExerciseMode | null => [...modes].sort((left, right) => (
  lastUse(left, recentModes) - lastUse(right, recentModes)
  || left.localeCompare(right)
))[0] ?? null;

const balancedMode = (
  candidate: AdaptiveCandidateV1,
  modes: readonly ExerciseMode[],
  recentModes: readonly AdaptiveActivityModeV1[],
): ExerciseMode | null => {
  if (!candidate.skillState) return chooseLeastRecent(modes, recentModes);
  const available = DIMENSIONS.map((dimension, order) => ({
    dimension,
    order,
    mode: modeForDimension(dimension, modes),
    score: candidate.skillState?.dimensions[dimension].score ?? null,
  })).filter((entry): entry is typeof entry & { readonly mode: ExerciseMode } => entry.mode !== null);
  if (available.length === 0) return chooseLeastRecent(modes, recentModes);
  return available.sort((left, right) => (
    (left.score ?? -1) - (right.score ?? -1)
    || lastUse(left.mode, recentModes) - lastUse(right.mode, recentModes)
    || left.order - right.order
  ))[0]?.mode ?? null;
};

const modeForFocus = (
  candidate: AdaptiveCandidateV1,
  modes: readonly ExerciseMode[],
  options: AdaptiveRecommendationOptions,
): { readonly mode: ExerciseMode | null; readonly fallbackFrom?: LearningFocusV1 } => {
  if (options.focus === 'hear') {
    if (modes.includes('listening')) return { mode: 'listening', fallbackFrom: 'hear' };
    return { mode: modes.includes('active-recall') ? 'active-recall' : null, fallbackFrom: 'hear' };
  }
  if (options.focus === 'learn') {
    return {
      mode: modes.includes('recognition')
        ? 'recognition'
        : modes.includes('active-recall') ? 'active-recall' : null,
    };
  }
  if (options.focus === 'speak') {
    return { mode: modes.includes('active-recall') ? 'active-recall' : null, fallbackFrom: 'speak' };
  }
  return { mode: balancedMode(candidate, modes, options.recentModes) };
};

const hasOpenSkillGap = (
  candidate: AdaptiveCandidateV1,
  modes: readonly ExerciseMode[],
): boolean => {
  const skillState = candidate.skillState;
  if (!skillState) return false;
  return DIMENSIONS.some(dimension => {
    if (!modeForDimension(dimension, modes)) return false;
    const score = skillState.dimensions[dimension].score;
    return score === null || score < 1;
  });
};

const reason = (kind: AdaptiveRecommendationReasonKindV1) => ({
  kind,
  label: REASON_LABELS[kind],
});

const plannedCandidates = (
  candidates: readonly CandidateWithModes[],
  now: Date,
): ReadonlyMap<string, DailyPlanReason> => {
  const byCardId = new Map(candidates.map(entry => [entry.candidate.card.id, entry]));
  const plan = buildDailyPlan([...byCardId.values()].map(entry => entry.candidate.card), {
    now,
    maximum: 15,
    targetMinimum: 1,
  });
  const result = new Map<string, DailyPlanReason>();
  for (const item of plan.items) {
    const entry = byCardId.get(item.card.id);
    if (entry) result.set(candidateId(entry.candidate), item.reason);
  }
  return result;
};

const selectCandidate = (
  candidates: readonly CandidateWithModes[],
  options: AdaptiveRecommendationOptions,
  reasonKind: AdaptiveRecommendationReasonKindV1,
): AdaptiveRecommendationV1 | null => {
  const ordered = [...candidates].sort(compareCandidates);
  for (const entry of ordered) {
    if (options.focus === 'hear' && mediaCanImmerse(entry.candidate, options.isOffline)) {
      return {
        kind: 'immerse',
        activityId: candidateId(entry.candidate),
        courseId: entry.candidate.courseId,
        scenarioId: entry.candidate.scenarioId,
        lexemeId: entry.candidate.item.lexemeId,
        clipId: entry.candidate.media.clipId,
        reason: reason(reasonKind),
        window: windowFor(options.sessionSize),
      };
    }
    const selected = modeForFocus(entry.candidate, entry.modes, options);
    if (!selected.mode) continue;
    return {
      kind: 'exercise',
      activityId: candidateId(entry.candidate),
      courseId: entry.candidate.courseId,
      scenarioId: entry.candidate.scenarioId,
      lexemeId: entry.candidate.item.lexemeId,
      card: entry.candidate.card,
      mode: selected.mode,
      reason: reason(reasonKind),
      window: windowFor(options.sessionSize),
      ...(selected.fallbackFrom ? { fallbackFrom: selected.fallbackFrom } : {}),
    };
  }
  return null;
};

const recommendationCandidates = (
  candidates: readonly AdaptiveCandidateV1[],
  options: AdaptiveRecommendationOptions,
): readonly CandidateWithModes[] => {
  const scoped = candidates.filter(candidate => (
    candidate.courseId === options.activeCourseId
    && candidate.scenarioId === options.activeScenarioId
  ));
  const pool = scoped.map(candidate => candidate.card);
  const seenIds = new Set<string>();
  return scoped.map((candidate, index) => {
    validateCandidate(candidate, index, options);
    const id = candidateId(candidate);
    if (seenIds.has(id)) {
      throw new AdaptiveRecommendationValidationError(`candidates[${index}]: duplicate activity identity`);
    }
    seenIds.add(id);
    return {
      candidate,
      modes: getEligibleExerciseModes(candidate.card, pool),
    };
  });
};

export function recommendNextActivity(
  candidates: readonly AdaptiveCandidateV1[],
  options: AdaptiveRecommendationOptions,
): AdaptiveRecommendationV1 {
  validateOptions(options);
  if (!Array.isArray(candidates) || candidates.length > MAXIMUM_CANDIDATES) {
    throw new AdaptiveRecommendationValidationError('candidates: expected at most 10000 items');
  }
  const window = windowFor(options.sessionSize);
  const active = recommendationCandidates(candidates, options);
  if (active.length === 0) return { kind: 'empty', reason: 'no-content', window };

  const skipped = active.filter(entry => options.skippedActivityIds.has(candidateId(entry.candidate)));
  const usable = skipped.length === active.length
    ? active
    : active.filter(entry => !options.skippedActivityIds.has(candidateId(entry.candidate)));
  const planReasons = plannedCandidates(usable, options.now);
  const priorities: DailyPlanReason[] = ['due', 'weak', 'new'];
  for (const priority of priorities) {
    const selected = selectCandidate(
      usable.filter(entry => planReasons.get(candidateId(entry.candidate)) === priority),
      options,
      priority,
    );
    if (selected) return selected;
  }

  const gaps = usable
    .filter(entry => hasOpenSkillGap(entry.candidate, entry.modes))
    .sort((left, right) => {
      const leftScore = Math.min(...DIMENSIONS
        .map(dimension => modeForDimension(dimension, left.modes)
          ? left.candidate.skillState?.dimensions[dimension].score ?? -1 : 1));
      const rightScore = Math.min(...DIMENSIONS
        .map(dimension => modeForDimension(dimension, right.modes)
          ? right.candidate.skillState?.dimensions[dimension].score ?? -1 : 1));
      return leftScore - rightScore || compareCandidates(left, right);
    });
  const gapRecommendation = selectCandidate(gaps, options, 'skill-gap');
  if (gapRecommendation) return gapRecommendation;

  const unknownState = usable.filter(entry => !entry.candidate.skillState);
  const nextRecommendation = selectCandidate(unknownState, options, 'next');
  if (nextRecommendation) return nextRecommendation;

  return {
    kind: 'course-complete',
    courseId: options.activeCourseId,
    scenarioId: options.activeScenarioId,
    window,
  };
}
