# Adaptive Learning Core Increment 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one canonical, pure Course/Scenario/Enrollment/Preferences/Recommendation seam that chooses a bounded next Learn or Immerse activity from existing card, catalog, media-capability, and SkillState inputs.

**Architecture:** Keep `CourseV1` and related types in a new `courses` feature because the proposal has no runtime implementation yet. Keep recommendation in a framework-free `adaptiveLearning` feature and reuse `buildDailyPlan()` plus `getEligibleExerciseModes()` instead of creating another scheduler or exercise builder. Catalog chunks and licensed media are adapter-provided capabilities; this increment performs no fetch, persistence, migration, UI wiring, FSRS mutation, or publication.

**Tech Stack:** TypeScript, existing `CardData`, `CatalogCacheEntry`, `SkillStateV4`, `ExerciseMode`, `buildDailyPlan()`, `getEligibleExerciseModes()`, `SCHEMA_V3_LIMITS`, `createMigrationFingerprint()`, and Vitest. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-04-adaptive-learning-core-increment5-design.md` and `SONFLASH_EXECUTION_PLAN.md` §5 Increment 5.

---

## Scope guard

- Do not add a second Course/Scenario/Preferences/Recommendation model.
- Do not modify `CardData`, `LearningStateV3`, FSRS, review history, Firestore Rules, IndexedDB, migration code, navigation, or UI.
- Do not call AI, Firebase, browser globals, network, or storage from the new pure modules.
- Do not infer licensed media from a URL. Only an adapter-provided `licensedAudio` capability may produce an `immerse` recommendation.
- Do not let missing SkillState become mastery, and do not turn a recommendation into an FSRS rating.

## Task 1: Add the canonical course domain and pure projections

**Files:**
- Create: `src/features/courses/courseModel.ts`
- Test: `src/features/courses/courseModel.test.ts`

### Step 1: Write the failing tests

```ts
import { describe, expect, it } from 'vitest';
import type { CardData } from '../../types/card';
import {
  createCourseItemId,
  parseLearningPreferencesV1,
  projectCatalogEntriesToCourse,
  projectPersonalLibraryToCourse,
} from './courseModel';

const card = (id: string): CardData => ({
  id,
  word: id,
  normalizedWord: id,
  translation: `vi-${id}`,
  explanation: '',
  phonetic: '',
  emoji: '📘',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-09-04T00:00:00.000Z',
  customDeck: null,
  difficulty: 'unrated',
});

it('projects personal cards into one course and one default scenario', () => {
  const result = projectPersonalLibraryToCourse({
    ownerId: 'owner-a', contentLanguage: 'en', supportLanguage: 'vi',
    cards: [card('two'), card('one')], migratedAt: '2026-09-04T00:00:00.000Z',
  });
  expect(result.course.source).toBe('personal');
  expect(result.scenario.courseId).toBe(result.course.id);
  expect(result.items.map(item => item.lexemeId)).toEqual(['one', 'two']);
  expect(result.enrollment.introducedItemIds).toEqual([]);
  expect(result.preferences.activeCourseByLanguage.en).toBe(result.course.id);
});

it('projects catalog entries without duplicating learner state', () => {
  const result = projectCatalogEntriesToCourse({
    catalogId: 'english-core', releaseId: 'release-1', trackId: 'general',
    contentLanguage: 'en', supportLanguage: 'vi', title: 'General English',
    entries: [{ lexemeId: 'lexeme-b', rank: 2 }, { lexemeId: 'lexeme-a', rank: 1 }],
    createdAt: '2026-09-04T00:00:00.000Z',
  });
  expect(result.course.source).toBe('catalog');
  expect(result.items.map(item => item.lexemeId)).toEqual(['lexeme-a', 'lexeme-b']);
  expect(new Set(result.items.map(item => item.id)).size).toBe(2);
  expect(result.enrollment.courseId).toBe(result.course.id);
});

it('keeps the same lexeme state identity while membership IDs differ by course/scenario', () => {
  expect(createCourseItemId('course-a', 'scenario-a', 'lexeme-a'))
    .not.toBe(createCourseItemId('course-b', 'scenario-a', 'lexeme-a'));
});

