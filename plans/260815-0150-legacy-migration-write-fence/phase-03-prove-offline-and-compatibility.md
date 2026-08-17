---
phase: 3
title: "Prove offline, compatibility, and regression behavior"
status: partial
priority: P1
effort: 4h
dependencies: [2]
---

# Phase 3: Prove offline, compatibility, and regression behavior

## Context links

- Emulator migration fixture: `functions/test/legacyLibraryMigrationFirestore.integration.test.ts:18-157`
- Pending flush/acknowledgment path: `src/features/librarySession/libraryReplica.ts:400-621`
- Replica owner lifetime: `src/features/librarySession/useLibraryDeviceSync.ts:64-93`
- Session-generation guard: `src/features/librarySession/ownerLibrarySessionController.ts:129-162`, `src/features/librarySession/ownerLibrarySessionController.ts:314-341`
- Browser callable loop/bound: `src/features/librarySession/legacyLibraryMigrationService.ts:47-82`
- Operator owner/bounds: `functions/src/legacyLibraryMigrationOperator.ts:45-84`
- Release ordering/rollback runbook: `docs/runbooks/phase-6-rollout.md:118-128`, `docs/runbooks/phase-6-rollout.md:148-170`

## Overview

Prove the exact earlier-sorting insertion regression on Firestore, verify offline operations stay queued on generation contention/denial, and document the staged Rules/client/Functions rollout with a non-enforcing rollback target.

Current state: source and available unit validation are present, but Java-backed Rules and Firestore Emulator acceptance is BLOCKED/NOT RUN. Phase 3 therefore remains partial and this plan is not release-ready.

## Dependencies and file ownership

- Blocked by Phase 2 persistence and final Rules contract.
- This phase exclusively owns the files below; it does not change state-machine, adapter, repository, or Rules implementation files.
- Integration tests require Firestore Emulator and Java 21. Lack of Java is a release blocker, not a skip accepted for approval.

## Architecture and data flows

### Earlier-sorting insertion regression

1. **Seed:** owner state `(epoch=2, generation=0)` and enough legacy cards for at least two ordered pages.
2. **Advance:** run one apply page and persist a cursor after a lexically later ID.
3. **Concurrent client-equivalent mutation:** one Firestore transaction creates `a-earlier` and changes owner generation `0 → 1`.
4. **Resume:** migration loads active progress expected at generation 0, observes 1, resets apply/verify cursors and root expected generation.
5. **Reapply:** scan starts from document-ID beginning; `a-earlier` is selected, backed up, canonicalized, and reserved.
6. **Verify:** scan starts from beginning again; all pages are clean at generation 1.
7. **Exit:** only then persist v3 complete with `completedMutationGeneration=1`.

### Offline pending retry

1. **Input:** owner-scoped pending create/patch/delete already durable locally.
2. **Cloud step:** replica calls repository transaction at `src/features/librarySession/libraryReplica.ts:451-587`; generation is read in repository, never stored in the operation payload.
3. **Failure:** transaction abort/contention or enforcement Rules denial throws before cloud settlement.
4. **Catch:** flush reaches `src/features/librarySession/libraryReplica.ts:601-617`; no operation is added to successful acknowledgment.
5. **Exit:** `acknowledgeDevicePending` at `src/features/librarySession/libraryReplica.ts:589` does not receive failed work; owner-scoped pending remains for retry.
6. **Retry/account switch:** a new transaction derives current generation. Late completion publishes only while `isOwnerCurrent()` is true.

### Compatibility rollout

1. Deploy preparatory Rules accepting optional generation; retain exact digest/revision.
2. Deploy compatible Hosting client and Functions v3; observe transaction aborts, permission denials, App Check, sync-loss, and stale-client signals.
3. Deploy final enforcement Rules only after compatible-client observation.
4. Verify representative existing owners with absent generation upgrade `0 → 1` on first real write.
5. Run owner-scoped dry-run/apply only after enforcement. No owner discovery or browser-supplied owner ID.
6. On rollback, stop migration, restore preparatory Rules, then decide client/Functions rollback. Track affected explicit owners; clear/reset their v3 progress before any later resume under restored enforcement.

## Related code files

- Modify: `functions/test/legacyLibraryMigrationFirestore.integration.test.ts` — real Firestore earlier-ID and rollback-generation regressions.
- Modify: `src/features/librarySession/libraryReplica.test.ts` — pending acknowledgment/account-switch failure behavior.
- Modify: `src/features/librarySession/legacyLibraryMigrationService.test.ts` — verification-only page and 30-call bound behavior.
- Modify: `docs/runbooks/phase-6-rollout.md` — staged compatibility, observation, enforcement, stop/rollback order.
- No new files.

## Implementation steps

1. Extend emulator seed state with generation and assert v3 progress shape.
2. Add the exact cursor-advance/concurrent earlier-insert scenario; assert no intermediate complete marker.
3. Add generation change during verification and post-completion rollback-refusal cases.
4. Mock repository abort/permission failure for each pending operation family; assert no acknowledgment and retry preservation.
5. Simulate owner switch before a rejected/late flush settles; assert no error/UI publication into the new owner while old pending data remains owner-scoped.
6. Extend callable-loop tests so clean verification pages (`migrated=0`, `scanned>0`, `complete=false`) count as forward progress and the 30-call ceiling fails closed.
7. Add runbook gates and exact rollback ordering; do not claim deployment occurred.
8. Run focused tests, then full root/Functions/Rules suites and both typechecks.

## Todo list

- [ ] Add real Firestore earlier-ID and verification-race regressions.
- [ ] Prove pending operations survive abort/denial and owner switch.
- [ ] Prove browser/operator limits fail closed.
- [ ] Update staged rollout and rollback runbook.
- [ ] Run Java 21 emulator, full tests, and both typechecks.

