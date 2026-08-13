# Resumable duplicate cleanup job

Status: planner, authenticated/App Check callable, protected Admin operator and
emulator-backed persistence integration test implemented. Production apply remains a
separately authorized workflow action and always performs a write-free preflight first.

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

## Bounded runner

The callable executes one bounded identity-group chunk per invocation:

1. `scan`: read the owner collection and reservations, group by the exact application
identity and select up to 100 sources without splitting a word group.
   A single identity containing more than 100 source cards is refused for manual review.
2. `backup`: persist the selected source documents and plan beneath the owner's
   server-only migration backup before any destructive write.
3. `apply`: re-read live sources and the library epoch in an Admin transaction,
   recompute the plan, write the canonical card/reservation and loser tombstones, then
   delete non-canonical sources.
4. `verify`: a later empty scan rebuilds `profile/library_facets` and marks
   `profile/query_migration` complete. The browser and protected operator both repeat
   bounded calls until this verification succeeds.

Server-only paths:

- `users/{uid}/admin_library_migration_backups/{jobId}`
- `users/{uid}/admin_library_migration_backups/{jobId}/sources/{sourceCardId}`
- `users/{uid}/admin_library_migration_backups/{jobId}/plans/{normalizedWordHash}`

The fixed library epoch and deterministic plan/tombstone IDs make retries safe. A
generation change aborts the transaction. The callable accepts no owner UID: its scope
comes only from verified Firebase Auth. The operator discovers owner paths server-side
and emits only 12-character SHA-256 owner keys and aggregate counts. Apply and rollback
require one of those keys and fail unless it resolves to exactly one discovered owner.

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

Before production apply:

- Run the Java-backed Rules suite and Admin persistence emulator integration test.
- Run the protected workflow in `dry-run` mode and require zero invalid identities.
- Apply only to one dry-run owner key with the exact protected confirmation value; do
  not export plaintext data.
- Verify zero pending/invalid identities, canonical cards, reservations, tombstones,
  facets and query-migration completion before considering the repair complete.

Rollback begins by disabling the callable and dispatching the same protected operator
with `rollback` plus the exact confirmation. It restores server-only source/profile
snapshots and pre-existing reservations/tombstones only when the library epoch, final
card count, migrated revisions and absence of recreated source IDs prove that no later
user change would be overwritten.
