---
phase: 2
title: "Persist and enforce the generation contract"
status: completed
priority: P1
effort: 8h
dependencies: [1]
---

# Phase 2: Persist and enforce the generation contract

## Context links

- State document and mutation transactions: `src/lib/cardRepository.ts:688-723`, `src/lib/cardRepository.ts:730-1129`
- Migration Firestore adapter: `functions/src/legacyLibraryMigrationFirestore.ts:84-193`, `functions/src/legacyLibraryMigrationFirestore.ts:195-447`
- Current Rules state/card boundaries: `firestore.rules:192-320`, `firestore.rules:443-488`, `firestore.rules:652-733`
- Rollback preconditions: `functions/src/legacyLibraryMigrationFirestore.ts:504-599`

## Overview

Persist `mutationGeneration` on `profile/library_state`, advance it exactly once for each real client card mutation, and compare it in every migration adapter transaction. Make migration progress owner-readable but server-written.

## Dependencies and file ownership

- Blocked by Phase 1 contract/state-machine definitions in `functions/src/legacyLibraryMigration.ts`.
- This phase exclusively owns the files listed below. Phase 1 and Phase 3 must not edit them.
- No schema backfill job: absent generation is normalized to `0` on read and upgraded by the first compatible write.

## Architecture and data flows

### Client card mutation

1. **Input:** authenticated owner, queued create/patch/delete command, command `libraryEpoch`, current card/reservation/tombstone documents.
2. **Read:** transaction reads `profile/library_state`; normalize missing/invalid `mutationGeneration` to `0` and compare command epoch.
3. **Transform:** execute existing identity/revision/tombstone validation; track whether the transaction will actually change a card, reservation, or tombstone.
4. **Write:** if mutation occurs, write the card-side changes plus `{schemaVersion: 2, libraryEpoch, mutationGeneration: previous + 1}` to the same state document/transaction. Idempotent/no-op/conflict returns do not increment.
5. **Exit:** existing repository result shape; no generation added to offline operation payloads.

Actual repository callers total 12:
- Create: `src/features/importExport/useSpreadsheetImport.ts:120`, `src/features/importExport/useSpreadsheetImport.ts:169`, `src/features/intake/cardIntakePipeline.ts:506`, `src/features/librarySession/libraryReplica.ts:455`.
- Patch: `src/lib/cardRepository.ts:176`, `src/lib/cardRepository.ts:355`, `src/lib/cardRepository.ts:1151`, `src/features/librarySession/libraryReplica.ts:540`, `src/features/learning/useLearningStatePersistence.ts:119`.
- Delete: `src/features/librarySession/libraryReplica.ts:501`, `src/features/learning/useLearningStatePersistence.ts:237`.
- Definitions are `src/lib/cardRepository.ts:730`, `src/lib/cardRepository.ts:907`, `src/lib/cardRepository.ts:985` and are not counted as callers.

### Migration page/apply/progress/completion

1. **Input:** owner-derived adapter call, expected epoch/generation, phase/cursor, v3 progress.
2. **Read page:** read state + progress; query at most `batchSize + 1`; load only page-scale canonical cards/reservations; reread state.
3. **Validate:** reject if either epoch or generation changed between state reads. Missing state field is generation `0`.
4. **Apply:** transaction reads current state and backup root; compare both epoch/generation before any Admin card write. Migration-owned writes do not advance ordinary generation.
5. **Progress:** compare-and-set expected epoch/generation and explicit phase cursors in one transaction.
6. **Complete:** final verification EOF transaction compares epoch/generation, writes v3 complete progress and backup completion metadata.
7. **Rollback:** require backed-up epoch, final completed generation, and existing card-revision preconditions; restore prior progress, never decrement owner generation.

### Rules enforcement