it('rejects an invalid active-course value and unknown fields', () => {
  expect(() => parseLearningPreferencesV1({
    schemaVersion: 1,
    useV3Courses: false,
    activeCourseByLanguage: { en: ['course-a', 'course-b'] },
    focus: 'balanced',
    sessionSize: 'standard',
    unexpected: true,
  })).toThrow(/unknown field/);
  expect(() => parseLearningPreferencesV1({
    schemaVersion: 1,
    useV3Courses: false,
    activeCourseByLanguage: { en: 'course-a' },
    focus: 'balanced',
    sessionSize: 'standard',
  })).not.toThrow();
});
```

### Step 2: Run the RED check

Run: `npx vitest run src/features/courses/courseModel.test.ts`

Expected: FAIL because the course model and projections do not exist.

### Step 3: Implement the bounded canonical contracts

Create `courseModel.ts` with these public shapes and functions:

```ts
export type CourseSourceV1 = 'personal' | 'catalog';
export type LearningFocusV1 = 'balanced' | 'learn' | 'hear' | 'speak';
export type SessionSizeV1 = 'short' | 'standard' | 'deep';

export const ADAPTIVE_SESSION_TARGETS = Object.freeze({
  short: 5, standard: 10, deep: 15,
} as const);

export interface CourseV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly ownerId: string | null;
  readonly contentLanguage: string;
  readonly supportLanguage: string;
  readonly title: string;
  readonly description: string;
  readonly source: CourseSourceV1;
  readonly archivedAt: string | null;
  readonly revision: number;
}

export interface ScenarioV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly courseId: string;
  readonly title: string;
  readonly rank: number;
}

export interface CourseItemV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly courseId: string;
  readonly scenarioId: string;
  readonly lexemeId: string;
  readonly rank: number;
}

export interface EnrollmentV1 {
  readonly schemaVersion: 1;
  readonly courseId: string;
  readonly activeScenarioId: string;
  readonly completedScenarioIds: readonly string[];
  readonly introducedItemIds: readonly string[];
  readonly updatedAt: string;
}

export interface LearningPreferencesV1 {
  readonly schemaVersion: 1;
  readonly useV3Courses: boolean;
  readonly activeCourseByLanguage: Readonly<Record<string, string>>;
  readonly focus: LearningFocusV1;
  readonly sessionSize: SessionSizeV1;
}

export interface CourseProjectionV1 {
  readonly course: CourseV1;
  readonly scenario: ScenarioV1;
  readonly items: readonly CourseItemV1[];
  readonly enrollment: EnrollmentV1;
  readonly preferences: LearningPreferencesV1;
}

export function createCourseId(source: CourseSourceV1, contentLanguage: string, key: string): string;
export function createScenarioId(courseId: string, title: string): string;
export function createCourseItemId(courseId: string, scenarioId: string, lexemeId: string): string;
export function parseCourseV1(value: unknown): CourseV1;
export function parseScenarioV1(value: unknown): ScenarioV1;
export function parseCourseItemV1(value: unknown): CourseItemV1;
export function parseEnrollmentV1(value: unknown): EnrollmentV1;
export function parseLearningPreferencesV1(value: unknown): LearningPreferencesV1;
```

Use strict exact-key parsing, `SCHEMA_V3_LIMITS`, canonical NFKC/trim strings,
the existing Firestore-segment rules for generated IDs, bounded ranks, dense
unique arrays, and canonical UTC timestamps. Generate IDs through the existing
`createMigrationFingerprint()` helper with a domain discriminator; do not call
the migration planner. Personal projections use sorted card IDs as lexeme IDs.
Catalog projections accept `readonly { lexemeId: string; rank: number }[]`, sort
by rank then lexeme ID, and keep the release/track identity in the generated
course key. Both projections create one default scenario and an empty
`introducedItemIds` list; they return `useV3Courses: false` because no migration
or activation write occurs here.

### Step 4: Run focused tests

Run: `npx vitest run src/features/courses/courseModel.test.ts src/features/multilingual/v2Migration.test.ts`

Expected: PASS; legacy migration tests are unchanged.

### Step 5: Commit the course slice

```bash
git add src/features/courses/courseModel.ts src/features/courses/courseModel.test.ts
git commit -m "feat: add canonical adaptive course domain"
```

## Checkpoint A: course domain

- `CourseV1` is the only Course contract in the repository.
- Personal and catalog projections share item identity rules and do not create a learning-state array.
- No file imports React, Firebase, browser globals, FSRS, or review persistence.

## Task 2: Add deterministic bounded recommendation

**Files:**
- Create: `src/features/adaptiveLearning/adaptiveRecommendation.ts`
- Test: `src/features/adaptiveLearning/adaptiveRecommendation.test.ts`

### Step 1: Write the failing recommendation tests

```ts
import { describe, expect, it } from 'vitest';
import type { CardData } from '../../types/card';
import type { SkillStateV4 } from '../skillEvidence/skillEvidenceModel';
import { createCourseItemId, type CourseItemV1 } from '../courses/courseModel';
import {
  createAdaptiveCandidateId,
  recommendNextActivity,
  type AdaptiveCandidateV1,
} from './adaptiveRecommendation';

