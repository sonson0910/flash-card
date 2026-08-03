# Phase 2 — Multilingual schema, dual-read and reversible migration

Date: 2026-08-03

Status: Implemented and verified locally. Production migration/deployment was not run.

## Objective

Introduce additive schema v3 entities for language-aware content and learner-owned
progress without changing the current product behaviour or destroying v2 cards.
The phase is complete when v2 cards can be deterministically represented as one
Lexeme, one or more Track Memberships and one Learning State, read through the
same compatibility view, and reconstructed for rollback with all progress intact.

## Assumptions

- Legacy cards are `en` content with Vietnamese (`vi`) learning support.
- Schema v3 is additive. Phase 2 does not delete v2 documents or run a production
  migration automatically.
- Migration plans are deterministic and idempotent and include a bounded rollback
  snapshot. Applying a production plan remains an explicit later operation.
- The existing UI continues to consume `CardData` compatibility projections.
- Catalog publication/editorial tooling and catalog UI remain Phase 3 and Phase 4.
- No new runtime dependency is required.

## Architecture decisions

- `Lexeme` owns shared language content and identity.
- `TrackMembership` owns IELTS/TOEIC/General placement, never learner progress.
- `LearningStateV3` owns FSRS, review history, bookmarks, streak and collections.
- Logical lexeme identity is derived from language, normalized lemma, normalized
  part of speech and a stable sense key.
- Shared catalog paths are client read-only; learner state is owner-scoped.
- Dual-read happens at a validation boundary and returns a v2-compatible view so
  existing controllers do not gain schema conditionals.

## Threat model

Trust boundaries are legacy Firestore documents, future catalog documents,
IndexedDB data and migration manifests. Inputs may be malformed, oversized,
cross-owner or crafted to collide. Validators therefore bound strings/lists,
reject unsupported schema versions and enforce entity/reference identity. Rules
deny client catalog writes. Phase 2 learner state is owner-readable but client
writes are denied until a trusted server adapter can enforce strict parsing and
atomic revision/library-epoch checks together.

## Dependency graph

```text
Language Profile + v3 contracts + deterministic identity
                    │
          validation and compatibility projection
                    │
       reversible migration plan and manifest
                    │
        dual-read repository / storage boundary
                    │
       Firestore rules and architecture contracts
```

## Tasks

### Task 1 — Domain contracts and identity

- Add bounded v3 types for Language Profile, Lexeme, Track Membership and
  Learning State.
- Generate collision-safe lexeme and membership ids.
- Prove language and sense separation with unit tests.
- Files: `src/features/multilingual/schemaV3.ts`, `lexemeIdentity.ts` and tests.

### Task 2 — Validation and compatibility projection

- Parse untrusted v3 aggregate documents at one boundary.
- Reject invalid schema/reference/progress shapes.
- Project valid v3 aggregates into current `CardData` without mixing memberships
  into learning state.
- Files: validator/projection modules and tests.

### Checkpoint A

- Targeted tests and `npm run lint` pass.
- No v3 module imports Firebase or React.

### Task 3 — Reversible v2 migration

- Convert a normalized v2 card into a deterministic v3 migration bundle.
- Preserve every learning-state field, timestamps, revision and library epoch.
- Restore the original compatibility card from the rollback snapshot.
- Prove idempotency and v2 → v3 → rollback equivalence.

### Task 4 — Dual-read boundary

- Accept either a v2 card document or a validated v3 aggregate.
- Return one compatibility projection for existing library/practice consumers.
- Reject malformed/unknown versions without silently manufacturing progress.

### Checkpoint B

- Migration, normalization, FSRS and review scheduler tests pass.
- Full unit suite remains green.

### Task 5 — Storage and security contracts

- Add owner-scoped v3 learning-state repository paths behind a non-UI adapter.
- Add Firestore Rules for read-only published lexemes/memberships and strictly
  owner-scoped learning states.
- Add source/rules tests for ids, field allowlists, schema versions and denial of
  catalog client writes.

### Task 6 — Release verification and independent review

- Run TypeScript, unit, Functions, Rules where the environment permits, release
  build, secrets, bundle, audit, accessibility and browser E2E.
- Review correctness, architecture, security, performance and rollback evidence.
- Commit only after all actionable findings are resolved.

## Success criteria

1. Identical text in two languages creates different lexeme ids.
2. Two senses of one lemma create different lexeme ids.
3. IELTS, TOEIC and General memberships can reference one lexeme and one learner
   state without duplicating progress.
4. Migration preserves FSRS, review history, bookmark, difficulty, streak,
   custom collection, counters and mutation metadata.
5. Rollback reconstructs the original normalized v2 compatibility card.
6. v2 and v3 documents dual-read into the same consumer shape.
7. Invalid external v3 data is rejected at the seam.
8. Client catalog writes are denied and users cannot access another learner's
   state.
9. Existing Phase 1 architecture and release gates remain green.

## Commands

```bash
npm run lint
npm test -- --run
npm --prefix functions run lint
npm --prefix functions test
npm run test:rules
npm run build:release
npm run verify:secrets
npm run verify:bundle
npm run test:a11y
npx playwright test --project=chromium --project=webkit
npm audit --audit-level=high
```

## Boundaries

- Always: validate untrusted documents, preserve progress, keep changes additive,
  use tests before implementation and commit reversible increments.
- Ask first: production migration/deletion, deployment, new Firebase project,
  secrets, runtime dependencies or catalog data with unclear licensing.
- Never: overwrite v2 cards as a side effect of reading, merge progress by word
  alone, permit client catalog publication or drop rollback evidence.

## Implementation record

Completed on 2026-08-03:

- Added canonical, language-aware v3 identity and bounded validation for Language
  Profile, Lexeme, Track Membership and learner-owned Learning State.
- Added a deterministic v2 migration planner with resumable quarantine results,
  create-if-absent catalog application, conflict detection and trusted rollback
  guarded by revision/library epoch.
- Added strict v2/v3 compatibility reads plus a bounded Firestore join adapter.
  Draft, missing and malformed catalog references are quarantined; retryable
  infrastructure failures remain retryable.
- Added published-v3 query constraints and the required composite membership
  index. Catalog mutations and all client Learning State mutations are denied.
- Wired the v3 reader into the production composition root with a lazy import so
  the initial JavaScript bundle remains within budget.

Verification evidence:

- TypeScript, architecture analysis and diff checks passed.
- Application tests: 98 files / 540 tests passed after final adapter hardening.
- Functions: 25/25 tests passed; lint and build passed.
- Chromium: 35/35 E2E tests passed; WebKit: 34 passed and the automated axe test
  was intentionally skipped by that test's browser guard.
- Release build, secret scan, bundle budget and both dependency audits passed.
  Initial JavaScript measured 277,349 bytes gzip against the 280,000-byte limit.
- Firestore Rules source tests passed. The Rules emulator could not run because
  this workstation has no Java runtime. Firefox also hangs during browser startup
  in this environment; a one-test smoke run was interrupted after reproducing it.

No v2 document was overwritten or deleted, and no migration, deployment, secret,
or production Firebase change was executed.