- Card create/update/current-generation delete must observe `getAfter(profile/library_state)` at exactly previous generation `+1` in the same atomic request.
- Library-state updates remain owner-only, schema-locked, epoch nondecreasing, and generation monotonic/no-skip.
- Old-generation cleanup at `src/lib/cardRepository.ts:1284-1310` remains generation-exempt: its prior epoch increment is the stronger fence, and deleting intentionally obsolete documents cannot introduce hidden migration work.
- Add exact `profile/query_migration` match: owner read; client create/update/delete false. Exclude it from generic profile writes at `firestore.rules:727-732` because overlapping Rules grants are OR-combined.

## Persistence and compatibility contract

- State: `{schemaVersion: 2, libraryEpoch, mutationGeneration}`; existing missing field reads as `0`.
- Roll out in three revisions: (A) preparatory Rules accept the optional field without requiring it, (B) compatible client/Functions write/read it, (C) enforcement Rules require exact participation. Retain A as the rollback target until all compatible clients are retired.
- Progress: bump `MIGRATION_VERSION` from 2 at `functions/src/legacyLibraryMigrationFirestore.ts:25` to 3. V2/malformed progress—including an old `complete: true`—is treated as incomplete and must pass full apply + verification.
- Backup root keeps immutable `startedMutationGeneration`, CAS-updated `expectedMutationGeneration` when an active job restarts, and final `completedMutationGeneration`. Source backups remain first-write-wins; existing revision checks prevent rollback over later user edits.
- A completed v3 marker remains sticky after enforcement Rules: ordinary later v2 card writes cannot recreate legacy shape. Do not rescan merely because generation advances after completion.
- Before enforcement Rules, do not trust or run completion: an old client may still write without generation participation.
- The browser helper `migrateLegacyCardQueryFields` at `src/lib/cardRepository.ts:314` has no production caller found. Keep it non-authoritative; after Rules cutover its direct progress write fails closed. Do not add new callers or use its progress as completion evidence.

## Related code files

- Modify: `functions/src/legacyLibraryMigrationFirestore.ts` — v3 progress, epoch+generation CAS, apply/complete/rollback checks.
- Modify: `src/lib/cardRepository.ts` — state normalization and atomic increments in create/patch/delete/epoch reset.
- Modify: `firestore.rules` — state schema, atomic card mutation predicate, server-only progress.
- Modify: `functions/test/legacyLibraryMigrationFirestore.test.ts` — bounded adapter and generation-read tests.
- Modify: `src/lib/cardRepositoryUniqueness.test.ts` — transaction increment/no-op behavior.
- Modify: `firestore.rules.test.ts` — emulator authorization/atomicity behavior.
- Modify: `firestoreRulesSource.test.ts` — structural trust-boundary assertions.
- No new files.

## Implementation steps

1. Add one shared local normalizer for state `mutationGeneration`; preserve safe integer/nonnegative validation.
2. Update `incrementLibraryEpoch()` to retain monotonicity and advance generation once with epoch.
3. In create/patch/delete transactions, write next generation only on actual card-side mutation; do not return it publicly.
4. Add generation to page, backup, apply, progress, completion, and rollback CAS checks; progress commits also compare the Phase 1 phase/cursor token.
5. Replace overloaded cursor fields with Phase 1 apply/verification fields in v3 progress; reject v2 completion as stale evidence.
6. Add Rules helper using before-state default `0` and `getAfter` exact `+1`; apply to relevant card mutations without breaking old-generation cleanup.
7. Remove `query_migration` from generic client-write scope.
8. Add focused tests before broad suite execution.

## Todo list

- [x] Add state generation normalization and exact-once repository increments.
- [x] Persist v3 phase/generation progress and backup metadata.
- [x] Enforce epoch+generation CAS in adapter and rollback paths.
- [ ] Produce preparatory and enforcement Rules revisions. Final enforcement source is present; a separately retained preparatory deployment artifact is not verified here.
- [x] Protect `query_migration` from client writes.
- [x] Add repository, adapter, and Rules regressions.

## Test matrix

