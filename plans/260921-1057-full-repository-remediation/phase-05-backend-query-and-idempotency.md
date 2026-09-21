---
title: "Phase 5: Backend queries and idempotency"
status: complete
---

# Phase 5: Backend queries and idempotency

## Overview

Make every supported Firestore query deployable and make facet/shared-deck retries return the first committed result instead of applying a second mutation.

## Requirements

- [x] The index manifest covers each query shape that production code can emit.
- [x] Replaying a facet operation after more than 128 later operations remains idempotent.
- [x] Retrying shared-deck creation after an ambiguous commit returns the original share and consumes quota once.
- [x] Receipt documents are server-owned, owner-scoped, fingerprinted, and written atomically with their mutation.
- [ ] A verified Firestore export/backup and rollback record exists before rollout.

## File inventory

| Concern | Paths |
|---|---|
| Query shapes/indexes | `src/lib/cardRepository.ts`, `src/features/multilingual/multilingualFirebaseReader.ts`, `firestore.indexes.json`, `deployGateSource.test.ts` |
| Facet receipts | `functions/src/libraryFacetPersistence.ts`, `functions/test/libraryFacetPersistence.test.ts`, `firestore.rules`, `firestore.rules.test.ts` |
| Shared-deck idempotency | `functions/src/inputValidation.ts`, `functions/src/index.ts`, `functions/src/rateLimiter.ts`, `functions/test/rateLimiter.test.ts`, `functions/src/sharedDeckPersistence.ts`, `functions/test/sharedDeckPersistence.test.ts`, `functions/test/sharedDeckPersistenceFirestore.integration.test.ts`, `functions/test/sharedDeckCallable.test.ts`, `src/features/sharing/sharedDeckSessionController.ts`, `src/features/sharing/sharedDeckSessionController.test.ts`, `src/features/sharing/sharedDeckFirebaseAdapter.ts`, `src/features/sharing/sharedDeckService.ts`, `src/features/sharing/sharedDeckService.test.ts` |

## Implementation steps

1. Mechanically enumerate the complete reachable filter state from `useAppLibraryRuntime` through `cardRepository`, including every independent equality/date/search combination and all order modes. Either provide a manifest entry or reject an unsupported combination at the query boundary; a hand-picked example list is insufficient.
2. Add a contract test that derives those reachable signatures and checks the manifest, including multilingual membership queries. Add only required composites and retain existing indexes until production evidence supports removal.
3. Introduce an owner-scoped facet receipt keyed by validated `opId`. Store fingerprint, original result, authoritative `createdAt`, and `expiresAt`; read/write it in the same transaction as the mutation while retaining the bounded array temporarily for compatibility.
4. Implement the selected retention guarantee explicitly. Configure and verify the Firestore TTL owner/policy. If receipts expire, reject operations older than the accepted retry window through the chosen monotonic age/sequence contract so expiry can never turn a replay into a new mutation.
5. Make `sharedDeckSessionController` own one logical `opId`, persist owner + request fingerprint + `opId` across timeout/user retry/reload until a terminal response or expiry, and pass it unchanged through the Firebase adapter and service.
6. In one server transaction, bind `owner + opId + fingerprint` to the first share ID/result and consume share quota once. Make owner/service rate-limit charging idempotent for that same key, so an identical retry can return the receipt even when the ordinary bucket is now exhausted.
7. Apply the legacy-client compatibility window and reject any reused `opId` with a changed fingerprint.
8. Deny direct client access to receipt paths. Run emulator integration before rules/index deployment and wait for index readiness before enabling dependent queries.

## Scenario matrix

| Scenario | Expected |
|---|---|
| Category/custom deck plus prefix search | Required manifest entry exists; emulator query succeeds |
| Custom deck plus due-date order | Required manifest entry exists; pagination stable |
| Maximum reachable UI filter combination | Covered by manifest or rejected before Firestore query creation |
| Replay facet operation 1 after 129 later operations | No second delta/clear; original result returned |
| Concurrent identical facet operations | One mutation |
| Same facet `opId`, changed payload | Reject |
| Shared-deck commit succeeds but response is lost | Retry returns same share ID/expiry; quota unchanged |
| Retry occurs after reload and rate bucket is exhausted | Same stored result returned without a second rate charge |
| Concurrent identical share create | One public share |
| Same share `opId`, different deck | Reject |

## Validation

- `npx vitest run src/features/sharing/sharedDeckService.test.ts src/features/sharing/sharedDeckSessionController.test.ts deployGateSource.test.ts` plus the new index-manifest contract test.
- `npm --prefix functions test -- libraryFacetPersistence.test.ts sharedDeckPersistence.test.ts sharedDeckCallable.test.ts rateLimiter.test.ts`.
- `npm run test:rules` including `sharedDeckPersistenceFirestore.integration.test.ts` and the facet receipt integration case.
- Inspect deployed index state separately before rollout; a declared but still-building index is not ready.

## Success criteria

- [x] Every supported query signature has verified manifest coverage.
- [x] Retry-after-eviction and ambiguous-commit tests prove exactly-once mutation behavior.
- [x] Receipt/direct-access rules pass and legacy behavior matches the chosen window.
- [x] Post-expiry tests prove an expired receipt cannot re-enable a mutation; production TTL activation/readback remains a rollout gate.
- [ ] Backup/export ID and restore instructions are recorded before deployment authorization is requested.

## Completion evidence

- The exhaustive query contract covers 576 reachable UI states; accepted single-range families map to the additive manifest and unsupported mixed-range families reject before query construction.
- Facet and shared-deck operations use timestamp-bound V2 identities, fingerprinted owner-scoped receipts, fail-closed client persistence, and compatibility cutoffs. Shared quota/rate charging is atomic with first creation.
- Focused client tests passed 45 tests, Functions passed 76 tests, Firestore rules passed 61 tests, and emulator concurrency integrations passed.
- Production deployment remains unauthorized until the `library_facet_receipts` and `shared_deck_receipts` TTL policies are configured/read back, additive indexes are ready, and a Firestore export/restore record is verified.

## Risks and rollback

- Risk: transaction document limits/contention. Keep one receipt lookup/write per logical operation and benchmark emulator concurrency.
- Rollback: restore legacy reads while leaving additive receipt documents and indexes intact; never delete receipt data during rollback.
