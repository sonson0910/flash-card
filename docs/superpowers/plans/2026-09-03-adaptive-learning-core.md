# Adaptive Learning Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Learn proactively recommend and run course-scoped mixed lessons for personal and installed catalog vocabulary while preserving all existing FSRS progress through an additive, rollback-safe v3 migration.

**Architecture:** Add a pure adaptive-learning domain above the existing exercise builders and review command, and add owner-scoped course organization around the existing `LexemeV3`/`LearningStateV3` seam. Project legacy cards into courses immediately, then add validated Firestore persistence and a resumable operator migration without deleting v2 data.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, Vitest 3, Firebase 12/Firestore, Firebase Admin Functions, Playwright, `ts-fsrs`, existing Tailwind CSS and Radix primitives.

**Spec:** `docs/superpowers/specs/2026-09-03-adaptive-learning-core-design.md`

## Global Constraints

- Use Node `>=22 <23`; add no runtime dependency.
- Preserve v2 cards, review history, FSRS, bookmarks, difficulty, revision, library epoch, and the legacy custom-deck profile.
- Never publish Internet/catalog content or deploy production resources in this plan.
- Keep all candidate reads bounded and owner-scoped; stale owner/course requests cannot publish state.
- Reuse the existing exercise builders and idempotent review command; do not create another scheduler.
- Normal lessons auto-propose ratings, but only the primary `Continue` action persists them; dedicated Review remains manual.
- Do not render unavailable video or conversation activities; fall back to an eligible activity with an explanation.
- Keep new presentation lazy, keyboard operable, screen-reader announced, reduced-motion safe, and within the existing bundle budget.
- For Task 7, load `frontend-ui-engineering` and `react-bits`; inspect the global React Bits catalog and reuse a component only when it directly fits the approved interaction.
- Use TDD for every behavior change and run each named RED command before production code.
- Do not touch the unrelated untracked `.serena/` directory or `zen-preview.html`.

---

### Task 1: Course, scenario, and membership domain

**Files:**
- Create: `src/features/courses/courseModel.ts`
- Create: `src/features/courses/courseModel.test.ts`

**Interfaces:**
- Consumes: `CardData`, `LexemeV3`, `LearningStateV3`, `planV2CardMigration()`.
- Produces: `CourseV1`, `ScenarioV1`, `CourseItemV1`, `EnrollmentV1`, `LearningPreferencesV1`, strict parsers, deterministic IDs, and `projectLegacyLibraryToCourses()`.

- [ ] **Step 1: Write failing domain and validation tests**

```ts
import { describe, expect, it } from 'vitest';
import type { CardData } from '../../types/card';
import {
  createCourseItemId,
  projectLegacyLibraryToCourses,
  parseLearningPreferencesV1,
} from './courseModel';

const card = (id: string, word: string, customDeck: string | null): CardData => ({
  id, word, normalizedWord: word, translation: `vi-${word}`, explanation: '',
  phonetic: '', emoji: '📘', category: 'General', audioUrl: null, imageUrl: null,
  customDeck, createdAt: '2026-09-01T00:00:00.000Z', difficulty: 'unrated',
});

it('projects each legacy deck plus unassigned cards without duplicating learning state', () => {
  const result = projectLegacyLibraryToCourses({
    ownerId: 'owner-a',
    migratedAt: '2026-09-03T00:00:00.000Z',
    decks: ['IELTS'],
    cards: [card('one', 'focus', 'IELTS'), card('two', 'plain', null)],
  });
  expect(result.courses.map(course => course.title)).toEqual(['IELTS', 'My Vocabulary']);
  expect(result.items).toHaveLength(2);
  expect(new Set(result.learningStates.map(state => state.lexemeId)).size).toBe(2);
});

it('uses course, scenario, and lexeme identity for memberships', () => {
  expect(createCourseItemId('course-a', 'scenario-a', 'lexeme-a'))
    .not.toBe(createCourseItemId('course-a', 'scenario-b', 'lexeme-a'));
});

it('rejects a preference that activates two courses for one language', () => {
  expect(() => parseLearningPreferencesV1({
    schemaVersion: 1,
    useV3Courses: false,
    activeCourseByLanguage: { en: ['course-a', 'course-b'] },
    focus: 'balanced',
    sessionSize: 'standard',
  })).toThrow(/active course/i);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `vitest run src/features/courses/courseModel.test.ts`

Expected: FAIL because `courseModel.ts` and the new parsers/types do not exist.

- [ ] **Step 3: Add the bounded domain contracts and legacy projection**

```ts
export type CourseSourceV1 = 'personal' | 'catalog';
export type LearningFocusV1 = 'balanced' | 'learn' | 'hear' | 'speak';
export type SessionSizeV1 = 'short' | 'standard' | 'deep';

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
  readonly updatedAt: string;
}

