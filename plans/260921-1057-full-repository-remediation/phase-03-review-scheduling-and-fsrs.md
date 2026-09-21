---
title: "Phase 3: Review scheduling and FSRS"
status: complete
---

# Phase 3: Review scheduling and FSRS

## Overview

Make review ordering explicit, validate the full FSRS domain before invoking `ts-fsrs`, and expose a result contract that distinguishes final commit from provisional offline progress.

## Requirements

- [x] After exact duplicate-receipt handling, a review whose timestamp is not strictly later than authoritative `lastReview` never writes scheduling state or history.
- [x] Client conflict recovery does not retry a stale timestamp against a newer card.
- [x] Client, Functions, normalization, and Firestore rules agree on FSRS boundary values.
- [x] Old malformed stored state keeps a documented legacy fallback and is canonicalized only on a later successful review.
- [x] Rating submission is single-flight and propagates `committed | durably-queued | stale/conflict | error` end-to-end; only `committed` is final and `durably-queued` is explicitly provisional.
- [x] Review receipts remain idempotent beyond the current 100-entry array and reject changed payloads by fingerprint.

## File inventory

| Layer | Paths |
|---|---|
| Client repository/scheduler | `src/lib/cardReviewRepository.ts`, `src/lib/reviewScheduler.ts`, `src/lib/cardNormalization.ts` |
| Learning result/replay contract | `src/features/learning/useLearningStatePersistence.ts`, `src/features/learning/useLearningStatePersistence.test.tsx`, `src/features/learning/learningStateController.ts`, `src/features/learning/useLearningWorkspace.ts`, `src/features/learning/useLearningState.ts`, `src/features/librarySession/libraryReplica.ts`, `src/features/librarySession/libraryReplica.test.ts`, `src/lib/pendingOperationStore.ts`, `src/lib/pendingOperationStore.test.ts` |
| Practice contract | `src/features/practice/usePracticeSession.ts`, `src/features/practice/StudyView.tsx` |
| Functions | `functions/src/reviewPersistence.ts`, `functions/src/reviewScheduler.ts`, `functions/src/cardPersistence.ts` |
| Rules | `firestore.rules` |
| Tests | `src/lib/cardReviewRepository.test.ts`, `src/lib/reviewScheduler.test.ts`, `src/features/practice/usePracticeSession.ownerRace.test.ts`, `src/features/practice/practiceViews.test.tsx`, `functions/test/reviewPersistence.test.ts`, `functions/test/cardPersistence.test.ts`, `firestore.rules.test.ts` |

## Implementation steps

1. Write one boundary-case table for finite numbers, `stability > 0`, `difficulty` in the supported range, integer counters/state/`learningSteps`, valid dates, and required cross-field relationships.
2. Apply the same table to client normalization/scheduling and Functions parsing/scheduling. Narrow duplication is acceptable if client and Functions cannot safely share a package; the matrix must prove parity.
3. Replace the bounded review-operation ID array as the sole idempotency proof with an owner/card-scoped receipt keyed by `opId`, storing fingerprint, original result, authoritative `createdAt`, and `expiresAt` in the same transaction as the review. Keep strict time ordering so replay remains harmless after TTL expiry.
4. After receipt lookup, require `reviewedAt > lastReview`, then apply the selected future-skew bound before scheduler invocation and before any history/state write. Equal timestamps from distinct operations are stale.
5. Stop client conflict recovery when the original timestamp is not strictly later than the fetched authoritative state; surface a typed result without recomputing a negative/zero interval.
6. Propagate the discriminated result through persistence → controller → workspace → practice. Immediate stale/conflict/error suppress publication, statistics, XP, pending acknowledgement, and recap.
7. Preserve the documented offline-first contract by treating `durably-queued` as provisional, not final: persist provisional review effects with the pending operation, promote them on authoritative commit, and on later stale/conflict rejection retire the queue item, reverse/recompute provisional statistics/XP, refresh the card, and notify the learner. Cross-restart tests must prove both promotion and compensation.
8. Make `submitStudyRating` return that result and remain single-flight. Phase 6 may advance provisionally only with visible sync-pending state; it cannot present provisional XP/statistics as final.
9. Roll out with a versioned callable/result envelope or separate V2 path. Keep the old endpoint behavior for cached clients until adoption/retirement is enforceable; do not expose new reasons to a client that cannot suppress optimistic publication. Mixed-version tests must prove zero stale publication/XP/recap/acknowledgement, not merely “no crash.” Roll back server/V2 routing before the accepting client.

