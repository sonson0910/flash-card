# Adaptive Learning Core Design

Date: 2026-09-03

Status: proposed for implementation

## Purpose

Turn SonFlash from a passive flashcard library into an adaptive learning product.
The first release makes personal vocabulary and installed catalog vocabulary flow
through the same course, scenario, recommendation, and mixed-lesson experience.
It preserves every existing FSRS record and leaves the current v2 card store
available for rollback.

This design is the first of four approved subprojects:

1. Adaptive Learning Core (this document).
2. Automated Internet-backed Content Compiler.
3. Hear & Speak activities with licensed media and interactive AI conversation.
4. My Words, My Activities, and deeper personalization.

## Outcomes

- The default screen recommends one useful next activity and offers a single
  primary `Continue learning` action.
- A learner can enroll in multiple courses, keep one active course per language,
  switch freely, and retain progress in every course.
- Personal vocabulary and catalog vocabulary use the same lesson engine.
- A lesson mixes suitable activities and is recalculated after each completed
  activity instead of fixing one exercise mode for the whole session.
- The learner can skip a recommendation, select a Learn/Hear/Speak focus, switch
  courses, or select a short, standard, or deep session.
- Correctness and response evidence produce an automatic FSRS rating in normal
  lessons. The learner can correct that rating. Dedicated Review retains manual
  Again/Hard/Good/Easy controls.
- Existing cards, review history, bookmarks, difficulty, and FSRS state survive
  migration and rollback field-for-field through the existing normalized rollback
  snapshot contract.

## Non-goals

- Fetching or publishing Internet content. The Content Compiler owns that work.
- Shipping a production catalog or claiming that fixture content is reviewed.
- Downloading YouTube media or separating its audio.
- Building interactive AI conversation, new speech scoring, notifications, social
  features, leaderboards, or subscriptions.
- Deleting the v2 card collection or legacy custom-deck profile.
- Deploying Firestore Rules, Functions, Hosting, or a production migration.

## Product model

### Navigation

The primary product hierarchy becomes:

- **Learn**: adaptive home, active course, recommendation, and current lesson.
- **Courses**: installed catalog courses and personal courses.
- **My Words**: existing vocabulary management presented as a supporting tool.
- **Progress**: existing progress evidence; activity-specific expansion is deferred.

Existing Quiz, Story, Spelling, Match, Shadowing, and manual Study remain reachable
from `More practice`. They are not primary navigation destinations.

### Courses and scenarios

A course defines a goal and an ordered set of scenarios. A scenario is a practical
learning unit containing ordered vocabulary memberships. The same lexeme can appear
in several courses or scenarios without duplicating its learning state.

Logical lexeme identity includes language, normalized lemma, part of speech, and
sense. Exact identity matches share progress; genuinely different senses remain
separate. An ambiguous personal/catalog match is never merged automatically.

For the compatibility migration:

- Each legacy custom deck becomes one personal course with one default scenario.
- Cards without a custom deck join a personal `My Vocabulary` course.
- Existing catalog tracks map to courses, tiers map to stages, and `lessonGroup`
  maps to scenarios. Catalog content remains unavailable until a real release passes
  the existing catalog publication gates.

Only one course is active per content language. Switching the active course changes
recommendations, never the underlying FSRS state.

### Adaptive home

The Learn screen shows:

1. active course, scenario, and honest progress;
2. one recommended next activity with a short reason;
3. `Continue learning` as the primary action;
4. Learn, Hear, and Speak focus overrides;
5. session-size selection and course switching;
6. optional `More practice` access to legacy practice tools.

The recommendation explanation uses bounded labels such as `3 reviews are due`,
`this word was missed recently`, or `speaking has had less practice`. It does not
claim AI personalization when deterministic rules made the decision.

## Recommendation engine

### Inputs

The engine consumes a bounded candidate set for the active course:

- course and scenario membership order;
- current FSRS due state and review history;
- Known/Difficult state and recent correctness;
- whether the learner has been introduced to the lexeme;
- activity eligibility from available translation, example, audio, and media;
- recent activity modes within the current local session;
- learner-selected focus and session size;
- online/offline capability.

It never scans an unbounded library and never calls AI to choose the next activity.

### Priority

The deterministic priority is:

1. overdue FSRS reviews;
2. recent failures and Difficult vocabulary;
3. new vocabulary from the current scenario, subject to the session new-word cap;
4. an under-practiced eligible skill for recently learned vocabulary;
5. the next scenario introduction or course-completion action.

Stable lexeme identity and membership rank break ties. Skipped activities are
temporarily deprioritized for the current session, not marked learned or difficult.
The engine recalculates after each activity and can plan only the next bounded
window; it does not persist a speculative long sequence.

### Session size and flexibility

- Short, standard, and deep target 5, 10, and 15 scored activities respectively.
- These are activity counts, not guaranteed clock durations.
- The learner may change focus, size, or active course between activities.
- An unavailable requested mode falls back to the best eligible mode and explains
  the substitution.
- Offline sessions use only locally available content and existing browser audio.

### Initial activity coverage

The first release reuses existing engines for recognition, active recall, listening,
spelling, cloze, and sentence building. It also reuses manual Study/Review as a
handoff. Native-speaker video and interactive conversation are represented as
future eligibility capabilities and are not rendered as empty or disabled lesson
steps.

## Automatic FSRS rating

Normal mixed lessons derive a proposed rating only after a scored answer:

- incorrect: `Again`;
- correct after a revealed hint or retry: `Hard`;
- correct without assistance: `Good`;
- correct without assistance and within the exercise-specific fast threshold:
  `Easy`.

The response timer starts only when the question is ready and visible. Background
time, audio loading, reduced-motion settings, and assistive-technology focus changes
must not penalize the learner. If trustworthy timing evidence is unavailable, a
correct answer is `Good`, never `Easy`.

The feedback screen shows the proposed rating and an accessible `Change rating`
control before persistence. One primary `Continue` control saves the proposed rating,
so the learner does not have to choose among four ratings. Persistence continues
through the existing idempotent review command and advances only after it succeeds.
A save failure keeps the current question actionable. Dedicated manual Review does
not auto-rate.

Introductory, video, and unscored exposure activities never write an FSRS rating.

## Storage model

### Shared catalog

Published catalog releases remain static, immutable, checksummed artifacts in the
existing catalog pipeline and IndexedDB cache. `LexemeV3` remains the canonical
content entity. Course/scenario membership extends the existing release contract
without copying catalog lexemes into a user's Firestore tree.

### Personal data

The target Firestore layout is:

```text
/users/{uid}/lexemes/{lexemeId}
/users/{uid}/learning_states/{lexemeId}
/users/{uid}/courses/{courseId}
/users/{uid}/courses/{courseId}/scenarios/{scenarioId}
/users/{uid}/courses/{courseId}/items/{membershipId}
/users/{uid}/enrollments/{courseId}
/users/{uid}/preferences/learning
```

- `lexemes` stores personal vocabulary content and provenance.
- `learning_states` stores the single learner-owned FSRS and word status record.
- `courses`, `scenarios`, and `items` store organization and ordering only.
- `enrollments` stores course/scenario position and completion evidence.
- `preferences/learning` stores active course per language, focus, and session size.

Activity-day aggregation is deferred to the Progress & Personalization subproject.
The first release derives its recommendation evidence from learning state and the
current local session.

IDs are deterministic, Firestore-safe, owner-scoped where appropriate, and bounded
by the existing schema limits. Course item identity includes course, scenario, and
lexeme so a lexeme may occur in multiple scenarios without duplicating content or
progress.

## Compatibility migration

Migration is additive and resumable:

1. Read one bounded page of v2 cards and the legacy custom-deck profile.
2. Normalize each card through the existing v2 migration boundary.
3. Write the personal lexeme, learning state, legacy-deck course, default scenario,
   and membership with deterministic IDs.
4. Record source revision, fingerprint, migration version, and rollback snapshot.
5. Re-read and validate document counts, references, owner IDs, and fingerprints.
6. Mark that bounded page complete and continue from its cursor.
7. Enable v3 preference only after every page and aggregate invariant passes.

During compatibility, reads prefer valid v3 data and fall back to v2 per logical
lexeme. Mutations that affect learning state are dual-written through one repository
seam. No client deletes v2 documents or the legacy deck profile. Rollback disables
the v3 preference and restores the v2 projection from trusted snapshots when needed.