const state = (listening: number | null, targetId = 'mature-item'): SkillStateV4 => ({
  schemaVersion: 4, ownerId: 'owner-a', target: { kind: 'lexeme', id: targetId },
  asOf: '2026-09-04T00:00:00.000Z',
  dimensions: {
    recognition: { score: 1, observations: 5, confidence: 1, lastObservedAt: '2026-09-04T00:00:00.000Z' },
    listening: { score: listening, observations: listening === null ? 0 : 5, confidence: listening === null ? 0 : 1, lastObservedAt: listening === null ? null : '2026-09-04T00:00:00.000Z' },
    context: { score: 1, observations: 5, confidence: 1, lastObservedAt: '2026-09-04T00:00:00.000Z' },
    production: { score: 1, observations: 5, confidence: 1, lastObservedAt: '2026-09-04T00:00:00.000Z' },
    pronunciation: { score: null, observations: 0, confidence: 0, lastObservedAt: null },
    speechMatch: { score: null, observations: 0, confidence: 0, lastObservedAt: null },
  },
});

const card = (id: string, overrides: Partial<CardData> = {}): CardData => ({
  id, word: id, normalizedWord: id, translation: `meaning-${id}`, explanation: '',
  phonetic: '', emoji: '📘', category: 'General', audioUrl: 'https://api.dictionaryapi.dev/audio.mp3', imageUrl: null,
  createdAt: '2026-09-01T00:00:00.000Z', customDeck: null, difficulty: 'unrated',
  ...overrides,
});

const candidate = (id: string, overrides: Partial<AdaptiveCandidateV1> = {}): AdaptiveCandidateV1 => {
  const item: CourseItemV1 = {
    schemaVersion: 1, id: createCourseItemId('course-a', 'scenario-a', id),
    courseId: 'course-a', scenarioId: 'scenario-a', lexemeId: id, rank: 1,
  };
  return {
    courseId: 'course-a', scenarioId: 'scenario-a', item, card: card(id),
    skillState: null, context: { chunkIds: [], hasExample: false },
    media: { licensedAudio: false, clipId: null, transcriptReady: false, availableOffline: false },
    ...overrides,
  };
};

const options = (overrides = {}) => ({
  activeCourseId: 'course-a', activeScenarioId: 'scenario-a',
  now: new Date('2026-09-04T08:00:00.000Z'), focus: 'balanced' as const,
  sessionSize: 'standard' as const, isOffline: false, recentModes: [],
  skippedActivityIds: new Set<string>(), introducedItemIds: new Set<string>(),
  newItemsRemaining: 8, ...overrides,
});

it('prioritizes an overdue item before a new item and reports the session bound', () => {
  const result = recommendNextActivity([
    candidate('new-item'),
    candidate('due-item', { card: card('due-item', { nextReviewDate: '2026-09-03T08:00:00.000Z', reviews: 1, difficulty: 'hard' }) }),
  ], options());
  expect(result).toMatchObject({ kind: 'exercise', lexemeId: 'due-item', reason: { kind: 'due' }, window: { targetActivities: 10, maximumNewItems: 8 } });
});

it('uses a verified licensed clip for Hear and never emits one offline when uncached', () => {
  const result = recommendNextActivity([candidate('immerse-item', {
    media: { licensedAudio: true, clipId: 'clip-1', transcriptReady: true, availableOffline: false },
  })], options({ focus: 'hear', isOffline: true }));
  expect(result).toMatchObject({ kind: 'exercise', fallbackFrom: 'hear' });
  const online = recommendNextActivity([candidate('immerse-item', {
    media: { licensedAudio: true, clipId: 'clip-1', transcriptReady: true, availableOffline: false },
  })], options({ focus: 'hear' }));
  expect(online).toMatchObject({ kind: 'immerse', clipId: 'clip-1' });
});

