# Increment 5 Adaptive Learning Core Design

Date: 2026-09-04

Status: approved for implementation within this goal

## Purpose

Add the smallest canonical adaptive-learning seam that can choose the next
bounded Learn → Immerse activity for one course. The seam must use the existing
FSRS-backed daily plan, catalog cache/content contracts, and multidimensional
SkillEvidence state without creating a second scheduler, course model, or
learner-data store.

This increment is a pure domain slice. It does not make the product UI adaptive
yet and it does not persist courses or evidence.

## Reconciliation map

| Requested concept | Existing seam/runtime | Decision in this increment |
| --- | --- | --- |
| Course / Scenario / Enrollment / Preferences | Adaptive Learning Core proposal defines these, but `src/features/courses` does not exist | Create one canonical `CourseV1` family in `src/features/courses/courseModel.ts`; no `V4` parallel types |
| Personal vocabulary | `CardData`, `useLearningWorkspace`, existing library/session ownership | Keep `CardData` as the current card input; create pure course-item projections only |
| Catalog vocabulary | `CatalogCacheEntry`, `HydratedCatalogEntry`, catalog registry/release gates | Keep catalog releases immutable; accept catalog membership/lexeme identity as candidate metadata |
| Chunks | `CatalogContentChunkV1` in `catalogPipeline` | Treat chunks as optional context enrichment attached to a lexeme item; they do not create learner state |
| Licensed media | `CatalogMediaClipV1` + `CatalogContentRightsV1` and existing rights evaluator | Accept an already-verified media capability; do not fetch, ingest, or infer rights in the selector |
| Review backlog | `buildDailyPlan()` and `DailyPlanReason` in `dailyLearning/dailyPlan.ts` | Reuse `buildDailyPlan()` for due/weak/new priority; never mutate FSRS or review history |
| Skill gaps | `deriveSkillStateV4()` in `skillEvidence` | Consume caller-supplied `SkillStateV4`; use it only for activity preference, never for FSRS ratings |
| Recommendation | No adaptive recommendation runtime exists | Create pure `recommendNextActivity()` in `adaptiveLearning` |
| Session orchestration | `dailySessionController` owns the current manual review persistence flow | Do not replace it; this increment returns one next bounded activity and session target metadata |
| UI/navigation/persistence | Existing React/app composition and Firestore adapters | Deferred to later increments; no imports or wiring here |

## Canonical domain

The proposal's `CourseV1`, `ScenarioV1`, `CourseItemV1`, `EnrollmentV1`, and
`LearningPreferencesV1` names are retained as the only future course domain.

Course items identify a lexeme membership by `(courseId, scenarioId,
lexemeId)`. A chunk is optional enrichment for that membership, not a second
learner progress identity. The same lexeme can therefore occur in multiple
scenarios while retaining one underlying learning state.

The pure workspace projection is intentionally in-memory:

```ts
interface CourseV1 {
  schemaVersion: 1;
  id: string;
  ownerId: string | null;
  contentLanguage: string;
  supportLanguage: string;
  title: string;
  description: string;
  source: 'personal' | 'catalog';
  archivedAt: string | null;
  revision: number;
}

interface ScenarioV1 {
  schemaVersion: 1;
  id: string;
  courseId: string;
  title: string;
  rank: number;
}

interface CourseItemV1 {
  schemaVersion: 1;
  id: string;
  courseId: string;
  scenarioId: string;
  lexemeId: string;
  rank: number;
}

interface EnrollmentV1 {
  schemaVersion: 1;
  courseId: string;
  activeScenarioId: string;
  completedScenarioIds: readonly string[];
  introducedItemIds: readonly string[];
  updatedAt: string;
}

interface LearningPreferencesV1 {
  schemaVersion: 1;
  useV3Courses: boolean;
  activeCourseByLanguage: Readonly<Record<string, string>>;
  focus: 'balanced' | 'learn' | 'hear' | 'speak';
  sessionSize: 'short' | 'standard' | 'deep';
}
```

All parsers are strict and bounded. IDs use the existing v3 limits and reject
slashes/control characters; timestamps are canonical UTC ISO values. The
projection functions are deterministic and do not write storage.

## Recommendation contract

`AdaptiveCandidateV1` is the adapter-neutral input for personal or catalog
items:

```ts
interface AdaptiveCandidateV1 {
  courseId: string;
  scenarioId: string;
  item: CourseItemV1;
  card: CardData;
  skillState: SkillStateV4 | null;
  context: { chunkIds: readonly string[]; hasExample: boolean };
  media: {
    licensedAudio: boolean;
    clipId: string | null;
    transcriptReady: boolean;
    availableOffline: boolean;
  };
}
```

`recommendNextActivity(candidates, options)` returns at most one activity:

- `review`/`learn` exercise activities reuse an existing `ExerciseMode` and
  `CardData` input;
