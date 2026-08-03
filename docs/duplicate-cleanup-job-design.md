# Resumable duplicate cleanup job

Status: planner and bounded request contract implemented; callable runner intentionally
not enabled until emulator-backed integration tests exist.

## Invariants

- A normalized word has exactly one final card at the same canonical stable document
  ID used by the browser (`createWordCardId` semantics).
- The strongest learning record supplies the merged content, even when it came from a
  legacy random document ID.
- The earliest valid `createdAt` is retained.
- Missing image, audio and image-search query may be filled from another duplicate.
- Every noncanonical source gets a deterministic tombstone before deletion.
- The job is scoped to the authenticated UID, requires App Check, and must stop if the
  user's `libraryEpoch` changes.
- Dry-run is the default. A job ID is permanently bound to its mode.

## Bounded runner design

The callable should execute one bounded chunk per invocation:

1. `scan`: read cards by document ID in chunks of 10–100 and stage a normalized,
   immutable candidate snapshot beneath the job.
2. `apply`: read staged candidates ordered by normalized word. Never split a word
   group across chunks. Re-read live cards in a transaction, recompute the plan, write
   the canonical card, write loser tombstones, then delete losers.
3. `facets`: rescan canonical cards and rebuild `profile/library_facets`. Compare the
   sum of category counts with a server count aggregation; retry a bounded number of
   times if concurrent mutations made the scan inconsistent.
4. `cleanup`: delete staging documents in chunks and mark the job complete.

Suggested server-only paths:

- `users/{uid}/duplicate_cleanup_jobs/{jobId}`
- `users/{uid}/duplicate_cleanup_jobs/{jobId}/candidates/{sourceCardId}`
- `users/{uid}/duplicate_cleanup_jobs/{jobId}/results/{normalizedWordHash}`

The job state contains phase, cursors, fixed library epoch, dry-run flag, scanned
count, duplicate groups, loser count, merge count, facet progress, lease token and
lease expiry. Result marker documents make group application idempotent if a function
finishes its transaction but crashes before advancing the job cursor.

## Primary selection

The planner compares, in order:

1. FSRS repetitions
2. review count
3. review-history length
4. correct streak
5. FSRS stability
6. bookmark state
7. revision
8. earliest creation time
9. lexicographically smallest source ID

The selected record supplies learning content, but the destination is always the
canonical stable word ID. This prevents a future atomic create from recreating a
second card at the canonical path.

## Release gates

Before exporting a callable:

- Add Firestore emulator tests for crash/retry, concurrent lease acquisition, epoch
  changes, canonical target creation, existing tombstones and facet validation.
- Add Functions integration tests using a fake or emulator Firestore; pure planner
  tests alone are not sufficient for destructive execution.
- Enforce Auth, App Check, per-user rate limiting, 120-second timeout, bounded
  instances and input parsing through `parseDuplicateCleanupRequest`.
- Deploy the dry-run callable first and compare its report with an export.
- Enable apply mode behind an explicit server parameter, initially for test accounts.
- Deploy the client service only after the callable and job-state schema are live.

Rollback is disabling apply mode. Existing job and staging documents must have TTL,
while tombstones remain durable deletion barriers.