## Scenario matrix

| Scenario | Expected |
|---|---|
| Review A saves, older B arrives | B returns stale conflict; card/history unchanged |
| Distinct `opId`s use equal timestamps | Second operation is stale; no double review |
| Same `opId` and same payload retries | Existing receipt/result returned |
| Same `opId` with changed payload | Rejected by fingerprint |
| Receipt expires and old request replays | Strict timestamp guard prevents mutation |
| Fractional `learningSteps` in otherwise valid Review state | Rejected before `ts-fsrs` |
| Zero/NaN/infinite stability or out-of-range difficulty | Rejected or documented legacy-read fallback; never scheduled |
| Final Study rating remains pending | No recap/counter advancement |
| Final Study rating rejects | Current card stays actionable; error shown; no recap |
| Offline provisional review later commits | Pending effects promote once; no duplicate XP/statistics |
| Offline provisional review later becomes stale | Queue retires; provisional effects compensate/recompute; learner is notified |
| Cached old client meets new deployment | It remains on the compatible endpoint and cannot interpret rejection as success |

## Validation

- Focused client: `npx vitest run src/lib/cardReviewRepository.test.ts src/lib/reviewScheduler.test.ts src/features/learning/useLearningStatePersistence.test.tsx src/features/practice/usePracticeSession.ownerRace.test.ts src/features/practice/practiceViews.test.tsx`.
- Focused server: `npm --prefix functions test -- reviewPersistence.test.ts cardPersistence.test.ts`.
- Rules/emulator: `npm run test:rules`.
- Broaden: `npm run verify:core` after Phase 6 integrates the UI contract.

## Success criteria

- [x] Out-of-order and clock-skew cases return the selected explicit policy result, with zero writes.
- [x] Boundary matrices match on client, Functions, and rules.
- [x] No invalid state reaches `ts-fsrs` and no negative-delta exception leaks to the user.
- [x] Existing valid review, revision-conflict, and idempotency tests remain green.
- [x] Mixed-version tests prove cached clients remain on the legacy endpoint while the current client uses the strict V2 contract and cannot publish, award, recap, or acknowledge a rejected review.

## Completion evidence

- Current clients call `reviewCardV2`; the legacy `reviewCard` endpoint retains its previous behavior during cached-client retirement.
- Strict reviews use atomic owner/card/operation receipts with payload fingerprints and 30-day expiry metadata. Expired or absent receipts fall through to the monotonic timestamp guard.
- Queued review effects persist with the pending operation. Restart replay checkpoints the authoritative card before idempotent XP settlement and acknowledgement; rejection restores the authoritative card before retiring the operation.
- Study and Daily Learning advance only after an explicit committed/published result. Queued, conflict, owner-loss, and permanent-error paths do not publish recap or final counters.
- Final focused verification: root lint; 124 client tests; 53 Functions tests; Functions lint/build; Firestore rules plus integration suites (80 tests); `git diff --check`. Independent re-review returned `ACCEPT`.

## Risks and rollback

- Risk: rejecting client clocks too aggressively blocks legitimate offline reviews. The Phase 1 skew decision must define the tolerated window and UI outcome.
- Rollback in compatibility order (server/rules before the accepting client) and keep malformed-record read fallback throughout.
