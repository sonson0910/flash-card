# Phase 5 — Daily learning experience

Date: 2026-08-04

Status: ready

Execution gate: allowed by the user's explicit request to execute all of Phase 5.

## Problem

Phase 4 exposes reviewed catalog paths, but the product still opens on library
management and offers disconnected practice commands. Learners do not have one
bounded daily plan, a placement check, a coherent lesson session across exercise
types, or the final Today/Paths/Vocabulary/Progress information architecture.

## Goal

Make learning the primary product hierarchy with a lazy, offline-capable Today
workspace. Build a deterministic 10–15 item daily plan, a non-destructive
placement check, and a shared lesson engine for recognition, active recall,
listening, spelling, cloze and sentence building. Typed scoring must respect the
selected language/script while preserving existing FSRS and Learning State.

## Scope

- Final four-destination shell: Today, Paths, Vocabulary and Progress.
- Daily plan of at most 15 unique learner cards, ordered due reviews → weak
  vocabulary → new vocabulary, with explicit counts and honest short-plan states.
- Continue Review hands due work to the existing FSRS Study flow.
- Shared bounded lesson domain for six modes: recognition, active recall,
  listening, spelling, cloze and sentence building.
- Placement check using 6–12 unique learner cards with valid CEFR evidence,
  with Foundation/Core/Advanced recommendation and confidence/insufficient-data states.
- Placement is diagnostic only: it cannot write review history, mastery, XP or
  unlock catalog tiers.
- Script-aware normalization/scoring with separate Latin, Han, Kana and Hangul policies;
  unknown scripts use exact normalized comparison rather than unsafe guessing.
- Accessible Today, lesson and placement presentation with keyboard operation,
  status/live regions, non-color feedback, 44px targets, reduced motion, 320px
  reflow and 200% text support.
- URL/back-forward state for `view=today|catalog|library` and bounded lesson mode;
  unknown query/hash parameters remain intact.
- Lazy lesson/placement UI so the initial JavaScript budget remains below 280 KB gzip.

## Non-goals

- Publishing or importing the Phase 3 draft pilot.
- Claiming placement is a standardized IELTS/TOEIC score or official assessment.
- Automatically writing placement outcomes into Learning State or FSRS.
- New Firestore collections, migrations, auth/rules changes or production deploy.
- Speech recognition, AI-generated live exercises or paid external APIs.
- Replacing the proven review scheduler, Quiz, Spelling or catalog delivery runtime.
- Phase 6 staging, canary, observability and full multi-script content QA.

## Architecture decisions

1. `features/dailyLearning` owns pure plan/placement/lesson/scoring contracts and
   React orchestration; it does not call Firestore.
2. Existing bounded Practice Pool is the only learner-card input. Daily buckets
   are mutually exclusive: reviewed-due → reviewed-weak → never-reviewed new,
   each with stable identity/date tie-breaks. Daily planning never starts an
   unbounded library scan and never uses catalog installation as progress evidence.
3. The existing `learning.reviewCard` command remains the only Phase 5 path that
   records FSRS ratings. New lessons do not schedule independently: after answer
   feedback the learner explicitly selects Again/Hard/Good/Easy, and the reducer
   advances only after that command succeeds exactly once. Placement is read-only.
4. One discriminated lesson reducer owns all six exercise modes. Presentation
   renders mode-specific controls but shares progress, answer, reveal and next logic.
5. Language scoring uses a registry of explicit adapters. The fallback is strict
   NFKC + whitespace normalization; it never transliterates or awards fuzzy credit.
6. Today becomes the default view. Paths maps to Catalog, Vocabulary maps to the
   existing Library and Progress is a real lazy `view=progress` workspace that
   reuses the existing Insights model/charts. Legacy
   practice features remain reachable from Today instead of occupying shell navigation.
7. Phase 5 UI is dynamically imported. App composition must be extracted or kept
   at/below the existing 600-line architecture boundary.

## URL contract

- `/` resolves to Today; legacy `/library` and `/library?...` resolve to Vocabulary.
- `?view=today|catalog|library|progress` are canonical shell states.
- `lesson=recognition|active-recall|listening|spelling|cloze|sentence-building|placement`
  is bounded and meaningful only while the Today learning workspace owns a session.
- Back/forward restores Today/Catalog/Vocabulary and closes obsolete lesson state.
- Unknown values fall back safely; unrelated parameters and hash survive writes.

## Work breakdown and ownership

### Task 1 — Domain engine

- Daily plan ranking/deduplication/bounds.
- Script-aware scoring adapters.
- Six-mode exercise creation and lesson reducer.
- Placement scoring/recommendation with diagnostic-only invariants.
- Placement accepts only valid `A1/A2 → Foundation`, `B1/B2 → Core`, and
  `C1/C2 → Advanced` CEFR evidence. Fewer than six eligible unique cards is
  insufficient; no tier or content is inferred.
- Eligibility rules: recognition needs four distinct answers; listening needs an
  approved audio/browser speech path; cloze needs a real example containing the
  lemma; sentence building needs one bounded unambiguous token order. Unsupported
  items fall back honestly instead of generating exercise content.