export interface LearningPreferencesV1 {
  readonly schemaVersion: 1;
  readonly useV3Courses: boolean;
  readonly activeCourseByLanguage: Readonly<Record<string, string>>;
  readonly focus: LearningFocusV1;
  readonly sessionSize: SessionSizeV1;
}
```

Use the existing Firestore-segment guard, `SCHEMA_V3_LIMITS`, and `createMigrationFingerprint()` for IDs. In `projectLegacyLibraryToCourses()`, sort normalized deck names, append `My Vocabulary` only when needed, call `planV2CardMigration()` once per card, and create one default scenario/item per projected course. Keep strict course parsers in `courseModel.ts`; retain `customCollections: 1` as a v3 compatibility field because course membership no longer lives there.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `vitest run src/features/courses/courseModel.test.ts src/features/multilingual/v2Migration.test.ts`

Expected: PASS with no warnings.

- [ ] **Step 5: Commit the domain slice**

```bash
git add src/features/courses/courseModel.ts src/features/courses/courseModel.test.ts
git commit -m "feat: add adaptive course domain"
```

---

### Task 2: Deterministic next-activity recommendation

**Files:**
- Create: `src/features/adaptiveLearning/adaptiveRecommendation.ts`
- Create: `src/features/adaptiveLearning/adaptiveRecommendation.test.ts`
- Modify: `src/features/dailyLearning/dailyPlan.ts`
- Modify: `src/features/dailyLearning/dailyPlan.test.ts`

**Interfaces:**
- Consumes: `CourseItemV1`, `CardData`, `buildDailyPlan()`, `getEligibleExerciseModes()`.
- Produces: `AdaptiveRecommendation`, `AdaptiveRecommendationOptions`, `createAdaptiveActivityId()`, `recommendNextActivity()` and exported daily-plan classification needed to explain the choice.

- [ ] **Step 1: Write failing recommendation tests**

```ts
const now = new Date('2026-09-03T08:00:00.000Z');
const candidate = (lexemeId: string, rank: number, due: string | null): AdaptiveCandidate => ({
  courseId: 'course-a', scenarioId: 'scenario-a', lexemeId, rank,
  card: {
    id: lexemeId, word: lexemeId, translation: `vi-${lexemeId}`, explanation: '',
    phonetic: '', emoji: '📘', category: 'General', audioUrl: '/audio.mp3', imageUrl: null,
    difficulty: due ? 'hard' : 'unrated', ...(due ? { nextReviewDate: due, reviews: 1 } : {}),
  },
});
const candidates = [
  candidate('lexeme-fresh', 0, null),
  candidate('lexeme-due', 1, '2026-09-02T08:00:00.000Z'),
];
const baseOptions: AdaptiveRecommendationOptions = {
  now, focus: 'balanced', isOffline: false, recentModes: [], skippedActivityIds: new Set(),
};

it('prioritizes an overdue course item and explains the recommendation', () => {
  const result = recommendNextActivity(candidates, baseOptions);
  expect(result).toMatchObject({
    kind: 'exercise',
    lexemeId: 'lexeme-due',
    reason: { kind: 'due', label: '1 review is due' },
  });
});

it('honors a speaking focus only when an eligible speaking activity exists', () => {
  const candidatesWithoutSpeech = candidates.map(entry => ({
    ...entry, card: { ...entry.card, audioUrl: null },
  }));
  expect(recommendNextActivity(candidatesWithoutSpeech, {
    now, focus: 'speak', isOffline: true, recentModes: [], skippedActivityIds: new Set(),
  })).toMatchObject({ kind: 'exercise', fallbackFrom: 'speak' });
});

