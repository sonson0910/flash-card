# SonFlash domain context

This glossary names the product concepts that should remain stable across UI,
persistence, tests, and future refactors.

## Library Session

The signed-in lifetime of a learner's card library. A Library Session owns
which user may see cards, pagination state, and realtime refresh. Card writes,
including reviews, are online-only callables: nothing is queued offline, and a
write that cannot reach the server fails and is retried by the learner. Data
from one signed-in user must never become visible to another user.

## Library Replica

The owner-scoped view of a learner's cloud cards, read from Firestore (which
keeps its own `persistentLocalCache`) as the single source of truth. A Library
Replica preserves identity, epoch, revision and tombstone ordering while keeping
one owner's data isolated. The IndexedDB mirror, device pending queue and
offline learning were removed; see the superseded `docs/specs/library-replica.md`.
_Avoid_: Device sync, card cache, offline copy

## Card Intake

The pipeline that turns a single generated word, a spreadsheet row, or a shared
deck entry into a normalized card. Card Intake owns validation, normalization,
deduplication, persistence, media enrichment, and the resulting library-count
and XP changes.

## Practice Session

A bounded learning run over a practice pool. Quiz, spelling, story, and study
are modes of a Practice Session. The session owns navigation, reveal state,
scoring, completion, and review persistence; a visible library page is not the
same thing as the available practice pool.

## Gamification Profile

XP, streak, level, and XP history belonging to exactly one authenticated user
or to the anonymous session. Local persistence must be scoped to that owner
before it can be synchronized to Firestore.

## Shared Device Store

Removed. The development-only local store and its dev-server endpoints no longer
exist; Firestore is the only source of truth. Only the card version
comparison helper in `src/lib/deviceStore.ts` remains.
