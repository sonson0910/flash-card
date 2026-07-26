# Implementation Plan: Firestore Cursor Pagination

## Architecture Decisions

- A card repository is the seam for page, count, practice, export, and bulk operations.
- Cloud library state contains one page; local-only mode retains its existing in-browser behavior.
- Queries order by normalized `createdAt` and document ID, use cursors, and fetch page size plus one.
- One-shot cursor reads are used for every library page; successful mutations explicitly refresh page and aggregate state.

## Task List

### Phase 1: Foundation

- [x] Add pure page/query state with failing unit tests.
- [x] Add Firestore card repository with cursor pages and aggregate counts.
- [x] Add required Firestore indexes and validation-compatible normalized fields.

### Checkpoint: Foundation

- [x] Unit tests pass.
- [x] Type-check and production build pass.

### Phase 2: Library

- [x] Replace whole-collection listener with bounded cloud-page loading.
- [x] Connect Previous/Next pagination and server-side filters.
- [x] Cache at most one bounded authenticated page for offline/quota fallback; never mirror the full cloud library.
- [x] Keep mutations consistent with current page and cursor invalidation.

### Checkpoint: Library

- [x] Initial query is bounded to 10 documents.
- [x] Browser navigation and filters work without application errors.

### Phase 3: Dependent Workflows

- [x] Load bounded practice pools for study, quiz, spelling, and story.
- [x] Page export and clear-all operations on demand.
- [x] Make duplicate detection query Firestore rather than only the visible page.
- [x] Add low-power rendering and image behavior.

### Checkpoint: Complete

- [x] Tests, lint, build, and audit pass.
- [x] End-to-end browser verification passes.

## Risks and Mitigations

- Legacy cards missing order fields: use a documented migration/fallback path before enforcing normalized ordering.
- Cursor invalidation after creates or ordering updates: reset to page one and rebuild cursor history.
- Composite index growth: support a deliberate filter matrix and commit index definitions.
- Full-text search is unsupported by Firestore: limit built-in search to normalized word prefix.
