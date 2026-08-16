---
title: "Fence legacy migration with owner mutation generations"
description: "Prevent same-epoch card writes from hiding legacy documents behind a persisted migration cursor."
status: partial
priority: P1
effort: 16h
issue: 16
branch: main
tags: [bugfix, backend, database, critical]
blockedBy: []
blocks: []
created: 2026-08-15
---

# Legacy migration mutation-generation fence

## Overview

Add one monotonic owner `mutationGeneration` beside `libraryEpoch`. Repository card mutations advance it in the same transaction; migration apply/verification progress captures it. Any change while migration is active invalidates its cursors, updates the backup root epoch/generation, and invalidates automatic rollback. Completion requires a bounded, from-start clean verification under one unchanged epoch/generation. Automatic rollback source backups cap at 100 and reject above-cap work before writes; rollback guards and restoration run in one Firestore transaction.

## Verified pressure point

- Migration resumes after `lastDocumentId` and rechecks only `libraryEpoch`, so an earlier same-epoch insert is invisible: `functions/src/legacyLibraryMigrationFirestore.ts:115-190`.
- Completion probes from the persisted cursor and persists `complete: true` after only an epoch check: `functions/src/legacyLibraryMigration.ts:410-426`, `functions/src/legacyLibraryMigrationFirestore.ts:416-447`.
- Create, patch, and delete already read `profile/library_state` inside Firestore transactions, providing the smallest atomic generation seam: `src/lib/cardRepository.ts:730-899`, `src/lib/cardRepository.ts:907-982`, `src/lib/cardRepository.ts:985-1129`.

## Design decision

Use generation, not a long-lived write lock. Missing generation reads as `0`; compatible writes derive/increment it inside repository transactions; pending-operation payloads stay unchanged. Migration-owned Admin writes do not increment it, but every page/apply/progress/completion step compares the captured value. Apply-plan idempotency binds `appliedMutationGeneration` (and epoch/source IDs), so a retry cannot silently reuse a stale plan. Final enforcement Rules require atomic generation advancement for client card mutations. Legacy clients without the protocol fail closed after cutover.

## Phases

| Phase | Name | Status | Depends on |
|---|---|---|---|
| 1 | [Define mutation-generation and verification state machine](./phase-01-define-mutation-generation-state-machine.md) | Completed | — |
| 2 | [Persist and enforce the generation contract](./phase-02-persist-and-enforce-generation-contract.md) | Completed | Phase 1 |
| 3 | [Prove offline, compatibility, and regression behavior](./phase-03-prove-offline-and-compatibility.md) | Partial — Java 21 Rules/emulator acceptance blocked/not run | Phase 2 |

## Dependency graph

`Phase 1 → Phase 2 → Phase 3`. Sequential by design; no parallel file overlap.

## Compatibility and rollout

1. Deploy preparatory Rules that accept optional `mutationGeneration` but do not enforce participation; retain this revision as rollback target.
2. Deploy compatible client/Functions. Missing generation reads as `0`; first compatible mutation writes `1` atomically.
3. After adoption observation, deploy enforcement Rules requiring card write + exact generation increment.
4. Only then run migration. Older clients may read; writes without generation participation fail closed and require reload/update.
5. Stop migration before rolling enforcement back to preparatory Rules. Before resuming after any non-enforcing interval, invalidate affected owners’ v3 progress and rerun from start. Never restore original Rules while compatible clients write the additive field; data rollback remains owner-scoped and never decrements generation.

## Measurable completion

- Earlier-sorting insertion after cursor advancement cannot yield `complete: true`.
- Completion includes an apply pass plus a from-start clean verification under one epoch/generation.
- Automatic rollback rejects more than 100 source backups before writes; exact post-apply tombstones are checked.
- Rollback rechecks all live guards and restores all state in one Firestore transaction.
- Callable remains auth/App Check owner-derived and batch size 10–100 (`functions/src/index.ts:305-335`, `functions/src/inputValidation.ts:215-235`).
- Operator remains one explicit owner, 100-card pages, maximum 100 batches (`functions/src/legacyLibraryMigrationOperator.ts:45-84`).
- Unit, Functions adapter, Rules-source, root, and Functions validation pass in the available environment.
- Java-backed Rules and Firestore Emulator acceptance remains BLOCKED/NOT RUN; this plan is not release-ready.

## Current validation evidence

- Root lint PASS; release workflow checks 6/6; focused catalog/date checks 264/264.
- Root Vitest 1,503/1,503 across 180 files; root build PASS.
- Functions lint/build PASS; Functions tests 79 passed, 7 skipped.
- YAML checks 4/4; all sequential explicit `.claude` Node tests 728/728; git diff check PASS.
- Java-backed Rules/emulator validation BLOCKED / NOT_RUN because Java/Javac is unavailable; skipped emulator tests are not approval evidence.
- Trust root remains intentionally `UNCONFIGURED` pending reviewed operator setup; release HOLD, not failed implementation.

## Residual blocker

- Java 21 Rules plus Firestore Emulator acceptance BLOCKED/NOT RUN. Owner: release validation. Unblock: run `npm run test:rules` with Java 21 and the emulator; capture pass/skip evidence before approval. No production deployment evidence claimed.

## Scope and verification delta

- Implementation scope unchanged. Phases 1/2 implementation complete; source, unit, adapter,
offline, and rollout checks stabilized. Phase 3 runtime Rules/emulator acceptance remains
partial solely because Java/Javac is unavailable. No deployment or release claim added.

## Unresolved questions

- When will Java 21/emulator validation be available?