Deleting a course first archives it and hides it from active learning. Physical
subcollection cleanup is a separate resumable operation because deleting a Firestore
parent does not delete its descendants. Cleanup never deletes lexemes or learning
state; vocabulary no longer referenced by a personal course remains in My Words and
can be explicitly removed through the existing card-deletion workflow.

## Components and boundaries

- `adaptiveLearning`: pure recommendation, activity eligibility, auto-rating, and
  session reducer. No React, Firebase, browser globals, or AI calls.
- `courses`: course/scenario models, migration projection, query ports, and active
  enrollment behavior.
- `dailyLearning`: presents the adaptive home and mixed lesson using the new pure
  core while reusing existing exercise builders and review persistence.
- `multilingual`: remains the v2/v3 compatibility and validation boundary.
- `catalogPipeline` and `catalogWorkspace`: supply installed catalog course data;
  publication behavior is unchanged in this subproject.
- `app`: composes ports and navigation but owns no recommendation or migration logic.

No new runtime dependency is required.

## Failure behavior

- Invalid v3 documents are rejected at the parser boundary and fall back to the
  intact v2 source where possible.
- A partial migration never switches the user to v3 and is safe to retry.
- A stale owner, course, or async request cannot publish into the active session.
- A missing activity asset causes an eligible-mode fallback, not fabricated content.
- A learning-state save failure never advances the lesson or awards completion.
- Offline mode keeps a locally cached active course useful and clearly identifies
  activities that are temporarily unavailable.
- Empty courses offer course switching or vocabulary addition instead of entering a
  broken lesson.

## Trust and security

- Firestore Rules validate exact field allowlists, owner identity, bounded strings
  and arrays, immutable ownership, and allowed state transitions for every new path.
- Clients cannot write shared catalog releases or migration approval evidence.
- Migration authority and rollback fingerprints remain server/operator controlled.
- URLs and catalog identifiers remain allowlisted and are never accepted as arbitrary
  Firestore or fetch paths.
- Existing App Check, revision, idempotency, and library-epoch protections remain in
  force.

## Verification

### Unit and contract tests

- deterministic recommendation priority and tie-breaking;
- session-size/new-word bounds, skip behavior, focus overrides, and mode fallback;
- auto-rating for incorrect, assisted, normal, fast, and unreliable-timer cases;
- mixed-session reducer transitions and idempotent persistence;
- course/scenario/item validation and one-state-many-memberships behavior;
- v2 deck projection, default course projection, resume cursor, and rollback.

### Integration tests

- repository dual-read/dual-write behavior;
- partial migration retry and owner-switch races;
- Firestore Rules for every new collection and denied cross-owner/unknown fields;
- catalog and personal lexemes entering the same recommendation path;
- offline cached-course behavior.

### Browser acceptance

- Learn opens with one recommended action and an explanation;
- a mixed lesson changes activity type without leaving the session;
- skip, focus, size, course switch, rating correction, save retry, and resume;
- keyboard, screen-reader announcements, visible focus, 320 px reflow, 200% text,
  reduced motion, and Chromium/WebKit coverage;
- existing Library, Catalog, Study, Quiz, Story, Spelling, Match, Shadowing, export,
  sharing, and sync flows remain operational.

### Release gates

Run application and Functions type checks/tests, Firestore emulator tests, production
build, bundle budget, accessibility, browser E2E, audit, migration dry-run, rollback
dry-run, and existing release evidence gates. No production migration or deployment is
part of implementation approval.

## Acceptance criteria

1. Learn is the default authenticated destination and exposes one primary Continue
   action based on a deterministic recommendation.
2. The recommendation is scoped to the active course and recalculated after every
   completed or skipped activity.
3. A mixed lesson can use all six existing exercise engines and never presents an
   ineligible activity.
4. The learner can change focus, session size, and course without losing FSRS state.
5. Normal scored lessons auto-rate with an accessible correction path; dedicated
   Review remains manual.
6. Personal and catalog lexemes share one learning state per learner across every
   course and scenario membership.
7. Legacy decks migrate to personal courses, unassigned cards migrate to My
   Vocabulary, and all legacy progress survives verified rollback.
8. Partial migration, offline assets, save failures, and stale-owner requests fail
   safely and remain actionable.
9. Existing catalog publication gates stay closed until the separate Content
   Compiler produces an approved release.
10. No new runtime dependency, Internet content publication, production deployment,
    or v2 deletion occurs in this subproject.
