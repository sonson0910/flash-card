# Phase 5 query indexes

Status: DONE_WITH_CONCERNS

## Delivered

- Rejected mixed date, due, and prefix range families before page, subscription, or count query construction.
- Added deterministic signature derivation and the 72 missing additive card composites; retained all existing indexes, including multilingual membership.
- Added exhaustive coverage for all 576 reachable UI filter states (384 accepted, 192 rejected) and stable document-ID pagination tie breakers.
- Added a bounded local-only facet operation ledger. Every current request, including existing UUID/derived logical operation IDs, resolves to a persisted `v2:<epochMs>:<nonce>:<sha256>` and `operationCreatedAt` pair. It survives reload, prunes after 30 days, and fails closed if a V2 retry has lost its timestamp record. Only cached old clients use the server legacy path.
- A storage write failure now blocks the callable before any network attempt. The pair is retained in a capped in-memory retry ledger and must be durably written on a later retry before the callable proceeds.

## Validation

- Passed: `npx vitest run src/lib/card-repository-query-indexes.test.ts src/lib/cardRepositoryLibraryFacets.test.ts deployGateSource.test.ts`
- Passed: Firestore index JSON parse and `git diff --check`. Root `npm run lint` was later blocked by concurrent non-owned type errors in `src/features/library/useCustomDeckWorkspace.test.tsx`, `src/features/practice/StudyView.tsx`, and `src/features/practice/practiceViews.test.tsx`.

## Concerns

- The server must retain the matching V2 receipt-expiry policy and legacy compatibility cutoff.