it('uses the lowest eligible SkillState dimension after review/new priorities', () => {
  const result = recommendNextActivity([
    candidate('mature-item', {
      card: card('mature-item', { difficulty: 'good', reviews: 3, nextReviewDate: '2026-10-01T00:00:00.000Z' }),
      skillState: state(null, 'mature-item'),
    }),
  ], options());
  expect(result).toMatchObject({ kind: 'exercise', lexemeId: 'mature-item', mode: 'listening', reason: { kind: 'skill-gap' } });
});

it('falls back from Speak without claiming pronunciation or speech assessment', () => {
  const result = recommendNextActivity([candidate('speak-item')], options({ focus: 'speak' }));
  expect(result).toMatchObject({ kind: 'exercise', mode: 'active-recall', fallbackFrom: 'speak' });
  expect(JSON.stringify(result)).not.toMatch(/pronunciation|native|accent|fluency|prosody/i);
});

it('temporarily deprioritizes a skipped candidate and does not mutate its card', () => {
  const skipped = candidate('skipped-item');
  const next = candidate('next-item', { item: { ...skipped.item, id: `${skipped.item.id}-next`, lexemeId: 'next-item' } });
  const result = recommendNextActivity([skipped, next], options({ skippedActivityIds: new Set([createAdaptiveCandidateId(skipped)]) }));
  expect(result).toMatchObject({ lexemeId: 'next-item' });
  expect(skipped.card.difficulty).toBe('unrated');
});

it('returns explicit empty/completion states for bounded candidate sets', () => {
  expect(recommendNextActivity([], options())).toMatchObject({ kind: 'empty', reason: 'no-content' });
  const mature = candidate('complete-item', { card: card('complete-item', { difficulty: 'good', reviews: 4, nextReviewDate: '2026-10-01T00:00:00.000Z' }), skillState: state(1) });
  expect(recommendNextActivity([mature], options())).toMatchObject({ kind: 'course-complete' });
});
```

### Step 2: Run the RED check

Run: `npx vitest run src/features/adaptiveLearning/adaptiveRecommendation.test.ts`

Expected: FAIL because the candidate contract and selector do not exist.

### Step 3: Implement the pure selector

Expose these contracts:

```ts
export type AdaptiveActivityModeV1 = ExerciseMode | 'immerse';
export type AdaptiveRecommendationReasonKindV1 = 'due' | 'weak' | 'new' | 'skill-gap' | 'next';

export interface AdaptiveCandidateV1 {
  readonly courseId: string;
  readonly scenarioId: string;
  readonly item: CourseItemV1;
  readonly card: CardData;
  readonly skillState: SkillStateV4 | null;
  readonly context: { readonly chunkIds: readonly string[]; readonly hasExample: boolean };
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
  readonly introducedItemIds: ReadonlySet<string>;
  readonly newItemsRemaining: number;
}

export interface AdaptiveRecommendationWindowV1 {
  readonly targetActivities: 5 | 10 | 15;
  readonly maximumNewItems: 8;
}

export type AdaptiveRecommendationV1 =
  | { readonly kind: 'empty'; readonly reason: 'no-content' | 'no-eligible-activity'; readonly window: AdaptiveRecommendationWindowV1 }
  | { readonly kind: 'course-complete'; readonly courseId: string; readonly scenarioId: string; readonly window: AdaptiveRecommendationWindowV1 }
  | {
      readonly kind: 'exercise';
      readonly activityId: string;
      readonly courseId: string;
      readonly scenarioId: string;
      readonly lexemeId: string;
      readonly card: CardData;
      readonly mode: ExerciseMode;
      readonly reason: { readonly kind: AdaptiveRecommendationReasonKindV1; readonly label: string };
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
      readonly reason: { readonly kind: AdaptiveRecommendationReasonKindV1; readonly label: string };
      readonly window: AdaptiveRecommendationWindowV1;
    };

export const createAdaptiveCandidateId = (candidate: AdaptiveCandidateV1): string => (
  JSON.stringify([candidate.courseId, candidate.scenarioId, candidate.item.lexemeId])
);

