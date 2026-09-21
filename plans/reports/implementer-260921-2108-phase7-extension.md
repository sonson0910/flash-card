# Phase 7 extension lifecycle and timeouts

Status: DONE

## Changed files

- `extensions/lingoflash/app-bridge.js`
  - Sets the compatibility generation window to the exact `135_000ms` two-attempt AI budget: `65_000 * 2 + 500 + 4_500`.
  - Retries an unacknowledged deck-metadata clear up to three times at 250ms intervals, without adding persistent metadata.
- `extensions/lingoflash/background-core.js`
  - Sets a formula-checked `152_580ms` job deadline: 1,500 grace + 8,000 form lookup + 80 handoff + 3,000 readiness + 135,000 generation + 5,000 cleanup margin.
  - Ignores early alarms and results at/after the terminal deadline.
  - Serializes result/error terminal claims and reschedules early alarms at their absolute remaining deadline.
  - Fails `GET_DECKS` closed unless the current worker has same-origin active-scope proof from metadata sync.
- `extensions/lingoflash/tests/app-bridge.node.mjs`
  - Covers formula derivation and clear retry; preserved the existing dirty 135-second regression.
- `extensions/lingoflash/tests/background.node.mjs`
  - Covers full-path job formula, exact remaining alarm schedule, concurrent deadline result/alarm behavior, response at deadline, and failed-clear worker-restart popup reads.

## Validation

- `node --test extensions/lingoflash/tests/app-bridge.node.mjs extensions/lingoflash/tests/background.node.mjs extensions/lingoflash/tests/popup.node.mjs extensions/lingoflash/tests/shared.node.mjs` — PASS (105 tests).
- `npx vitest run src/features/browserExtension/useBrowserExtensionImport.test.tsx` — PASS (1 test).
- `npm run extension:check` — PASS.
- `npm run extension:build` — PASS; produced and validated the extension ZIP.
- `git diff --check` — PASS.

## Decisions and risk

- The alarm is treated as a wakeup, not proof of expiry; it is rescheduled if the persisted job is still within the computed deadline.
- Clear delivery retry is bounded and leaves existing `storage.session`/memory semantics intact.
- Session-cached deck names require an ephemeral same-origin scope confirmation; after a worker restart, popup reads remain empty until a signed-in app sync proves the active scope.
- Safari runtime packaging remains unexercised here because it requires macOS/Xcode.