## Test matrix

| Level | Scenario | Observable assertion |
|---|---|---|
| Unit | Apply/verify state transitions | Covered by Phase 1; no complete from apply cursor |
| Unit | Repository increments/no-ops | Covered by Phase 2; exact once per real mutation |
| Integration | Earlier `a-earlier` insert after cursor | Generation mismatch, restart, card migrated, full clean verify, then complete |
| Integration | Mutation during verification | Verification discarded; no complete; next apply begins at start |
| Integration | User write after completion then rollback | Completed-generation/revision precondition refuses unsafe rollback |
| Integration | Missing generation owner | First compatible write upgrades to 1 without data loss |
| Rules/emulator | Legacy client omits generation update | Read allowed; write denied after enforcement |
| Offline unit | Create/patch/delete cloud abort | Failed operation absent from acknowledgment; pending count remains |
| Offline unit | Retry | Repository invoked again without stale generation payload |
| Account switch | Old-owner flush settles late | No new-owner UI/cache publication |
| Client service | Verification-only page | Continues rather than declaring stall |
| Bounds | >30 browser pages or >100 operator pages | Deterministic bounded error; no complete marker |
| E2E emulator | Apply + concurrent insert + verify + rollback guard | Cross-component invariant passes against real Firestore transactions |

## Verification commands

- Root `npm test -- --run`: 180 files, 1,498 tests passed.
- Root lint/build passed.
- Functions `npm --prefix functions test`: 74 passed; 5 emulator tests skipped.
- Functions lint/build passed.
- `npm run test:rules` with Java 21; BLOCKED/NOT RUN locally. This command also executes `functions/test/legacyLibraryMigrationFirestore.integration.test.ts` against the Firestore Emulator.

## Validation evidence and blocker

- Verified: root 180 files/1,498 tests; Functions 74 passed/5 emulator skipped; root and Functions lint/build passed.
- BLOCKED/NOT RUN: Java 21 Rules plus Firestore Emulator acceptance, including the real earlier-ID race and runtime Rules allow/deny paths.
- Owner: release validation. Definition of done: run `npm run test:rules` with Java 21 and the emulator, record no emulator skips, then reassess the unchecked acceptance boxes.
- No production deployment, rollout, or release-ready evidence claimed.

## Success criteria

- [ ] Exact earlier-sorting insertion test fails against old cursor-only behavior and passes with generation restart; emulator acceptance BLOCKED/NOT RUN.
- [x] No active generation mismatch can produce `complete: true` in the implemented state machine and available Functions tests.
- [ ] Offline failed writes remain durably queued and owner-isolated; dedicated abort/denial and owner-switch proof not verified.
- [ ] Legacy write behavior is explicit: reads continue; nonparticipating writes fail closed after enforcement; runtime Rules proof BLOCKED/NOT RUN.
- [x] Browser remains ≤30 callable batches/action (service test); operator remains one explicit owner, 100 cards/page, ≤100 pages in source/owner-scope validation.
- [ ] Java 21 Rules and Firestore integration suites run, not skip.
- [x] Root + Functions tests and lint/build pass: root 180 files/1,498 tests; Functions 74 passed/5 emulator skipped.
- [ ] Runbook names preparatory Rules revision/digest, adoption evidence, stop condition, and rollback order.

Phase 3 partial. Java-backed Rules/emulator acceptance and the unchecked offline/rollout evidence must close before release approval.

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Emulator race test is accidentally sequential | Medium | High | Commit insertion/state change between page calls and assert stored cursor/generation before resume |
| Offline test asserts only UI, not acknowledgment | Medium | High | Assert exact `acknowledgeDevicePending` arguments and pending reload |
| Java suite remains skipped | High in current local environment | High | Owner: release validation. Run Java 21 + Firestore Emulator; no release approval while BLOCKED/NOT RUN |
| Active users starve migration | Medium | High | Run owner job during quiescent window; retry on typed abort; never weaken CAS |
| Compatibility rollback restores original Rules | Medium | Critical | Retain preparatory Rules artifact; runbook explicitly forbids original schema-locked rollback while new clients exist |

## 10x behavior and operational threshold

- **Volume:** 11,750 cards require about 118 apply pages plus 118 verification pages. Browser 30-call and operator 100-page limits fail first, deliberately, before complete. Do not raise limits in this task; resume bounded calls or schedule a separately reviewed capacity change.
- **Concurrency:** one owner state document serializes card mutations. Imports/offline flushes first show Firestore retry/`aborted` growth and migration restarts. Correctness remains fail-closed; observe abort rate, migration restart count, and age-to-completion.
- **Cost:** stable verification roughly doubles card reads plus bounded reservation/canonical lookups. Record read count and duration in non-production rehearsal before rollout.

## Rollback

- Test/code-only rollback: revert this phase's tests/runbook independently; no data side effects.
- Operational rollback: stop migration, restore retained preparatory Rules, verify both legacy/current client behavior, then roll back client/Functions if compatible. Record affected explicit owners and reset their v3 progress before any resume.
- Data rollback: only explicit owner/job with matching completion generation and revisions; preserve generation, refuse conflicts, never cascade across owners.

## Security considerations

Tests must use synthetic owner/card data and avoid logging raw user content. Operator remains sealed to project/database and explicit owner key (`functions/src/legacyLibraryMigrationOperator.ts:18-49`). Callable Auth/App Check ownership remains unchanged.

## Unresolved questions

- When will Java 21 and Firestore Emulator validation be available?
- Who will provide dedicated offline abort/denial and owner-switch evidence?

Capacity limit changes and removal of the unused browser migration helper remain deliberately out of scope.
