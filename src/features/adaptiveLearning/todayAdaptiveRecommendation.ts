import type { CardData } from '../../types/card';
import type { DailyPlan } from '../dailyLearning/dailyPlan';
import type { ExerciseMode } from '../dailyLearning/exerciseEngine';
import { projectPersonalLibraryToCourse, type CourseItemV1 } from '../courses/courseModel';
import {
  deriveSkillStateV4,
  type SkillEvidenceV4,
  type SkillStateV4,
} from '../skillEvidence/skillEvidenceModel';
import {
  recommendNextActivity,
  type AdaptiveCandidateV1,
  type AdaptiveRecommendationV1,
} from './adaptiveRecommendation';

export interface TodayAdaptiveRecommendationInput {
  readonly ownerId: string | null;
  readonly plan: DailyPlan | null;
  readonly cards?: readonly CardData[];
  readonly skillStatesByLexeme?: ReadonlyMap<string, SkillStateV4>;
  readonly isOffline: boolean;
  readonly now: Date;
}

export interface TodayAdaptiveLessonLaunch {
  readonly mode: ExerciseMode;
  readonly allowListenPilot: false;
  readonly maximumActivities: 5 | 10 | 15;
}

const MAXIMUM_CANDIDATES = 15;

const isUsableOwnerId = (ownerId: string | null): ownerId is string => (
  typeof ownerId === 'string'
  && ownerId.length > 0
  && ownerId === ownerId.normalize('NFKC').trim()
  && !/[\u0000-\u001F\u007F]/.test(ownerId)
);

const candidateFor = (
  item: CourseItemV1,
  card: AdaptiveCandidateV1['card'],
  skillState: SkillStateV4 | null,
): AdaptiveCandidateV1 => ({
  courseId: item.courseId,
  scenarioId: item.scenarioId,
  item,
  card,
  skillState,
  context: {
    chunkIds: [],
    hasExample: Boolean(card.exampleSentence?.trim()),
  },
  // CardData.audioUrl is not a licensed catalog capability. Release B's
  // explicit pilot remains the only Immerse entry point in this projection.
  media: {
    licensedAudio: false,
    clipId: null,
    transcriptReady: false,
    availableOffline: false,
  },
});

const hasOpenSkillGap = (state: SkillStateV4): boolean => (
  Object.values(state.dimensions).some(dimension => dimension.score === null || dimension.score < 1)
);

const uniqueCardsForRecommendation = (
  plan: DailyPlan,
  cards: readonly CardData[] | undefined,
  skillStatesByLexeme: ReadonlyMap<string, SkillStateV4> | undefined,
): readonly CardData[] => {
  const planCards = plan.items.map(item => item.card);
  const plannedIds = new Set(planCards.map(card => card.id));
  const skillGapCards = (cards ?? [])
    .filter(card => !plannedIds.has(card.id) && Boolean(
      skillStatesByLexeme?.get(card.id) && hasOpenSkillGap(skillStatesByLexeme.get(card.id)!),
    ))
    .sort((left, right) => left.id.localeCompare(right.id));
  const fallbackCards = (cards ?? [])
    .filter(card => !plannedIds.has(card.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  const seen = new Set<string>();
  return [...planCards, ...skillGapCards, ...fallbackCards].filter(card => {
    if (seen.has(card.id)) return false;
    seen.add(card.id);
    return true;
  }).slice(0, MAXIMUM_CANDIDATES);
};

/**
 * Normalizes trusted chunk-targeted evidence onto its owning lexeme for the
 * selector. The content adapter supplies the chunk-to-lexeme relation; this
 * helper never infers it from a URL or learner input.
 */
export const buildTodaySkillStates = (
  records: readonly SkillEvidenceV4[],
  ownerId: string,
  chunkLexemeIds: ReadonlyMap<string, readonly string[]> = new Map(),
): ReadonlyMap<string, SkillStateV4> => {
  const result = new Map<string, SkillStateV4>();
  const lexemeIds = new Set<string>();
  for (const record of records) {
    if (record.ownerId !== ownerId) continue;
    if (record.target.kind === 'lexeme') lexemeIds.add(record.target.id);
    else for (const lexemeId of chunkLexemeIds.get(record.target.id) ?? []) lexemeIds.add(lexemeId);
  }
  for (const lexemeId of lexemeIds) {
    const matching = records
      .filter(record => record.ownerId === ownerId && (
        record.target.kind === 'lexeme' && record.target.id === lexemeId
        || record.target.kind === 'chunk' && (chunkLexemeIds.get(record.target.id) ?? []).includes(lexemeId)
      ))
      .map(record => ({ ...record, target: { kind: 'lexeme' as const, id: lexemeId } }));
    result.set(lexemeId, deriveSkillStateV4(matching, { kind: 'lexeme', id: lexemeId }, ownerId));
  }
  return result;
};

export function buildTodayAdaptiveRecommendation(
  input: TodayAdaptiveRecommendationInput,
): Extract<AdaptiveRecommendationV1, { readonly kind: 'exercise' }> | null {
  if (!isUsableOwnerId(input.ownerId) || !input.plan?.items?.length) return null;

  try {
    const cards = uniqueCardsForRecommendation(input.plan, input.cards, input.skillStatesByLexeme);
    if (cards.length === 0) return null;
    const projection = projectPersonalLibraryToCourse({
      ownerId: input.ownerId,
      contentLanguage: 'en',
      supportLanguage: 'vi',
      cards,
      migratedAt: input.now.toISOString(),
    });
    const cardsById = new Map(cards.map(card => [card.id, card]));
    const candidates = projection.items.map(item => {
      const card = cardsById.get(item.lexemeId);
      if (!card) throw new TypeError('projection item has no matching card');
      return candidateFor(item, card, input.skillStatesByLexeme?.get(item.lexemeId) ?? null);
    });
    const recommendation = recommendNextActivity(candidates, {
      activeCourseId: projection.course.id,
      activeScenarioId: projection.scenario.id,
      now: input.now,
      focus: projection.preferences.focus,
      sessionSize: projection.preferences.sessionSize,
      isOffline: input.isOffline,
      recentModes: [],
      skippedActivityIds: new Set<string>(),
      introducedItemIds: new Set(projection.enrollment.introducedItemIds),
      newItemsRemaining: 8,
    });
    return recommendation.kind === 'exercise' ? recommendation : null;
  } catch {
    return null;
  }
}

export const launchTodayAdaptiveLesson = (
  recommendation: AdaptiveRecommendationV1 | null,
): TodayAdaptiveLessonLaunch | null => recommendation?.kind === 'exercise'
  ? {
    mode: recommendation.mode,
    allowListenPilot: false,
    maximumActivities: recommendation.window.targetActivities,
  }
  : null;
