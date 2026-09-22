# Phase 3 review rollout gaps

## Changed

- Added `reviewCardV2`; the current client calls it while `reviewCard` masks strict-only rejection details for cached clients.
- Receipt lookup now honors `expiresAt`; stale replays after an absent or undeleted expired receipt reach strict timestamp validation.
- Removed bounded `appliedReviewOperationIds` as a post-TTL duplicate proof because it has no fingerprint/result.
- Added behavioral callable, receipt, and restart queue tests.

## Validation

- `npm --prefix functions run lint` — passed.
- `npm --prefix functions test -- reviewPersistence.test.ts reviewCallable.test.ts` — passed (24 tests).
- `npx vitest run src/lib/cardReviewRepository.test.ts src/features/librarySession/libraryReplica.test.ts` — passed (20 tests).

## Remaining risk

The current queue-retirement contract acknowledges, notifies, and calls the existing cloud refresh event, but does not fetch and restore an authoritative card before acknowledgement. It also has no cross-restart XP/stat settlement callback; those require the broader event/persistence contract work assigned by the controller.
