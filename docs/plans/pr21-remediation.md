# Plan: PR #21 remediation

## Dependency graph

```text
CI evidence → browser regression fixes ───────────────┐
                                                     ├─ full verification
Legacy XP protocol tests → stream documents → Rules ──┤
Legacy migration/evidence tests → protected workflow ─┘
Quota hotfix (already isolated) → separate release PR
```

## Ordered tasks

### Phase 1 — evidence and UI regressions

- [x] Read the exact failed CI job before editing.
- [x] Add five failing regression assertions and fix the smallest shared
      callers: 44px header controls, URL-driven advanced filters, Alt-only
      rating shortcuts, canonical search placeholder, and denied-storage sound
      preference fallback.
- [x] Run the focused suite on Chromium and WebKit; Firefox is blocked locally
      by the macOS Playwright launch/sandbox failure and must be confirmed on CI.

### Checkpoint A

- [x] Focused browser suite passes on Chromium and WebKit; Firefox assertion
      coverage remains a CI-only confirmation because the local browser cannot launch.
- [x] `npm run lint` and the affected Vitest tests pass.

### Phase 2 — XP stream v2

- [x] Write the required failing tests for 17/64-stream migration, stream 17,
      retired retries, pending convergence, exact metadata and watermark safety.
- [x] Add strict stream document normalization and migration helpers without a
      count-based slice.
- [x] Update the Firebase store transaction to materialize legacy maps, read
      per-stream watermarks, acknowledge stale/retired retries and retain gaps.
- [x] Update local rebase/load handling and add migration documentation.
- [x] Add Rules emulator coverage for stream documents and the legacy bridge.

### Checkpoint B

- [x] All gamification unit/store tests and Rules tests pass.
- [x] Functions and production builds pass.

### Phase 3 — protected migration workflow

- [x] Add `reservation-migration.yml` with `workflow_dispatch`, dry-run/apply/
      final-delta modes, immutable revision/provenance checks, no plaintext
      production artifact upload, and external-KMS encrypted rollback output.
- [x] Produce `rules-cutover-evidence.json` with the exact fields required by
      `scripts/rules-cutover-evidence.mjs`.
- [x] Add negative source/workflow tests for missing provenance, stale evidence,
      plaintext snapshots and wrong workflow paths.

### Checkpoint C

- [x] Workflow contract tests pass and the existing Rules cutover workflow
      accepts the artifact shape.
- [x] No production workflow was dispatched locally.

### Phase 4 — release review

- [x] Run `verify:core`, focused E2E, audits and `git diff --check`; the wrapper
      `npm run verify` needs Java 21 exported and cannot finish Firefox locally.
- [x] Review correctness, security, architecture and performance.
- [x] Keep quota hotfix as a separate branch/PR; do not merge PR #21 wholesale.
- [x] Report exact commits, tests and external blockers; stop before push,
      merge or deployment unless separately authorized.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Stream migration drops a watermark | Duplicate XP | Transactional materialization; never slice/evict; strict invalid-data fail-closed path |
| Rules expression budget regresses | Rules deploy rejected | Per-stream documents and emulator boundary tests |
| A retired retry is dropped | User XP stuck | Retain watermark forever and acknowledge `sequence <= watermark` |
| Protected workflow accepts wrong evidence | Unsafe cutover | Revision, SHA-256, KMS, freshness and provenance checks |
| PR remains too large | Review/rollback risk | Atomic commits and separate quota/UI/XP/workflow slices |
