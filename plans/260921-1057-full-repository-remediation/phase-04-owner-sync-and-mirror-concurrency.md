---
title: "Phase 4: Owner, sync, and mirror concurrency"
status: complete
---

# Phase 4: Owner, sync, and mirror concurrency

## Overview

Make local owner epochs monotonic, complete mirror generations transactionally, settle blocked IndexedDB opens, and ensure only the current flush-lease owner may renew or release the lease.

## Requirements

- [x] An async same-owner epoch response cannot lower the accepted high-water mark.
- [x] A stale mirror generation cannot overwrite, delete, or mark a newer generation complete.
- [x] IndexedDB `blocked` paths reject with a bounded recoverable error instead of hanging.
- [x] A stale lease owner cannot release or acknowledge work for its successor.

## File inventory

| Concern | Paths |
|---|---|
| Owner epoch | `src/features/session/identitySessionController.ts`, `src/features/session/identitySessionController.test.ts` |
| Card mirror | `src/lib/cardMirror.ts`, `src/lib/cardMirror.test.ts` |
| Device lease and local store | `src/lib/deviceSync.ts`, `src/lib/deviceSync.test.ts`, `src/lib/pendingOperationStore.ts`, `src/lib/pendingOperationStore.test.ts` |
| Development lease authority | `dev/sharedDeviceStoreAdapter.ts`, `devEndpointSecurity.test.ts` |
| Lease callers | `src/features/librarySession/libraryReplica.ts`, `src/features/librarySession/libraryReplica.test.ts`, `src/features/learning/useLearningStatePersistence.ts`, `src/features/learning/useLearningStatePersistence.test.tsx` |
| Owner/rules verification | `src/features/librarySession/useLibraryDeviceSync.test.tsx`, `src/features/library/useCustomDeckWorkspace.ownerRace.test.ts`, `src/lib/cardRepository.ts`, `firestore.rules`, `firestore.rules.test.ts` |

## Implementation steps

1. In `acceptVerifiedOwnerEpoch`, keep the maximum verified epoch for the same owner; retain reset behavior only for an actual owner transition.
2. Add deferred-promise tests for high-then-low same-owner completions and A→B→A owner changes.
3. In mirror batch writes, compare epoch/revision before overwrite. Put generation verification, stale-generation deletion, and complete-marker update in one `cards + meta` read/write transaction.
4. Add one identified open attempt with settled guards plus `onblocked`/bounded rejection for versioned and forward-compatible paths. If an abandoned request succeeds late, immediately close `request.result` and never register it or replace a newer cached attempt.
5. Replace boolean acquire/release with a scoped owner-token callback. Prefer Web Locks when available; add an atomic token/expiry lease record to the pending-operation IndexedDB schema for fallback.
6. Change the dev coordinator wire contract atomically: acquire returns token + expiry; renew, ownership assertion, release, mutation, and acknowledgement require a matching token. A stale DELETE must not remove a successor lease.
7. Add renewal for long work and ownership assertions before remote mutation, conflict retry, and acknowledgement. Migrate every caller before deleting the old API.
8. Keep Firestore rule work verification-only in this phase unless a separate failing server invariant is proven; do not conflate the accepted local downgrade with an unproven exact-`+1` rule change.

## Deterministic race matrix

| Interleaving | Expected |
|---|---|
| Same owner receives epoch 12 then delayed 11 | Remains 12 |
| Generation A checks, B begins/writes, A finishes | B cards and meta survive; A cannot complete |
| A batch writes older revision after B | B revision remains |
| IDB upgrade remains blocked | Promise rejects within bounded time |
| Timed-out IDB open succeeds late | Late connection closes and cannot replace the current attempt |
| Lease A expires, B acquires, A releases | B remains owner |
| Long flush exceeds original expiry | Heartbeat retains ownership or operation stops before write |
| Callback throws | Matching lease is released once |

## Validation

- `npx vitest run src/features/session/identitySessionController.test.ts src/lib/cardMirror.test.ts src/lib/deviceSync.test.ts src/lib/pendingOperationStore.test.ts src/features/librarySession/libraryReplica.test.ts src/features/learning/useLearningStatePersistence.test.tsx src/features/librarySession/useLibraryDeviceSync.test.tsx src/features/library/useCustomDeckWorkspace.ownerRace.test.ts devEndpointSecurity.test.ts`.
- Rules remain regression evidence: `npm run test:rules`; no new epoch rule is planned without a separately validated finding.
- Broaden: `npm run test:e2e:phase6` for offline/reconnect behavior after focused tests pass.

## Success criteria

- [x] All race tests use controlled deferred operations rather than timing sleeps.
- [x] Incomplete mirrors never become authoritative and recover on next sync.
- [x] Two tabs cannot both retain a live lease; stale release is harmless.
- [x] No caller remains on the old acquire/release contract.

## Completion evidence

- Same-owner epochs retain their high-water mark; mirror completion/deletion/patches are generation and revision guarded.
- Scoped leases use opaque tokens, automatic heartbeat, Web Locks/IndexedDB fallback, atomic dev-server enforcement, and settlement-before-ack across learning, intake, custom-deck, and replica paths.
- Versioned and forward-compatible IndexedDB opens are bounded; blocked/late-success paths reject and close abandoned connections.
- The final Phase 4 inventory passed 179 tests, the adjacent intake/custom suite passed 48 tests, root lint passed, and the independent review returned `PASS`.

## Risks and rollback

- Risk: lease heartbeat complexity can create orphan work. Keep one callback abstraction and bounded renewal; do not expose token management to feature code.
- Rollback mirror/lease code as a unit; preserve the database schema and force a clean local resync rather than trusting partial state.
