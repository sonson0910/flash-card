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
- [ ] Add five failing regression assertions and fix the smallest shared
      callers: 44px header controls, URL-driven advanced filters, Alt-only
      rating shortcuts, canonical search placeholder, and denied-storage sound
      preference fallback.
- [ ] Run the focused suite on Chromium, Firefox and WebKit; commit this slice
      separately.

### Checkpoint A

- [ ] Focused browser suite passes in all three engines.
- [ ] `npm run lint` and the affected Vitest tests pass.

### Phase 2 — XP stream v3

- [ ] Write the four required failing tests.
- [ ] Add strict stream document normalization and migration helpers without a
      count-based slice.
- [ ] Update the Firebase store transaction to materialize legacy maps, read
      per-stream watermarks, acknowledge stale/retired retries and retain gaps.
- [ ] Update local rebase/serialization and add migration documentation.
- [ ] Add Rules emulator coverage for stream documents and the legacy bridge.

### Checkpoint B

- [ ] All gamification unit/store tests and Rules tests pass.
- [ ] Functions and production builds pass.

### Phase 3 — protected migration workflow

- [ ] Add `reservation-migration.yml` with `workflow_dispatch`, dry-run/apply/
      final-delta modes, immutable revision/provenance checks, no plaintext
      production artifact upload, and external-KMS encrypted rollback output.
- [ ] Produce `rules-cutover-evidence.json` with the exact fields required by
      `scripts/rules-cutover-evidence.mjs`.
- [ ] Add negative source/workflow tests for missing provenance, stale evidence,
      plaintext snapshots and wrong workflow paths.

### Checkpoint C

- [ ] Workflow contract tests pass and the existing Rules cutover workflow
      accepts the artifact shape.
- [ ] No production workflow is dispatched locally.

### Phase 4 — release review

- [ ] Run complete `npm run verify`, audits and `git diff --check`.
- [ ] Review correctness, security, architecture and performance.
- [ ] Keep quota hotfix as a separate branch/PR; do not merge PR #21 wholesale.
- [ ] Report exact commits, tests and external blockers; stop before push,
      merge or deployment unless separately authorized.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Stream migration drops a watermark | Duplicate XP | Transactional materialization; never slice/evict; strict invalid-data fail-closed path |
| Rules expression budget regresses | Rules deploy rejected | Per-stream documents and emulator boundary tests |
| A retired retry is dropped | User XP stuck | Retain watermark forever and acknowledge `sequence <= watermark` |
| Protected workflow accepts wrong evidence | Unsafe cutover | Revision, SHA-256, KMS, freshness and provenance checks |
| PR remains too large | Review/rollback risk | Atomic commits and separate quota/UI/XP/workflow slices |
