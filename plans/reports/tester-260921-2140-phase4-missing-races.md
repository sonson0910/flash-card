# Test Report — 2026-09-21 — Phase 4 missing races

## Outcome

Closed the remaining deterministic Phase 4 race gaps and migrated the intake acknowledgement port contract to carry the scoped lease already used by settlement. Also corrected the Phase 4 lease mocks so tests cover the scoped coordinator without calling the real development endpoint.

## Coverage added

- `src/lib/pendingOperationStore.test.ts` now exercises the real IndexedDB v5-to-v6 `VersionError` fallback, forces its open attempt to remain unsettled until the bounded timeout fires, and proves a late successful connection is closed without replacing the newer cached connection.
- `devEndpointSecurity.test.ts` now drives one persistent route/plugin instance through lease A expiry and lease B acquisition. Stale A PUT, cleanup, acknowledgement, and release requests are rejected/no-op; the backup cards and pending queue remain unchanged; B can renew, mutate, clean up, acknowledge, and release.
- `src/features/library/useCustomDeckWorkspace.test.tsx` now types the lease mock as the production discriminated union, preserving the `{ acquired: false }` contention case.
- `src/features/intake/useCardIntakePort.test.ts` now runs settlement inside a mocked scoped coordinator and proves the same opaque lease reaches strict device merge, guarded cleanup, and acknowledgement.
- `src/features/intake/cardIntakePortContract.ts` now exposes the optional opaque lease on its acknowledgement contract; the pipeline reuses that named type.

## Test results

- Focused pending/dev: 31 passed, 0 failed, 0 skipped.
- Full Phase 4 inventory: 179 passed, 0 failed, 0 skipped across 9 files.
- Intake/custom regression: 48 passed, 0 failed, 0 skipped across 4 files.
- `npm run lint` (`tsc --noEmit`): passed.
- `git diff --check`: passed.

Coverage percentages were not generated; this task targeted two explicit concurrency gaps rather than a repository coverage threshold.

## Production impact

The only production change from this test pass is the intake port's lease-aware acknowledgement type. Runtime behavior was already passing the active lease through settlement. Existing timeout, late-close, critical-section lease validation, and successor-token behavior passed the new discriminating tests without implementation changes.

## Unresolved questions

None.
