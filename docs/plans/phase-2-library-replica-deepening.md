# Implementation Plan: Phase 2 Library Replica Deepening

Date: 2026-08-12

## Overview

Replace protocol orchestration inside `useLibraryDeviceSync` with an
owner-scoped Library Replica module. Work proceeds in contract-first vertical
slices; each checkpoint leaves the current application behavior intact.

## Architecture decisions

- Library Replica is scoped to one immutable owner ID and recreated on owner switch.
- Its external interface accepts mutation and synchronization intents, not raw
  Firestore, IndexedDB or pending-queue steps.
- Firestore, IndexedDB and Shared Device Store implementations remain adapters at
  internal seams; no schema or migration changes are allowed.
- React retains presentation state, browser subscriptions and anonymous fallback.
- Existing adapter tests remain; new contract tests exercise the deep module interface.

## Task list

### Slice 2.0 — Vocabulary, spec and contract skeleton

- [x] Define Library Replica in `CONTEXT.md`.
- [x] Record objective, boundaries and acceptance in the specification.
- [x] Add a failing contract test for the owner-scoped interface.

Acceptance: the intended interface is executable as a test and fails before the
module exists.

Verification: `npx vitest run src/features/librarySession/libraryReplica.test.ts`.

### Slice 2.1 — Local mutation staging

- [x] Move create, patch and delete staging behind one `stage` method.
- [x] Preserve normalization, epoch binding, 100-card mirror batches, queue-first
  delete semantics and pending-count refresh.
- [x] Replace hook orchestration with thin compatibility wrappers.

Files: Library Replica module/test and `useLibraryDeviceSync.ts`.

Verification: Library Replica contract and existing hook tests.

### Slice 2.2 — Pending reconciliation

- [x] Move lease, epoch binding, create reservation, patch/revision,
  delete/tombstone and safe local cleanup behind `flush`.
- [x] Preserve acknowledgement ordering, partial progress and error outcomes.
- [x] Keep owner-current publication checks at the module seam.

Files: the same three Phase 2 files; adapter implementation remains unchanged.

Verification: hook reconciliation tests plus repository/device contracts.

### Checkpoint A — Mutations

- [x] Contract, hook, repository uniqueness and device reconciliation tests pass.
- [x] Typecheck passes and no new write path exists.

### Slice 2.3 — Complete mirror refresh

- [x] Move epoch-stable streaming, pending overlay, publication validation and
  generation invalidation behind `refreshMirror`.
- [x] Preserve 100-card streaming, one-day freshness and single-flight behavior.

Files: the same module/test/hook files.

Verification: mirror contract and interrupted-generation tests.

### Slice 2.4 — Cleanup and acceptance

- [x] Remove orphaned protocol helpers/imports from the hook.
- [x] Review correctness, readability, architecture, security and performance.
- [x] Run core verification, production build and `git diff --check`.

### Checkpoint B — Phase complete

- [x] React caller no longer coordinates protocol internals.
- [x] All Phase 2 success criteria in `docs/specs/library-replica.md` pass.
- [x] Phase 0–1 changes and user-owned `docs/design/` remain intact.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Owner A result reaches owner B | Critical | Immutable owner scope plus current-owner callback gates and race tests |
| Acknowledgement precedes local reconciliation | High | Contract test ordering; acknowledge last |
| Refactor adds a second write path | High | Move existing implementation, do not duplicate it; remove hook imports per slice |
| Incomplete mirror becomes authoritative | High | Preserve generation completion/invalidation contract |
| Adapter interface becomes as complex as implementation | Medium | Keep adapters internal and expose intent-level methods only |

## Dependencies

Slice order is strictly sequential: 2.0 → 2.1 → 2.2 → Checkpoint A → 2.3 → 2.4.
No slice depends on a schema, migration, dependency or production change.