export function recommendNextActivity(
  candidates: readonly AdaptiveCandidateV1[],
  options: AdaptiveRecommendationOptions,
): AdaptiveRecommendationV1;
```

Reject candidate arrays larger than 15 before eligibility work. For an accepted
array, filter to the active course/scenario, validate item identity, and use
`buildDailyPlan(activeCards, { now, maximum: 15, targetMinimum: 1 })` to reuse
due/weak/new classification. Group those results by reason in that order;
never scan or score an unbounded source. Use stable `(item.rank, lexemeId)` ties.
Expose `targetActivities` from `ADAPTIVE_SESSION_TARGETS`, always set
`maximumNewItems` to 8, and require `newItemsRemaining` in `0..8` to enforce
the current window's introduction budget across due, weak, skill-gap, new, and
next selection. When it reaches zero, unintroduced memberships are excluded;
already-introduced cards can still be practiced.

For each priority group, choose the best focus-compatible candidate:

- `hear`: return `immerse` only when `licensedAudio && clipId && transcriptReady`
  and either online or `availableOffline`; otherwise choose existing listening
  when `getEligibleExerciseModes()` allows it, then active recall with
  `fallbackFrom: 'hear'`. Listening is a successful Hear result and therefore
  has no `fallbackFrom` field.
- `learn`: prefer recognition, then active recall.
- `speak`: use active recall as an honest text-production fallback and set
  `fallbackFrom: 'speak'`; never emit pronunciation claims.
- `balanced`: prefer the lowest available listening/context/recognition/
  production SkillState score, treating `null` as unobserved, then choose the
  least-recent eligible existing mode.

After due/weak/new groups, use skill-gap candidates with an eligible mode. If
no open signal remains, return `course-complete`; if the active course/scenario
has no candidates, return `empty`. A skipped candidate is excluded while an
alternative exists and may be reused only when every candidate is skipped.
The function returns data only: it must not mutate cards, states, FSRS, or the
skipped set.

### Step 4: Run focused tests

Run: `npx vitest run src/features/adaptiveLearning/adaptiveRecommendation.test.ts src/features/dailyLearning/dailyPlan.test.ts src/features/dailyLearning/exerciseEngine.test.ts`

Expected: PASS with deterministic output for repeated and reordered inputs.

### Step 5: Commit the recommendation slice

```bash
git add src/features/adaptiveLearning/adaptiveRecommendation.ts src/features/adaptiveLearning/adaptiveRecommendation.test.ts
git commit -m "feat: add bounded adaptive recommendation"
```

## Checkpoint B: pure Learn → Immerse core

- Course projections and recommendations have no production persistence or UI caller.
- Due/weak/new ordering comes from `buildDailyPlan()`; exercise eligibility comes from `getEligibleExerciseModes()`.
- Licensed media and SkillState are inputs only; no URL is treated as rights evidence.
- `speak` remains an honest fallback and cannot populate pronunciation evidence.

## Task 3: Documentation and contract closure

**Files:**
- Modify: `docs/superpowers/specs/2026-09-04-adaptive-learning-core-increment5-design.md`
- Modify: `docs/superpowers/plans/2026-09-04-adaptive-learning-core-increment5.md`

- [x] Mark the design's reconciliation map and non-goals against the actual exported types.
- [x] Record the verified implementation SHA `e6f9f3c`; deferred persistence/UI/migration remain explicit.
- [x] Do not add a second design or plan for the same Course/Scenario domain.

## Task 4: Verification and assurance review

- [x] Run `npx vitest run src/features/courses src/features/adaptiveLearning`.
- [x] Run `npm run catalog:verify`.
- [x] Run `npm run lint`.
- [x] Run `npm test -- --run` (1,792 tests).
- [x] Run `npm run build`.
- [x] Run `git diff --check e5386cf..e6f9f3c` and inspect the final diff for forbidden UI, storage, migration, FSRS, media-fetch, provider, or publication changes.
- [x] Dispatch separate read-only correctness and security reviewers after verification; resolve any substantiated finding and re-run affected checks.
- [x] Record the verified implementation SHA `e6f9f3c` and the limitation that persistence, migration, and UI wiring are later increments.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| A second Course/Scenario model appears later | Divergent progress semantics | Retain the proposal's `*V1` names and map every requested concept in the design doc |
| Recommendation bypasses existing FSRS priority | Review backlog is ignored | Delegate due/weak/new classification to `buildDailyPlan()` |
| Unlicensed/uncached media is recommended | Rights/offline failure | Require explicit capability, clip ID, transcript readiness, and offline availability |
| Missing SkillState is treated as mastery | False personalization | Treat `null` as unobserved and use only as a preference signal |
| Pure contracts are mistaken for shipped adaptive UI | Product claim exceeds runtime | Keep no production callers in this increment and document the boundary |

## Deferred by design

Firestore/IndexedDB persistence, Rules, v2 migration/rollback, automatic FSRS
rating, Learn UI/navigation, activity producers, text/voice conversation, real
pronunciation providers, media ingestion, and catalog publication remain outside
this increment.
