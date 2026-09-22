# Overlay focus scheduling lifecycle

## Changed files

- `src/components/AppOverlays.tsx`
- `src/features/overlays/useOverlayState.test.ts`

## Decision

`AppOverlays` now owns the cleanup returned by the existing
`scheduleOverlayFocusRestore` helper. It cancels a previous restore before
scheduling another one, whenever any overlay reopens, and on unmount. The
component does not create another timeout/RAF scheduler.

## Validation

- `npx vitest run src/features/overlays/useOverlayState.test.ts src/components/AppOverlays.test.tsx` — passed (2 files, 11 tests).
- `git diff --check` — passed.
- `npm run lint` — blocked by unrelated existing errors in
  `src/features/learning/useLearningStatePersistence.ts:279` and `:315`.

## Remaining risk

The targeted lifecycle tests exercise the helper with deterministic fake
timeout/RAF handles; the application component uses that same helper and owns
its cleanup. The repository-wide type check remains red outside this capsule.

Status: DONE_WITH_CONCERNS
Summary: Reused the shared focus scheduler and added rapid-reopen and unmount cancellation coverage.
Concerns/Blockers: Root lint is currently blocked by unrelated learning-persistence type errors.
