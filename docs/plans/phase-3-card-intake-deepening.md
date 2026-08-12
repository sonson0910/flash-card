# Implementation Plan: Phase 3 Card Intake Deepening

Date: 2026-08-12

## Overview

Move production Card Intake orchestration out of `useCardIntakePort` into a
session-safe pipeline. Work proceeds contract-first in small slices while the
existing controller, public port contract and user-visible behavior remain
stable.

## Architecture decisions

- Card Intake Pipeline owns session generation, owner/epoch-scoped lookup,
  generation/media assembly, optimistic publication and cloud reconciliation.
- `useCardIntakePort` owns only the latest React context ref and pipeline lifetime.
- `cardIntakeController` continues to own draft, busy, spreadsheet and shared-deck
  workflow states; it does not gain persistence knowledge.
- One pipeline instance survives renders and uses a monotonic session generation
  so an old A operation cannot revive after A→B→A.
- Firestore, mirror and device-store implementations remain internal adapters;
  no schema, migration, Rules or dependency changes are allowed.

## Task list

### Slice 3.0 — Contract skeleton

- [x] Add a failing contract for a stable Card Intake Pipeline interface.
- [x] Cover monotonic owner replacement and stable public method identities.

Verification: `npx vitest run src/features/intake/cardIntakePipeline.test.ts`.

### Slice 3.1 — Lookup and generation

- [x] Move session guard, local/cache/mirror/cloud exact lookup and generated-card
  assembly into the pipeline.
- [x] Preserve verified-epoch filtering, retryable cloud fallback, protected
  generation errors and brief initial-media wait.

Verification: pipeline contracts plus existing lookup/session tests.

### Slice 3.2 — Optimistic publication

- [x] Move create queueing, optimistic list publication, XP/stats/facet updates
  and queued feedback into the pipeline.
- [x] Preserve local-first publication and the concurrency-6 cloud settlement
  checkpoint.

Verification: pipeline and controller/import tests.

### Slice 3.3 — Authoritative settlement

- [x] Move strict device merge, conditional mirror update/cleanup,
  acknowledgement-last, duplicate compensation and touch-existing convergence.
- [x] Preserve durable settlement for stale sessions while suppressing their UI
  side effects.

Verification: duplicate, revision, epoch and owner-race contracts.

### Checkpoint A — Deep pipeline

- [x] Pipeline, port, controller, import and sharing tests pass.
- [x] Typecheck passes and no second intake write path exists.

### Slice 3.4 — React adapter cleanup

- [x] Reduce `useCardIntakePort` to stable ref/lifecycle composition.
- [x] Move source-policy assertions to the owning pipeline or replace them with
  behavior contracts where practical.
- [x] Remove orphaned imports/helpers from the hook.

### Slice 3.5 — Acceptance

- [x] Review correctness, readability, architecture, security and performance.
- [x] Run core verification, production build and `git diff --check`.

### Checkpoint B — Phase complete

- [x] React no longer coordinates intake persistence protocol.
- [x] All success criteria in `docs/specs/card-intake-pipeline.md` pass.
- [x] Phase 0–2 changes and user-owned `docs/design/` remain intact.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Old A work publishes after A→B→A | Critical | Monotonic session generation contract |
| Pending create acknowledged before cleanup | Critical | Durable reconciliation ordering test |
| Optimistic duplicate keeps XP/stats | High | Idempotent compensation key contract |
| Refactor creates a second write path | High | Move implementation, then delete hook orchestration |
| Media delays durable creation | Medium | Retain best-effort deferred media seam |
| Large relocation becomes unreviewable | Medium | Lookup, optimistic and settlement checkpoints |

## Dependencies

Slices are sequential: 3.0 → 3.1 → 3.2 → 3.3 → Checkpoint A → 3.4 → 3.5.
No slice depends on a schema, migration, dependency or production change.
