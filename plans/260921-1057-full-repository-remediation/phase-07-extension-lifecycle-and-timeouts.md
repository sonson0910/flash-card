---
title: "Phase 7: Extension lifecycle and timeouts"
status: complete
---

# Phase 7: Extension lifecycle and timeouts

## Overview

Align the compatibility bridge and background-job lifetime with the backend AI retry budget, and close the stale-metadata finding with a delivery-failure regression rather than a redundant cache design.

## Requirements

- [x] Compatibility fallback remains alive for at least the documented two-attempt backend budget plus handoff margin.
- [x] Background job expiry/alarm cannot terminate a still-valid bridge request earlier.
- [x] Late completion after terminal timeout cannot import twice or resurrect a claimed job.
- [x] Owner-scoped deck metadata is cleared/replaced safely across sign-out, crash/restart, and account change, or the remaining failure is fixed minimally.

## File inventory

| Concern | Paths |
|---|---|
| Bridge/job lifetime | `extensions/lingoflash/app-bridge.js`, `extensions/lingoflash/background-core.js` |
| Metadata protocol | `extensions/lingoflash/shared.js`, `src/features/browserExtension/useBrowserExtensionImport.ts` |
| Tests | `extensions/lingoflash/tests/app-bridge.node.mjs`, `extensions/lingoflash/tests/background.node.mjs`, `extensions/lingoflash/tests/popup.node.mjs`, `extensions/lingoflash/tests/shared.node.mjs`, `src/features/browserExtension/useBrowserExtensionImport.test.tsx` |
| Packaging/docs | `scripts/check-browser-extension.mjs`, `extensions/lingoflash/README.md` |

## Implementation steps

1. Derive, do not guess, the timeout formula. The generation window covers two `65_000ms` client attempts + `500ms` retry delay + explicit response/render margin (the existing dirty contract uses `135_000ms`). The background lifetime additionally covers `1_500ms` grace, up to `8_000ms` form lookup, `80ms` handoff, up to `3_000ms` button readiness, and a final cleanup margin; it must therefore exceed the whole bridge path, not merely 135 seconds.
2. Centralize or cross-check bridge and background constants against that formula. Test exact lower/upper boundaries, cleanup, response-at-deadline, late response, and retry behavior so a future AI-budget change breaks the contract test.
3. Re-run the existing owner-scope, retired-scope, session/in-memory storage, sign-out, popup, and origin tests before modifying metadata code.
4. Add a delivery-failure case: clear message fails or the worker restarts, then signed-out/new-owner popup asks for decks. The previous owner's names must not be returned.
5. If the new test passes under current scope retirement, mark the audit concern verified and make no metadata implementation change. If it fails, add the smallest ACK/retry or expiry proof at the existing protocol boundary; do not add persistent local metadata.
6. Update the extension README only if the externally observable timeout or cleanup contract changes.

## Scenario matrix

| Scenario | Expected |
|---|---|
| First AI attempt times out, second completes before bridge deadline | Success relayed once |
| Backend completes after terminal bridge timeout | Late message ignored; no duplicate import |
| Worker alarm fires near boundary | Valid job survives through bridge budget |
| Every pre-submit wait reaches its bound and second AI attempt succeeds | Background job remains alive through the computed full-path deadline |
| Sign-out clear succeeds | Old scope retired and metadata unavailable |
| Sign-out clear delivery fails / worker restarts | Old owner deck names remain unavailable to next owner/popup |
| Browser lacks `storage.session` | Metadata stays in memory and disappears with worker |

## Validation

- `node --test extensions/lingoflash/tests/app-bridge.node.mjs extensions/lingoflash/tests/background.node.mjs extensions/lingoflash/tests/popup.node.mjs extensions/lingoflash/tests/shared.node.mjs`.
- `npx vitest run src/features/browserExtension/useBrowserExtensionImport.test.tsx`.
- `npm run extension:check` and inspect the produced package; Safari runtime remains a reported platform gap unless run on macOS/Xcode.

## Success criteria

- [x] Timeout tests match the documented backend retry budget and no valid job expires early.
- [x] Terminal/late-response behavior is exactly once.
- [x] Metadata concern is closed by a behavior test; code changes only if that test initially fails.
- [x] All extension Node suites and package checks pass.

## Completion evidence

- The bridge deadline is derived from the two-attempt Gemini budget, and the background deadline covers all bounded pre-submit waits plus cleanup.
- Result and timeout publication share one terminal-claim lock; early alarms reschedule against the absolute remaining lifetime.
- Deck metadata is fail-closed after worker restart until the active same-origin scope is proved again; no persistent local metadata cache was added.
- The extension Node suites passed 105 tests, the hook Vitest passed, and both `extension:check` and `extension:build` passed. Safari runtime execution remains a documented macOS/Xcode platform gap.

## Risks and rollback

- Longer deadlines retain a worker tab/job longer. Keep bounded alarms and cleanup; do not make lifetime unbounded.
- Timeout constant changes roll back independently. Never roll back verified owner-scope/retirement protections.
