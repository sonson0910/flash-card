# Phase 5 facet receipts

Status: DONE_WITH_CONCERNS

## Delivered

- Added owner-scoped receipt documents at `users/{ownerId}/library_facet_receipts/{opId}`. Each transaction reads the receipt before mutable state and atomically creates it with the facet mutation.
- Receipts persist the request fingerprint, original facet result, Admin SDK server timestamp (`createdAt`), and a 30-day `expiresAt`. The old 128-entry profile ledger remains a compatibility write only.
- Strict V2 operations use `v2:<epochMs>:<nonce>:<sha256>` and require an exact matching ISO `operationCreatedAt`; the SHA-256 input is `library-facet-v2:<epochMs>:<nonce>`. The timestamp is fingerprinted, limited to five minutes future / 30 days old, and cannot be refreshed under the same V2 opId after TTL cleanup.
- Legacy operations omit `operationCreatedAt` and remain accepted only before the explicit UTC cutoff `2026-12-31T00:00:00.000Z`. Their receipts expire no earlier than cutoff plus 30 days, so no accepted legacy operation loses its receipt before the compatibility window closes; post-cutoff requests reject.
- The callable performs validated durable-receipt preflight before rate-budget consumption, returning a stored replay (or rejecting a fingerprint conflict) even when a normal request would be rate limited.
- Denied all direct client access to the durable receipt path; added rules coverage and an emulator concurrency integration test.

## Required client wire contract

V2 `updateLibraryFacets` requests must include a stable pair: `operationCreatedAt: string` (ISO-8601) and `opId = v2:<epochMs>:<nonce>:<sha256>`, with `epochMs === Date.parse(operationCreatedAt)` and SHA-256 over `library-facet-v2:<epochMs>:<nonce>`. Legacy clients must omit `operationCreatedAt` and cease by the cutoff above.

## Validation

- `npm --prefix functions test -- libraryFacetPersistence.test.ts` — pass (12 tests)
- `npm --prefix functions run lint` — pass
- `npm --prefix functions run build` — pass
- `npx --yes firebase-tools@15.23.0 emulators:exec --only firestore --project demo-lingoflash "vitest run --config vitest.rules.config.ts -- firestore.rules.test.ts"` — pass (61 tests)
- `npx --yes firebase-tools@15.23.0 emulators:exec --only firestore --project demo-lingoflash "npm --prefix functions test -- libraryFacetPersistenceFirestore.integration.test.ts"` — pass (1 test)
- Targeted `git diff --check` — pass

## Rollout blocker

Production Firestore TTL must be configured and verified for collection-group `library_facet_receipts`, using `expiresAt` as the TTL field, before rollout. This change does not deploy or mutate production TTL policy; record the policy verification evidence with the release/rollback record.

## Concerns

- The required client propagation of `operationCreatedAt` is owned by the `cardRepository` worker and must land with this backend change.