| Layer | Scenario | Expected |
|---|---|---|
| Unit/repository | First create with missing state generation | Card + reservation + state generation 1 commit atomically |
| Unit/repository | Patch, legacy upgrade, reservation repair | Each real transaction increments exactly once |
| Unit/repository | Real delete/tombstone | Tombstone + delete + generation increment atomically |
| Unit/repository | Existing create, duplicate delete retry, empty patch, conflict | No generation increment |
| Unit/repository | Epoch increment | Epoch and generation each advance once; existing generation never resets |
| Adapter | Missing generation | Captured as 0 |
| Adapter | Generation changes during page lookup | Typed retryable generation error; no page returned |
| Adapter | Generation changes before apply/progress/complete | No state/progress/card commit |
| Adapter | V2 `complete: true` | Parsed as incomplete v3 work |
| Rules | Card mutation without state update | Denied |
| Rules | Card mutation with exact state `+1` | Allowed for owner |
| Rules | Reused, decremented, or skipped generation | Denied |
| Rules | Cross-owner state/card write | Denied |
| Rules | Old-generation cleanup after epoch advance | Allowed without per-delete generation churn |
| Rules | Client writes `query_migration` | Denied; owner read remains allowed |

## Success criteria

- [x] Every actual repository card-side mutation shares one transaction with exactly one generation increment.
- [x] Every adapter state transition checks epoch and generation.
- [x] Old v2 completion cannot bypass verification.
- [ ] Client cannot forge migration progress/completion at runtime; Rules-source trust-boundary checks pass, Java-backed denial/allowance remains unverified.
- [x] Existing repository return types and callable input/output shapes remain unchanged.
- [x] Focused repository, adapter, and Rules-source regressions pass in available suites.
- [ ] Java-backed Rules tests pass; BLOCKED/NOT RUN pending Java 21 and Firestore Emulator validation.

Phase 2 implementation and available repository/adapter/source validation complete. Runtime Rules acceptance and a separately retained preparatory Rules artifact remain release-gate evidence, not claimed here.

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Owner state becomes write hotspot | High at concurrent import/sync | High | Keep one increment per real transaction; preserve transaction retry; monitor aborted/contention rates |
| Increment on idempotent retry creates churn | Medium | High | Explicit `didMutate` branch tests for every early return |
| Rules expression budget exceeded / runtime deny path unverified | Medium | High | One compact `getAfter` helper; Java 21 Rules suite remains mandatory before release |
| V2 progress wrongly trusted | Medium | Critical | Version bump; incompatible progress defaults to apply-from-start |
| Client forges complete through wildcard | High | Critical | Exact path plus generic-match exclusion |

## 10x behavior

At 10x concurrent card writers, the single owner state document fails first: Firestore transaction retries/`aborted` errors rise before correctness fails. At 10x the known 1,175-card owner size, two 100-card passes require roughly 236 page calls/probes, so the current 100-batch operator cap fails closed before completion. Phase 3 makes both limits observable and tests bounded failure.

## Rollback

1. Stop callable/operator migration before relaxing enforcement.
2. Roll back enforcement Rules to the retained preparatory Rules revision, not the original schema-locked Rules; this accepts both missing and present generation fields.
3. Roll back client/Functions only while migration is stopped. Old code must ignore unknown v3 progress and must not trust v3 complete.
4. After migration writes, use owner-scoped rollback only while completed generation and card revisions match; never decrement owner generation.
5. Any interval under non-enforcing Rules invalidates affected owners’ v3 progress. Before resuming, an owner-scoped Admin action must clear/reset that progress and rerun apply + verification under restored enforcement.

## Security considerations

Generation is owner-state coordination, not caller authority. Callable owner remains derived from Auth/App Check. Admin migration bypasses client Rules but independently CAS-checks state. Progress becomes server-owned so an owner cannot forge cursor, backup linkage, or completion.

## Next steps

Phase 3 remains partial: run Java 21 Rules/Firestore Emulator acceptance, then close offline and rollout evidence. Owner: release validation; definition of done: no emulator skips and captured pass counts.