- Sentence tokens use stable occurrence IDs so repeated words cannot collapse or
  receive credit in the wrong order.
- RED/GREEN small tests, including malformed/insufficient content.

Own: new pure files under `src/features/dailyLearning/`.

### Task 2 — Runtime/controller

- Bounded Practice Pool adapter and stale-owner/request protection.
- Today/session controller, URL seam and existing Study/Quiz/Spelling handoff.
- No direct Firestore imports or new persistence schema.
- RED/GREEN hook/controller tests.

Own: daily-learning controller/service files and narrow Practice ports.

### Task 3 — Accessible UI

- Today dashboard, plan summary, exercise picker, placement result and generic
  lesson presentation.
- Keyboard/focus/live-region/error/empty/offline/reduced-motion/reflow states.
- Presentation tests with no runtime/data-source imports.

Own: daily-learning presentation TSX/model/tests only.

### Task 4 — Shell integration

- Final Today/Paths/Vocabulary/Progress navigation on desktop and mobile.
- Default/deep-link/history/focus behavior.
- Lazy Today/lesson composition while preserving Catalog and existing practice.

Own: App/navigation/shell integration and regression tests.

### Task 5 — Independent acceptance

- Architecture/trust-boundary review and remediation of all Critical/Required findings.
- Chromium/WebKit learner journey, keyboard, 320px, 200% text and axe.
- Full unit/Functions/catalog/build/bundle/security gates and CodeGraph impact review.

## Definition of Done

1. `/` opens Today, focuses its heading, and the shell exposes exactly Today,
   Paths, Vocabulary and Progress with text/icon/current-state semantics.
2. A daily plan contains no duplicate logical card, never exceeds 15, targets
   10–15 when enough data exists, and orders due → weak → new deterministically.
3. Fewer than 10 available cards produces an honest short plan; zero cards offers
   a Vocabulary action and does not enter a broken lesson.
4. Continue Review reuses the existing bounded due/new FSRS Study path; Phase 5 does not
   create a second review scheduler or lose review history.
5. Recognition, active recall, listening, spelling, cloze and sentence building
   each produce bounded valid prompts and share completion/progress semantics;
   feedback never leaks the answer before submission.
6. Missing audio/example/translation degrades to a useful supported mode rather
   than blank instructions, an exception or invented content.
7. Separate Latin, Han, Kana and Hangul scoring has explicit tests for normalization,
   punctuation/spacing and wrong-script answers; fallback scoring is strict.
8. Placement uses 6–12 unique learner cards with valid CEFR mapped to tiers,
   reports insufficient evidence honestly and recommends Foundation/Core/Advanced
   without mutating FSRS, mastery, XP or tiers.
9. A lesson answer does not silently choose an FSRS grade. The learner selects a
   rating after feedback; persistence occurs exactly once before advance, retries
   are safe, and failure keeps the current item actionable.
10. Today and lesson state remain useful offline from the bounded local Practice
   Pool; owner/request changes cannot allow stale results to replace the new owner.
11. URL navigation preserves unrelated parameters/hash and browser history restores
    Today/Paths/Vocabulary/Progress without stale lesson state; legacy `/library`
    sharing links still open Vocabulary.
12. Every control is keyboard operable with visible focus; dynamic status is
    announced; feedback is not color-only; 320px, 200% text and reduced motion pass.
13. Existing Library, Catalog, Study, Quiz, Spelling, Story and Insights behavior
    remains covered and green.
14. App/Functions lint and tests, catalog gates, build, secret scan, bundle gate,
    dependency high/critical audit, Chromium and WebKit E2E pass. Rules/release
    configuration blockers remain reported separately until the environment exists.
15. Initial JavaScript remains below 280,000 bytes gzip and new lesson/placement
    presentation remains lazy. Bundle headroom is recorded explicitly.
16. Production code imports no pilot catalog and no deployment/publication occurs.
17. `src/App.tsx` remains at or below 600 lines; Phase 5 integration extracts
    composition instead of adding another controller to the root component.

## Test matrix

- Small: planner ranking, scoring adapters, mode prompt builders, reducer,
  placement recommendation, URL parser.
- Medium: stale Practice Pool requests, controller transitions, React presentation.
- Large: Today → lesson → result, placement, review handoff, history, offline,
  keyboard, reflow, text zoom and axe on Chromium; regression on WebKit.

## Boundaries

- Always: bounded reads, deterministic tests, explicit script adapter, preserve
  FSRS/history, TDD, lazy UI and honest insufficient-data states.
- Ask first: new runtime dependency, new cloud schema/write, catalog publication,
  migration, staging/production deploy or external speech/AI integration.
- Never: manufacture mastery, treat placement as official, persist diagnostic
  answers as reviews, import draft pilot into production, or bypass owner guards.

## Completion evidence required

Status moves from `ready` only after fresh evidence maps to each DoD item and an
independent reviewer reports no Critical/Required findings. Missing Java or
production configuration is documented as a release blocker, never a pass.