- `immerse` is returned only when a verified audio capability has a clip ID and
  transcript, so no empty media step is emitted;
- `fallbackFrom` explains when `hear`/`speak` cannot be fulfilled;
- `empty` and `course-complete` remain explicit terminal states.

The caller supplies `newItemsRemaining`, an integer from `0` through `8` for
the current bounded window. The selector consumes this budget conceptually but
does not mutate it; the later session orchestrator decrements it after an
unintroduced item is introduced. When the budget is zero, every unintroduced
membership is excluded from due, weak, skill-gap, new, and next selection, so
the selector returns `no-eligible-activity` rather than spending the budget
implicitly. Already-introduced cards may still be practiced.

Priority is deterministic and bounded:

1. `buildDailyPlan()` due items;
2. weak items;
3. new items, capped at eight per bounded window;
4. the lowest practiced eligible skill from `SkillStateV4`;
5. the next item by scenario/rank, or completion.

The selector considers only a supplied candidate array of at most 15 items and
rejects larger arrays before eligibility work begins. This keeps the existing
daily-plan maximum of 15 from turning per-candidate exercise eligibility into
unbounded work. It never calls AI, network, storage, or the clock except for
the caller-supplied `now` value. `hear` maps to listening or a licensed immerse
clip; `fallbackFrom` is present only when Hear cannot use either of those and
falls back to active recall. `speak` falls back to an eligible existing
exercise and does not claim pronunciation assessment.

Session sizes remain the proposal's bounded targets: short 5, standard 10, deep
15 scored activities. They are targets, not duration promises. Skipping is
represented only in the current options set and never changes `CardData`, FSRS,
or `SkillEvidence`. The selector also receives the enrollment's
`introducedItemIds`; an item that is not yet introduced keeps the scenario from
being reported complete, without copying learner state into the course model.
The eight-item new limit is exposed as window metadata and enforced through
`newItemsRemaining` across every branch that could introduce a membership; the
later session orchestrator owns introduction writes and budget decrementing.

## Failure and security behavior

- Invalid domain inputs fail at the parser boundary.
- Candidate IDs and course ownership are never inferred from URL input.
- An unavailable or unlicensed media capability falls back to a usable exercise.
- Missing SkillState means no skill-gap preference, not a fabricated mastery.
- The selector cannot persist a review or emit an FSRS rating.
- Owner-scoped persistence, Firestore Rules, migration, and session-generation
  invalidation remain explicit follow-up contracts.

## Non-goals

- No React/UI/navigation changes.
- No Firestore/IndexedDB schema, Rules, migration, or release artifact.
- No media download/ingestion, content publication, voice provider, or
  pronunciation assessment.
- No automatic FSRS rating and no replacement for `dailySessionController`.
- No second Course/Scenario/Preferences/Recommendation domain.

## Verification

Unit tests will cover strict parsing, deterministic IDs/projections, one-state-
many-memberships, recommendation priority/tie-breaking, focus fallback,
licensed-media gating, new-item cap, skip behavior, session-size targets, and
the absence of FSRS/persistence coupling. Repository lint, catalog verification,
the full root test suite, and production build remain required after the pure
slice is implemented.

## Implementation closure

The pure seam is implemented and verified at code SHA `47e5db6`.

`src/features/courses/courseModel.ts` exports the canonical `*V1` course,
scenario, item, enrollment, and preferences contracts; strict parsers; stable
identity helpers; and deterministic personal/catalog projections. No learner
state is copied into a course projection.

`src/features/adaptiveLearning/adaptiveRecommendation.ts` exports
`AdaptiveCandidateV1`, the bounded recommendation result/options contracts,
`createAdaptiveCandidateId()`, and `recommendNextActivity()`. It delegates
due/weak/new classification to `buildDailyPlan()` and mode eligibility to
`getEligibleExerciseModes()`. Licensed media and `SkillStateV4` remain caller
capabilities/signals only; no URL, speech transcript, or skill result is turned
into rights evidence or an FSRS rating. Offline recommendations never select
the card's remote `audioUrl`; cached media is represented only by the explicit
Immerse capability. Any supplied media clip ID is canonical, bounded, and
Firestore-safe before it can be returned.

Verified commands for this SHA:

- `npx vitest run src/features/courses src/features/adaptiveLearning`
- `npm run catalog:verify`
- `npm run lint`
- `npm test -- --run` (1,794 tests)
- `npm run build`
- `git diff --check e5386cf..47e5db6`

Firestore/IndexedDB persistence, migration/activation, UI/navigation, session
orchestration, content/media ingestion, conversation, pronunciation providers,
automatic FSRS ratings, and catalog publication remain deferred. The selector
is an additive pure seam with no production caller until a later increment
maps these contracts into the existing runtime.