it('temporarily deprioritizes skipped activities without changing card state', () => {
  const skippedId = createAdaptiveActivityId(candidates[0]);
  const skipped = new Set([skippedId]);
  expect(recommendNextActivity(candidates, { ...baseOptions, skippedActivityIds: skipped }))
    .not.toMatchObject({ activityId: skippedId });
  expect(candidates[0].card.difficulty).toBe('unrated');
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `vitest run src/features/adaptiveLearning/adaptiveRecommendation.test.ts src/features/dailyLearning/dailyPlan.test.ts`

Expected: FAIL because `recommendNextActivity()` and the public classification seam are missing.

- [ ] **Step 3: Implement the smallest deterministic selector**

```ts
export type AdaptiveRecommendation =
  | { readonly kind: 'empty'; readonly reason: 'no-course' | 'no-content' }
  | { readonly kind: 'course-complete'; readonly courseId: string; readonly reason: string }
  | {
      readonly kind: 'exercise';
      readonly activityId: string;
      readonly lexemeId: string;
      readonly card: CardData;
      readonly mode: ExerciseMode;
      readonly reason: { readonly kind: DailyPlanReason | 'skill-gap'; readonly label: string };
      readonly fallbackFrom?: Exclude<LearningFocusV1, 'balanced'>;
    };

export interface AdaptiveCandidate {
  readonly courseId: string;
  readonly scenarioId: string;
  readonly lexemeId: string;
  readonly rank: number;
  readonly card: CardData;
}

export interface AdaptiveRecommendationOptions {
  readonly now: Date;
  readonly focus: LearningFocusV1;
  readonly isOffline: boolean;
  readonly recentModes: readonly ExerciseMode[];
  readonly skippedActivityIds: ReadonlySet<string>;
}

export const createAdaptiveActivityId = (candidate: AdaptiveCandidate): string =>
  JSON.stringify([candidate.courseId, candidate.scenarioId, candidate.lexemeId]);

export function recommendNextActivity(
  candidates: readonly AdaptiveCandidate[],
  options: AdaptiveRecommendationOptions,
): AdaptiveRecommendation {
  const available = candidates.filter(candidate => !options.skippedActivityIds.has(createAdaptiveActivityId(candidate)));
  const plan = buildDailyPlan(available.map(candidate => candidate.card), { now: options.now, maximum: 15 });
  return chooseEligibleRecommendation(plan, available, options);
}
```

Keep `chooseEligibleRecommendation()` pure. Priority is due, weak, capped new, then least-recent eligible mode. Use stable membership rank and lexeme ID ties. Map Hear to existing listening and Speak to existing active-recall unless a real speaking capability is present; include `fallbackFrom` in that case.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `vitest run src/features/adaptiveLearning/adaptiveRecommendation.test.ts src/features/dailyLearning/dailyPlan.test.ts src/features/dailyLearning/exerciseEngine.test.ts`

Expected: PASS with deterministic snapshots across repeated runs.

- [ ] **Step 5: Commit the recommendation slice**

```bash
git add src/features/adaptiveLearning/adaptiveRecommendation.ts src/features/adaptiveLearning/adaptiveRecommendation.test.ts src/features/dailyLearning/dailyPlan.ts src/features/dailyLearning/dailyPlan.test.ts
git commit -m "feat: recommend the next learning activity"
```

---

### Task 3: Automatic rating with a learner correction path

**Files:**
- Create: `src/features/adaptiveLearning/automaticRating.ts`
- Create: `src/features/adaptiveLearning/automaticRating.test.ts`
- Modify: `src/features/dailyLearning/dailyLearningPresentation.ts`
- Modify: `src/features/dailyLearning/DailyLearningScreens.test.tsx`
- Modify: `src/features/dailyLearning/LessonScreen.tsx`

**Interfaces:**
- Consumes: `ReviewRatingValue`.
- Produces: `AutomaticRatingEvidence`, `proposeAutomaticRating()`, and lesson feedback fields `proposedRating`, `ratingOptions`, and `ratingChanged`.

- [ ] **Step 1: Write failing rating tests**

```ts
it.each([
  [{ correct: false, assisted: false, elapsedMs: 500, fastThresholdMs: 2_000, timerReliable: true }, 'again'],
  [{ correct: true, assisted: true, elapsedMs: 500, fastThresholdMs: 2_000, timerReliable: true }, 'hard'],
  [{ correct: true, assisted: false, elapsedMs: 3_000, fastThresholdMs: 2_000, timerReliable: true }, 'good'],
  [{ correct: true, assisted: false, elapsedMs: 500, fastThresholdMs: 2_000, timerReliable: true }, 'easy'],
  [{ correct: true, assisted: false, elapsedMs: 500, fastThresholdMs: 2_000, timerReliable: false }, 'good'],
])('proposes a bounded FSRS rating from %o', (evidence, expected) => {
  expect(proposeAutomaticRating(evidence)).toBe(expected);
});
```

Add a rendering test asserting one primary `Continue` button plus an optional `Change rating` disclosure, rather than four required rating buttons.

- [ ] **Step 2: Run the tests and verify RED**

Run: `vitest run src/features/adaptiveLearning/automaticRating.test.ts src/features/dailyLearning/DailyLearningScreens.test.tsx`

Expected: FAIL because the rating helper and presentation fields are absent.

- [ ] **Step 3: Implement rating derivation and presentation contracts**

```ts
export interface AutomaticRatingEvidence {
  readonly correct: boolean;
  readonly assisted: boolean;
  readonly elapsedMs: number;
  readonly fastThresholdMs: number;
  readonly timerReliable: boolean;
}

export function proposeAutomaticRating(evidence: AutomaticRatingEvidence): ReviewRatingValue {
  if (!evidence.correct) return 'again';
  if (evidence.assisted) return 'hard';
  if (evidence.timerReliable && evidence.elapsedMs >= 0 && evidence.elapsedMs <= evidence.fastThresholdMs) return 'easy';
  return 'good';
}
```

Reject non-finite thresholds/times before calling this function at the UI boundary. The presentation model exposes the proposal but does not persist it or award progress.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `vitest run src/features/adaptiveLearning/automaticRating.test.ts src/features/dailyLearning/DailyLearningScreens.test.tsx`

Expected: PASS; feedback markup contains a rating label, `Continue`, and a keyboard-operable correction control.

- [ ] **Step 5: Commit the automatic-rating slice**

```bash
git add src/features/adaptiveLearning/automaticRating.ts src/features/adaptiveLearning/automaticRating.test.ts src/features/dailyLearning/dailyLearningPresentation.ts src/features/dailyLearning/DailyLearningScreens.test.tsx src/features/dailyLearning/LessonScreen.tsx
git commit -m "feat: propose lesson review ratings"
```

---

### Task 4: Recalculating mixed-session state machine

**Files:**
- Create: `src/features/adaptiveLearning/adaptiveSession.ts`
- Create: `src/features/adaptiveLearning/adaptiveSession.test.ts`
- Modify: `src/features/dailyLearning/dailySessionController.ts`
- Modify: `src/features/dailyLearning/dailySessionController.test.ts`

**Interfaces:**
- Consumes: `AdaptiveRecommendation`, `Exercise`, `ReviewRatingValue`, existing idempotent `reviewCard()` port.
- Produces: `AdaptiveSessionState`, `AdaptiveSessionEvent`, `reduceAdaptiveSession()`, and `createAdaptiveSessionController()`.

- [ ] **Step 1: Write failing reducer/controller tests**

```ts
const sessionCard: CardData = {
  id: 'lexeme-a', word: 'focus', translation: 'tập trung', explanation: '',
  phonetic: '', emoji: '🎯', category: 'General', audioUrl: '/focus.mp3', imageUrl: null,
};
const firstRecommendation: AdaptiveRecommendation = {
  kind: 'exercise', activityId: 'activity-a', lexemeId: 'lexeme-a', card: sessionCard,
  mode: 'recognition', reason: { kind: 'new', label: 'Learn the next word' },
};
const secondRecommendation: AdaptiveRecommendation = {
  ...firstRecommendation, activityId: 'activity-b', mode: 'listening',
  reason: { kind: 'skill-gap', label: 'Listening needs practice' },
};
const recommend = vi.fn()
  .mockReturnValueOnce(firstRecommendation)
  .mockReturnValueOnce(secondRecommendation);
const makeExercise = vi.fn((recommendation: Extract<AdaptiveRecommendation, { kind: 'exercise' }>) =>
  buildExercise(recommendation.card, [recommendation.card], recommendation.mode));
const reviewCard = vi.fn(async () => undefined);
const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));
const controller = createAdaptiveSessionController({ recommend, buildExercise: makeExercise, reviewCard });

it('requests a fresh recommendation after a saved activity', async () => {
  controller.start({ sessionSize: 'short' });
  controller.submit('correct', { elapsedMs: 900, timerReliable: true, assisted: false });
  controller.continueWithRating('good');
  await flushPromises();
  expect(reviewCard).toHaveBeenCalledTimes(1);
  expect(recommend).toHaveBeenCalledTimes(2);
  expect(controller.getSnapshot()).toMatchObject({ completed: 1, target: 5, phase: 'question' });
});

it('keeps the same question actionable when persistence fails', async () => {
  reviewCard.mockRejectedValueOnce(new Error('offline'));
  controller.continueWithRating('good');
  await flushPromises();
  expect(controller.getSnapshot()).toMatchObject({ phase: 'save-error', completed: 0 });
});

it('skips without writing learning state and recomputes', () => {
  controller.skip();
  expect(reviewCard).not.toHaveBeenCalled();
  expect(recommend).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `vitest run src/features/adaptiveLearning/adaptiveSession.test.ts src/features/dailyLearning/dailySessionController.test.ts`

Expected: FAIL because the adaptive session controller does not exist.

- [ ] **Step 3: Implement the reducer and one persistence effect**

```ts
export type AdaptiveSessionState =
  | { readonly phase: 'idle'; readonly completed: 0; readonly target: number }
  | { readonly phase: 'question' | 'feedback' | 'persisting' | 'save-error'; readonly completed: number; readonly target: number; readonly current: AdaptiveActivity }
  | { readonly phase: 'complete'; readonly completed: number; readonly target: number };

export type AdaptiveActivity = Extract<AdaptiveRecommendation, { readonly kind: 'exercise' }> & {
  readonly exercise: Exercise;
  readonly operationId: string;
};

export type AdaptiveSessionEvent =
  | { readonly type: 'recommended'; readonly activity: AdaptiveActivity }
  | { readonly type: 'answered'; readonly correct: boolean; readonly proposedRating: ReviewRatingValue }
  | { readonly type: 'saving'; readonly rating: ReviewRatingValue }
  | { readonly type: 'saved'; readonly next: AdaptiveActivity | null }
  | { readonly type: 'save-failed'; readonly message: string }
  | { readonly type: 'skipped'; readonly next: AdaptiveActivity | null }
  | { readonly type: 'closed' };

export interface AdaptiveSessionController {
  getSnapshot(): AdaptiveSessionState;
  subscribe(listener: (state: AdaptiveSessionState) => void): () => void;
  start(options: { readonly sessionSize: SessionSizeV1 }): void;
  submit(answer: ExerciseAnswer, evidence: Omit<AutomaticRatingEvidence, 'correct'>): void;
  continueWithRating(rating: ReviewRatingValue): Promise<void>;
  retry(): Promise<void>;
  skip(): void;
  close(): void;
}
```

Keep state transitions pure. The controller owns exactly one async effect: call the existing review port with a stable operation ID, then request the next recommendation. Ignore completions from stale owner/course generations.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `vitest run src/features/adaptiveLearning/adaptiveSession.test.ts src/features/dailyLearning/dailySessionController.test.ts src/features/dailyLearning/lessonReducer.test.ts`

Expected: PASS, including retry idempotency and stale-owner cases.

- [ ] **Step 5: Commit the mixed-session slice**

```bash
git add src/features/adaptiveLearning/adaptiveSession.ts src/features/adaptiveLearning/adaptiveSession.test.ts src/features/dailyLearning/dailySessionController.ts src/features/dailyLearning/dailySessionController.test.ts
git commit -m "feat: add adaptive mixed lesson sessions"
```

---

### Task 5: Owner-scoped course persistence and Firestore Rules

**Files:**
- Create: `src/features/courses/courseFirebaseRepository.ts`
- Create: `src/features/courses/courseFirebaseRepository.test.ts`
- Create: `src/features/courses/courseRepository.ts`
- Modify: `src/app/appDependencies.ts`
- Modify: `src/app/appDependencies.test.ts`
- Modify: `firestore.rules`
- Modify: `firestore.rules.test.ts`

**Interfaces:**
- Consumes: Task 1 parsers and Firestore document-segment validation.
- Produces: `CourseRepository.readWorkspace(ownerId, maximum)`, `savePreferences()`, `archiveCourse()`, repository dependency injection, and deny-by-default Rules for every new path.

- [ ] **Step 1: Write failing repository and Rules tests**

```ts
it('reads only the requested owner with bounded course and item limits', async () => {
  const result = await repository.readWorkspace('owner-a', 100);
  expect(result.courses).toEqual([courseA]);
  expect(queryCalls.every(call => call.path.startsWith('users/owner-a/'))).toBe(true);
  expect(queryCalls.every(call => call.limit <= 100)).toBe(true);
});

it('archives course metadata without deleting lexemes or learning state', async () => {
  await repository.archiveCourse('owner-a', 'course-a', '2026-09-03T10:00:00.000Z');
  expect(writes).toContainEqual(expect.objectContaining({ path: 'users/owner-a/courses/course-a' }));
  expect(writes.some(write => /lexemes|learning_states/.test(write.path))).toBe(false);
});
```

Add emulator cases that allow valid owner reads/writes and reject cross-owner access, unknown fields, mismatched path IDs, oversized text/arrays, owner mutation, direct physical course deletion, and writes to migration evidence.

- [ ] **Step 2: Run the tests and verify RED**

Run: `vitest run src/features/courses/courseFirebaseRepository.test.ts src/app/appDependencies.test.ts`

Run: `npx firebase-tools emulators:exec --only firestore --project demo-lingoflash "vitest run --config vitest.rules.config.ts"`

Expected: repository tests fail for missing files; Rules tests fail because the new paths are denied or unvalidated.

- [ ] **Step 3: Implement the repository and exact Rules allowlists**

```ts
export interface CourseWorkspaceSnapshot {
  readonly courses: readonly CourseV1[];
  readonly scenarios: readonly ScenarioV1[];
  readonly items: readonly CourseItemV1[];
  readonly enrollments: readonly EnrollmentV1[];
  readonly preferences: LearningPreferencesV1;
}

export interface CourseRepository {
  readWorkspace(ownerId: string, maximum?: number): Promise<CourseWorkspaceSnapshot>;
  savePreferences(ownerId: string, preferences: LearningPreferencesV1): Promise<void>;
  archiveCourse(ownerId: string, courseId: string, archivedAt: string): Promise<void>;
}
```

Use exact parser validation after reads, `limit(maximum)`, deterministic document paths, and merge-free writes for strict documents. Rules must require `request.auth.uid == userId`, exact key sets, bounded values, path/body identity equality, and `archivedAt` transitions instead of client deletion.

- [ ] **Step 4: Run repository and Rules tests and verify GREEN**

Run: `vitest run src/features/courses/courseFirebaseRepository.test.ts src/app/appDependencies.test.ts`

Run: `npm run test:rules`

Expected: PASS with all denial cases enforced.

- [ ] **Step 5: Commit the persistence slice**

```bash
git add src/features/courses/courseRepository.ts src/features/courses/courseFirebaseRepository.ts src/features/courses/courseFirebaseRepository.test.ts src/app/appDependencies.ts src/app/appDependencies.test.ts firestore.rules firestore.rules.test.ts
git commit -m "feat: persist owner-scoped learning courses"
```

---

### Task 6: Resumable v2-to-course migration and rollback

**Files:**
- Create: `functions/src/adaptiveLearningMigration.ts`
- Create: `functions/src/adaptiveLearningMigrationOperator.ts`
- Create: `functions/test/adaptiveLearningMigration.test.ts`
- Create: `functions/test/adaptiveLearningMigrationFirestore.integration.test.ts`
- Modify: `functions/package.json`
- Modify: `package.json`
- Modify: `firestore.rules`
- Modify: `firestore.rules.test.ts`

**Interfaces:**
- Consumes: existing Admin migration fence, owner-scope validation, revision/fingerprint patterns, v2 cards, and legacy custom-deck profile.
- Produces: `dryRunAdaptiveLearningMigration()`, `applyAdaptiveLearningMigration()`, `rollbackAdaptiveLearningMigration()`, cursor/job documents, and operator scripts.

- [ ] **Step 1: Write failing migration unit and emulator tests**

```ts
it('plans deterministic personal courses while preserving normalized learning fields', () => {
  const plan = planAdaptiveLearningMigration(ownerFixture, cardsFixture, ['IELTS']);
  expect(plan.courseWrites.map(write => write.id)).toEqual(planAgain.courseWrites.map(write => write.id));
  expect(plan.learningStateWrites[0].data.fsrs).toEqual(cardsFixture[0].fsrs);
  expect(plan.rollback.cards[0]).toEqual(normalizeLegacyCard(cardsFixture[0]));
});

it('resumes after the last verified source document without repeating applied writes', async () => {
  await applyAdaptiveLearningMigration(database, 'owner-a', { jobId: 'job-a', batchSize: 2, sourceRevision });
  await applyAdaptiveLearningMigration(database, 'owner-a', { jobId: 'job-a', batchSize: 2, sourceRevision });
  expect(await readJob()).toMatchObject({ complete: true, scanned: 3 });
  expect(await countLearningStates()).toBe(3);
});

it('rollback restores compatibility selection and retains the original cards', async () => {
  await rollbackAdaptiveLearningMigration(database, 'owner-a', 'job-a', sourceRevision);
  expect(await readPreferences()).toMatchObject({ schemaVersion: 1, useV3Courses: false });
  expect(await readLegacyCards()).toEqual(originalCards);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm --prefix functions test -- adaptiveLearningMigration.test.ts`

Run: `npx firebase-tools emulators:exec --only firestore --project demo-lingoflash "npm --prefix functions test -- adaptiveLearningMigrationFirestore.integration.test.ts"`

Expected: both commands FAIL because the migration planner/operator is missing.

- [ ] **Step 3: Implement the bounded operator by reusing existing migration guards**

```ts
export interface AdaptiveMigrationOptions {
  readonly jobId: string;
  readonly batchSize: number;
  readonly sourceRevision: string;
}

export interface AdaptiveMigrationJob {
  readonly jobId: string;
  readonly ownerId: string;
  readonly phase: 'verify' | 'apply' | 'complete' | 'rollback' | 'rolled-back';
  readonly lastDocumentId: string | null;
  readonly scanned: number;
  readonly written: number;
  readonly sourceRevision: string;
}

export async function applyAdaptiveLearningMigration(
  database: FirebaseFirestore.Firestore,
  ownerId: string,
  options: AdaptiveMigrationOptions,
): Promise<AdaptiveMigrationJob> {
  const fence = await beginAdaptiveMigrationFence(database, ownerId, options);
  try {
    return await applyNextVerifiedPage(database, ownerId, fence, options);
  } finally {
    await releaseAdaptiveMigrationFence(database, ownerId, fence);
  }
}
```

Use Admin-only job and rollback collections, a 12-character owner key, a 64-character source revision, explicit apply/rollback confirmation strings, bounded batches, deterministic IDs, write preconditions, after-write re-reads, source fingerprints, and the existing fail-closed fence pattern. Applying sets `useV3Courses: true` only after the complete aggregate verifies. Rollback never deletes v2 cards because apply never modified them.

- [ ] **Step 4: Run migration unit and Firestore integration tests and verify GREEN**

Run: `npm --prefix functions test -- adaptiveLearningMigration.test.ts`

Run: `npx firebase-tools emulators:exec --only firestore --project demo-lingoflash "npm --prefix functions test -- adaptiveLearningMigrationFirestore.integration.test.ts && vitest run --config vitest.rules.config.ts"`

Expected: PASS for dry-run, apply resume, tamper blocking, owner fence, complete verification, and rollback.

- [ ] **Step 5: Commit the migration slice**

```bash
git add functions/src/adaptiveLearningMigration.ts functions/src/adaptiveLearningMigrationOperator.ts functions/test/adaptiveLearningMigration.test.ts functions/test/adaptiveLearningMigrationFirestore.integration.test.ts functions/package.json package.json firestore.rules firestore.rules.test.ts
git commit -m "feat: migrate libraries to adaptive courses"
```

---

### Task 7: Learn workspace, mixed lesson, and flexible controls

**Files:**
- Modify: `src/features/dailyLearning/DailyLearningWorkspace.tsx`
- Modify: `src/features/dailyLearning/TodayScreen.tsx`
- Modify: `src/features/dailyLearning/LessonScreen.tsx`
- Modify: `src/features/dailyLearning/dailyLearningPresentation.ts`
- Modify: `src/features/dailyLearning/DailyLearningScreens.test.tsx`
- Create: `src/features/courses/useCourseWorkspace.ts`
- Create: `src/features/courses/useCourseWorkspace.test.tsx`
- Modify: `src/app/AppViewStage.tsx`
- Modify: `src/app/useAppLearningCoordination.ts`
- Modify: `src/features/navigation/useAppNavigation.ts`
- Modify: `src/components/shell/DesktopNavigation.tsx`
- Modify: `src/components/shell/FloatingMobileNav.tsx`
- Modify: `src/components/shell/AppNavigation.test.tsx`
- Modify: `src/features/catalogWorkspace/CatalogScreen.tsx`
- Create: `e2e/adaptive-learning.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–6 domain/repository/controller APIs and existing practice/review ports.
- Produces: adaptive Learn screen, course picker, focus/size controls, mixed activity flow, rating correction, and Courses/My Words navigation labels.

- [ ] **Step 1: Write failing workspace and presentation tests**

```tsx
it('shows one recommended action with its reason and flexible overrides', () => {
  const adaptiveModel: TodayScreenModel = {
    ...readyToday,
    activeCourse: { id: 'course-a', title: 'IELTS', scenarioTitle: 'Interviews' },
    recommendation: { label: 'Review focus', reason: '3 reviews are due' },
    focus: 'balanced',
    sessionSize: 'standard',
  };
  const html = renderToStaticMarkup(<TodayScreen model={adaptiveModel} actions={todayActions} />);
  expect(html).toContain('Continue learning');
  expect(html).toContain('3 reviews are due');
  expect(html).toContain('Learn');
  expect(html).toContain('Hear');
  expect(html).toContain('Speak');
  expect(html).toContain('Standard · 10 activities');
  expect(html.match(/data-primary-learning-action="true"/g)).toHaveLength(1);
});

it('renders a later mixed activity without changing the lesson shell', () => {
  const recognitionModel: LessonScreenModel = { ...choiceLesson, adaptive: true };
  const listeningModel: LessonScreenModel = {
    ...choiceLesson, adaptive: true, mode: 'listening', modeLabel: 'Listening', canPlayAudio: true,
  };
  const recognition = renderToStaticMarkup(<LessonScreen model={recognitionModel} actions={lessonActions} />);
  const listening = renderToStaticMarkup(<LessonScreen model={listeningModel} actions={lessonActions} />);
  expect(recognition).toContain('Recognition');
  expect(listening).toContain('Listening');
  expect(recognition).toContain('data-adaptive-lesson="true"');
  expect(listening).toContain('data-adaptive-lesson="true"');
});
```

Add cases for course switching, skip, focus fallback explanation, owner switch, offline content, rating correction, save retry, empty course, and unchanged dedicated Review controls.

Add the browser journey before changing production UI:

```ts
test('learn recommends, mixes, saves, and resumes course activity', async ({ page }) => {
  await seedLegacyLibrary(page, legacyCourseFixture);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Learn' })).toBeFocused();
  await expect(page.getByText('3 reviews are due')).toBeVisible();
  await page.getByRole('button', { name: 'Continue learning' }).click();
  await completeCurrentActivity(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Listening')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Continue learning' })).toBeVisible();
});
```

Define `legacyCourseFixture`, `seedLegacyLibrary()`, and `completeCurrentActivity()` in the same file using the existing local-storage and card fixtures from adjacent E2E tests; keep all test data deterministic.

- [ ] **Step 2: Run the tests and verify RED**

Run: `vitest run src/features/courses/useCourseWorkspace.test.tsx src/features/dailyLearning/DailyLearningScreens.test.tsx src/components/shell/AppNavigation.test.tsx`

Run: `npm run build && playwright test e2e/adaptive-learning.spec.ts --project=chromium`

Expected: FAIL because the adaptive course workspace, navigation labels, and browser journey are not wired.

- [ ] **Step 3: Wire the pure core into the existing lazy workspace**

```ts
export interface AdaptiveLearnActions {
  continueLearning(): void;
  skipRecommendation(): void;
  chooseFocus(focus: LearningFocusV1): void;
  chooseSessionSize(size: SessionSizeV1): void;
  chooseCourse(courseId: string): void;
  changeProposedRating(rating: ReviewRatingValue): void;
  continueAfterFeedback(): void;
  retrySave(): void;
}
```

`useCourseWorkspace()` first returns valid v3 repository data when the preference enables it; otherwise it returns the Task 1 legacy projection. `DailyLearningWorkspace` asks the adaptive controller for one activity at a time, starts timing only after the question heading is visible, marks timing unreliable on `visibilitychange`, and uses existing exercise/audio/review ports. Keep `LessonScreen` lazy. Relabel Today to Learn, Paths to Courses, and Vocabulary to My Words without changing canonical URL compatibility. Reuse `CatalogScreen` as the Courses browser; do not add a second catalog UI.

- [ ] **Step 4: Run focused tests, type check, and build**

Run: `vitest run src/features/courses src/features/adaptiveLearning src/features/dailyLearning src/components/shell src/features/navigation`

Run: `npm run lint && npm run build && npm run verify:bundle`

Run: `playwright test e2e/adaptive-learning.spec.ts --project=chromium`

Expected: PASS; the browser journey completes, initial JavaScript remains under the configured budget, and adaptive lesson UI remains lazy.

- [ ] **Step 5: Commit the product slice**

```bash
git add src/features/dailyLearning src/features/courses/useCourseWorkspace.ts src/features/courses/useCourseWorkspace.test.tsx src/app/AppViewStage.tsx src/app/useAppLearningCoordination.ts src/features/navigation/useAppNavigation.ts src/components/shell/DesktopNavigation.tsx src/components/shell/FloatingMobileNav.tsx src/components/shell/AppNavigation.test.tsx src/features/catalogWorkspace/CatalogScreen.tsx e2e/adaptive-learning.spec.ts
git commit -m "feat: make learning adaptive and course driven"
```

---

### Task 8: Acceptance, rollback evidence, and regression closure

**Files:**
- Modify: `e2e/accessibility.spec.ts`
- Create: `docs/reviews/adaptive-learning-core-acceptance.md`
- Modify: `docs/superpowers/plans/2026-09-03-adaptive-learning-core.md`

**Interfaces:**
- Consumes: the completed Adaptive Learning Core, Task 7 browser journey, and existing verification scripts.
- Produces: migration/rollback evidence, independent review closure, and a checked plan.

- [ ] **Step 1: Extend the existing accessibility acceptance for the new Learn controls**

In `e2e/accessibility.spec.ts`, exercise Learn with keyboard-only navigation, 320 px viewport, 200% text, and reduced motion. Assert that focus reaches the recommended action, course selector, focus selector, session-size selector, skip, rating correction, and Continue in logical order, and that the page has no axe violations.

```ts
test('adaptive Learn reflows and exposes accessible controls', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(cards => {
    localStorage.setItem('lingoflash_cards', JSON.stringify(cards));
    localStorage.removeItem('lingoflash_cards_owner');
  }, guestCards);
  await page.goto('/');
  await page.locator('html').evaluate(element => { element.style.fontSize = '200%'; });
  await expect(page.getByRole('button', { name: 'Continue learning' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')).toEqual([]);
});
```

- [ ] **Step 2: Run complete verification with fresh evidence**

Run: `npm run verify:core`

Run: `npm run build && npm run verify:bundle`

Run: `playwright test e2e/adaptive-learning.spec.ts e2e/accessibility.spec.ts --project=chromium --project=webkit`

Run: `npm --prefix functions test -- adaptiveLearningMigration.test.ts`

Run: `npx firebase-tools emulators:exec --only firestore --project demo-lingoflash "npm --prefix functions test -- adaptiveLearningMigrationFirestore.integration.test.ts && vitest run --config vitest.rules.config.ts"`

Run the migration operator in dry-run mode against fixtures, then run its apply and rollback modes against the emulator. Record exact commands, revision digest, counts, and zero-loss comparison in the acceptance document.

Create `docs/reviews/adaptive-learning-core-acceptance.md` with `Product evidence`, `Data evidence`, and `Independent review` headings. Record the actual base/head SHAs; commands and passed counts; observed bundle bytes and budget; 64-character source revision; dry-run/apply/rollback counts and fingerprints; zero-loss comparison; confirmation that production changes and catalog publication are absent; both reviewer dispositions; and every remaining material limitation.

Expected: every command exits 0; no accessibility violations; migration and rollback counts/fingerprints match; no catalog is published and no production resource is changed.

- [ ] **Step 3: Request mandatory independent ASSURANCE reviews**

After verification, dispatch one read-only `reviewer` for correctness/regression/compatibility and one `security_reviewer` for Rules, owner isolation, migration, rollback, untrusted identifiers, and data-loss paths. Give both the spec, this plan, base SHA, head SHA, and verification evidence. Resolve every substantiated Critical/Important or security finding, rerun the owning checks, and return fixes for re-review until both reviewers clear them.

- [ ] **Step 4: Check the plan and commit acceptance evidence**

Mark a checkbox only after its command has passed. Then run:

```bash
git diff --check
git status --short
git add e2e/accessibility.spec.ts docs/reviews/adaptive-learning-core-acceptance.md docs/superpowers/plans/2026-09-03-adaptive-learning-core.md
git commit -m "test: verify adaptive learning core"
```

Expected: the commit contains only adaptive-learning acceptance files and any reviewed targeted fixes; `.serena/` and `zen-preview.html` remain untouched.
