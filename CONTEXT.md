# SonFlash domain context

This glossary names the product concepts that should remain stable across UI,
persistence, tests, and future refactors.

## Library Session

The signed-in or anonymous lifetime of a learner's card library. A Library
Session owns which user may see cached cards, how anonymous cards are adopted
after sign-in, pagination state, realtime refresh, offline fallbacks, and queued
writes. Data from one signed-in user must never become visible to another user.

## Library Replica

The owner-scoped convergence of a learner's cloud cards, complete local mirror,
and queued offline mutations. A Library Replica preserves identity, epoch,
revision and tombstone ordering while keeping one owner's data isolated.
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

The development-only local store exposed through the Vite dev-server endpoints.
It is an offline and multi-browser adapter for development, not a production
source of truth.
