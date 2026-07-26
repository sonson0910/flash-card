# Implementation Plan: Smart Flashcards

## Architecture Decisions

- Wrap `ts-fsrs` behind a small adapter so Firestore data and UI do not depend on package-specific objects.
- Store review history as a bounded array on the card for immediate compatibility; retain the most recent 100 reviews.
- Keep enrichment fields optional and normalize legacy cards at the repository boundary.
- Keep the existing visual card while extracting domain logic and small UI pieces incrementally.

## Phase 1: Scheduling Foundation

- [x] Add failing tests for four review ratings, due dates, and immutable review logs.
- [x] Add `ts-fsrs` and implement the scheduler adapter.
- [x] Connect review controls and persist scheduling fields.

Checkpoint: tests, type check, and build pass; legacy cards remain readable.

## Phase 2: Active Recall and Content

- [x] Add recall-mode prompt logic with unit tests.
- [x] Add a study-mode selector and render prompts without leaking the answer.
- [x] Expand Gemini schema and card normalization for optional learning context.

Checkpoint: all four recall modes can be completed without changing library pagination.

## Phase 3: Speech and Accessibility

- [x] Add failing tests for normalized edit-distance speech matching.
- [x] Replace the fixed 100/80/40 score and relabel the result.
- [x] Add keyboard flip behavior, accessible state, and focus-visible styling.

Checkpoint: pointer, Enter, and Space all flip a card; child buttons remain independent.

## Phase 4: Component Boundaries and Review

- [x] Extract reusable image and speech-result components from `Flashcard.tsx`.
- [x] Run correctness, architecture, security, performance, and dependency review.
- [x] Verify the signed-in paginated library in the browser.

Checkpoint: tests, lint, build, audit, and browser checks pass.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Legacy scheduling fields do not match FSRS | High | Convert valid legacy progress to FSRS-compatible state while preserving repetitions, interval, and due date |
| Review logs grow indefinitely | Medium | Retain the newest 100 records on the card |
| Recall mode leaks the answer | High | Centralize prompt construction and unit-test every mode |
| Speech recognition differs by browser | Medium | Treat missing confidence conservatively and keep speech optional |
| Refactor breaks card visuals | Medium | Extract only self-contained sections and verify in the live browser |
