---
phase: 1
title: "Define mutation-generation and verification state machine"
status: completed
priority: P1
effort: 4h
dependencies: []
---

# Phase 1: Define mutation-generation and verification state machine

## Context links

- Migration contract and orchestration: `functions/src/legacyLibraryMigration.ts:21-95`, `functions/src/legacyLibraryMigration.ts:319-430`
- Current cursor persistence: `functions/src/legacyLibraryMigrationFirestore.ts:84-103`
- Existing bounded tests: `functions/test/legacyLibraryMigration.test.ts:169-237`

## Overview

Turn migration into two bounded phases—`apply` then `verify-from-start`—bound to both `libraryEpoch` and owner `mutationGeneration`. No complete marker may be written from the apply cursor.

## Requirements

- Missing generation means `0` for existing owners.
- Every migration page returns captured epoch + generation + phase.
- Persisted progress contains `expectedMutationGeneration`, apply cursor/count, verification cursor/count, and state `apply | verify | complete`.
- While state is `apply` or `verify`, a generation mismatch invalidates both cursors and restarts at apply page 1; it never resumes stale progress. A v3 `complete` marker is trusted only under the post-enforcement compatibility gate defined in Phase 2.
- Apply exhaustion transitions to verification cursor `null`.
- Verification scans from document ID start, requires every page clean/current, and remains bounded to 100 documents.
- Completion only after verification reaches EOF under unchanged epoch/generation.
- Every progress transition CAS-compares both owner epoch/generation and the stored phase/cursor token; a stale callable/operator runner cannot move progress backward.
- Public callable result shape remains `{migrated, merged, scanned, complete, remaining, invalid}`.

## Architecture and data flow

1. **Input:** owner ID derived by caller, job ID, bounded batch size, stored progress, current `libraryEpoch` and `mutationGeneration`.
2. **Prepare:** compare stored expected generation to current. Match → resume phase cursor. Mismatch → persist/reset apply cursor to `null`, counts to zero, expected generation to current.
3. **Apply:** query `cards` by document ID after apply cursor, plan/backup/apply existing migrations, then CAS progress using expected epoch/generation.
4. **Transition:** clean end of apply writes `phase=verify`, verification cursor `null`; never `complete=true`.
5. **Verify:** query from start. Reuse migration classification; any selected/invalid/missing-reservation card restarts apply. Clean pages advance verification cursor.
6. **Exit:** final clean EOF transaction compares epoch/generation and writes `phase=complete`, `complete=true`, `completedMutationGeneration`.

## Contract changes

Modify `LegacyLibraryMigrationPage` and `LegacyLibraryMigrationStore` at `functions/src/legacyLibraryMigration.ts:21-95`. Store references total 23; production implementation is `functions/src/legacyLibraryMigrationFirestore.ts:450-489`; test doubles are concentrated in `functions/test/legacyLibraryMigration.test.ts:36-127` and inline wrappers at `functions/test/legacyLibraryMigration.test.ts:194-200`, `functions/test/legacyLibraryMigration.test.ts:320-326`.

Runner callers total 10. Production paths:
- Callable: `functions/src/index.ts:321-325`.
- Completion loop/operator: `functions/src/legacyLibraryMigration.ts:394-398`, `functions/src/legacyLibraryMigrationOperator.ts:78-82`.
- Remaining callers are tests in `functions/test/legacyLibraryMigration.test.ts:175`, `:202`, `:212`, `:224`, `:227`, `:328`, `:336` and `functions/test/legacyLibraryMigrationFirestore.integration.test.ts:53`, `:91`, `:135`.

## Related code files

- Modify: `functions/src/legacyLibraryMigration.ts` — phase/generation contract and bounded state machine.
- Modify: `functions/test/legacyLibraryMigration.test.ts` — pure orchestration regressions.
- No new files.

## Implementation steps

1. Add generation/phase fields without changing callable result fields.
2. Split apply exhaustion from completion; introduce explicit verification transition.
3. Make generation change restart from apply start or throw a typed retryable generation error before any stale completion.
4. Keep dry-run write-free and generation-observing only; apply always starts/restarts from authoritative persisted state.
5. Preserve `maximumBatches` as a hard total across apply + verify.
6. Add pure tests before implementation changes.

## Todo list

- [x] Extend page/store contracts with generation, phase, and transition data.
- [x] Implement apply → verify → complete transitions.
- [x] Implement active-generation restart from apply start.
- [x] Add bounded state-machine regressions.

## Unit test matrix

| Scenario | Expected |
|---|---|
| 205 documents, page 100 | Apply pages then full from-start verification; complete only after verification EOF |
| Insert `a-earlier` after cursor reaches `z...`, increment generation | Stale cursor discarded; `a-earlier` processed from page 1; no premature complete |
| Generation changes during verification | Verification discarded; apply restarts from start |
| Callable and operator race on one owner | Stale phase/cursor CAS fails; progress never regresses or completes from stale state |
| Canonical IDs created behind apply cursor | Verification rereads them, classifies clean, completes |
| Verification finds legacy/invalid/missing reservation | No complete marker; restart/fail closed |
| Exact final page | Requires bounded verification completion probe |
| Dry-run | No progress, backup, generation, or card writes |
| Batch cap reached during second pass | Bounded error; no complete marker |

## Success criteria

- [ ] Pure regression reproduces earlier-sorting insertion and fails on old behavior. Exact Firestore insertion proof is tracked in Phase 3 and remains unverified while the emulator is skipped.
- [x] Completion is unreachable from apply phase.
- [x] All state transitions compare epoch and generation.
- [x] Public callable/operator result contracts unchanged.
- [x] `npm --prefix functions test -- legacyLibraryMigration.test.ts` passes.

Phase 1 implementation and unit/state-machine validation complete. The unchecked emulator-backed insertion proof is a Phase 3 acceptance blocker, not a source-state-machine gap.

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Verification doubles reads | High | Medium | Reuse 100-document bound; no unbounded snapshot |
| Generation churn starves completion | Medium | High | Fail/restart deterministically; surface retry; state 10x limit explicitly |
| Generated canonical IDs alter ordering | High | High | Separate from-start clean verification |
| Partial apply before mismatch | Medium | Medium | Existing apply is transactionally live-read and idempotent (`functions/src/legacyLibraryMigrationFirestore.ts:253-388`) |
| Concurrent runners overwrite progress | Low | High | CAS stored phase/cursor token as well as owner state; reject stale transition |

## Rollback

Revert the state-machine code before deploying its persistence schema. No data migration occurs in this phase. If rolled back after progress v3 exists, the Phase 2 reader must retain a compatibility projection or the rollback build must ignore unknown fields and refuse `complete` rather than trust them.

## Security considerations

Owner identity remains outside the core state machine. Do not add caller-provided UID/generation authority. Generation is read from owner state by the adapter, never trusted from callable request data.

## Next steps

Phase 2 persistence/enforcement complete. Phase 3 must run the Java 21 Rules and Firestore Emulator acceptance before release approval.
