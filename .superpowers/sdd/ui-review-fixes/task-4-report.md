# Task 4 report: Stabilize Undo toast expiry

## Status

Complete. `AppRuntime` now passes a stable `dismissUndoToast` callback, so parent rerenders do not restart the `UndoToast` expiry effect.

## TDD evidence

1. RED: `npx vitest run src/components/ui/UndoToast.test.tsx` failed because `AppRuntime` still passed an inline `onDismiss` callback.
2. GREEN: wrapped `setUndoToast(null)` in `useCallback([])` and passed the stable callback to `UndoToast`.
3. GREEN: focused regression test passed.

## Verification

- `npx vitest run src/components/ui/UndoToast.test.tsx src/features/overlays/useOverlayState.test.ts` — 7 passed.
- `npm run build` — passed; existing `reviewScheduler.ts` dynamic-import chunking warning.
- `npm run lint` — blocked by pre-existing missing `firebase-admin`, `firebase-functions`, and `@google/genai` modules under `functions/`.
- `git diff --check` — passed.

## Decisions and remaining risk

- Kept `UndoToast` API, timer behavior, manual Undo/Dismiss behavior, and progress animation unchanged.
- The focused test is a source contract because this repository has no DOM component-test harness configured; it verifies the caller's stable callback and prop wiring.
- No other callers set or render the Undo toast; `useOverlayState` remains unchanged.

## Follow-up: toast identity-safe expiry

The expiry effect now depends on `toast?.id` instead of the whole toast object, while retaining `duration` and `onDismiss`. A minimal `scheduleUndoToastDismissal` helper keeps timer setup/cleanup testable without changing the component props or manual controls.

### Follow-up TDD evidence

1. RED: focused test failed for same-id/duration rerender, missing helper, and the expected dependency behavior.
2. GREEN: keyed the effect by toast id and routed timer setup through the helper.
3. GREEN: same-id/duration, changed-id/duration, expiry-once, and cleanup tests pass.

### Follow-up verification

- `npx vitest run src/components/ui/UndoToast.test.tsx src/features/overlays/useOverlayState.test.ts` — 11 passed.
- `npm run build` — passed; existing `reviewScheduler.ts` dynamic-import chunking warning.
- `npm run lint` — still blocked by pre-existing missing Firebase/GenAI modules under `functions/`.
- `git diff --check` — passed.

## Re-review follow-up: progress animation alignment

The progress element key now includes both toast id and duration (`${toast.id}:${duration}`), so a duration change remounts the animation in sync with the newly scheduled timer while same id/duration remains stable.

### Re-review TDD evidence

1. RED: progress-key regression expected `toast-1:1000` but received the old id-only key `toast-1`.
2. GREEN: updated the progress element key to include duration; focused test passed.

### Re-review verification

- `npx vitest run src/components/ui/UndoToast.test.tsx src/features/overlays/useOverlayState.test.ts` — 12 passed.
- `npm run build` — passed; existing `reviewScheduler.ts` dynamic-import chunking warning.
- `npm run lint` — still blocked by pre-existing missing Firebase/GenAI modules under `functions/`.
- `git diff --check` — passed.
