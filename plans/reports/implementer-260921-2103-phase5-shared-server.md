# Phase 5 shared-deck server idempotency

Status: DONE_WITH_CONCERNS

## Delivered

- V2 validates the authenticated owner plus required `opId` and ISO `operationCreatedAt`; request fingerprints are canonical SHA-256 hashes of the normalized public deck payload.
- The shared-deck transaction reads an owner-scoped receipt before quota/rate checks, replays the original response, rejects a changed fingerprint, and writes receipt, share, ownership, quota ledger, and rate-budget counters atomically on first execution.
- Operation timestamps reject over-five-minute future skew and operations older than 30 days. Receipts have trusted server `createdAt` and a 30-day `expiresAt`; TTL expiry cannot turn an old operation into a new mutation.
- Legacy `createSharedDeck` accepts no operation only through the explicit `2026-12-31T23:59:59.999Z` compatibility endpoint. V2 is strict.
- Receipt paths remain denied to direct clients by the existing catch-all default-deny Firestore rules; no rules edit was needed and concurrent facet edits were left untouched.

## Validation

`npm --prefix functions test -- inputValidation.test.ts sharedDeckPersistence.test.ts sharedDeckPersistenceFirestore.integration.test.ts sharedDeckCallable.test.ts rateLimiter.test.ts`

- Passed: 58 tests.
- Skipped: 2 emulator integration tests because `FIRESTORE_EMULATOR_HOST` is not configured.

`npm --prefix functions run lint` — passed.

`npm --prefix functions run build` — passed.

`git diff --check -- <owned Phase 5 files>` — passed.

## Rollout blocker

Firestore TTL policy for `users/{owner}/shared_deck_receipts/{opId}.expiresAt` must be configured and verified before deployment. This task intentionally made no production TTL/deployment change.
