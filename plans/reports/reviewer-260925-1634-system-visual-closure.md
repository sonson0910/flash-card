# System visual closure review

**Status:** DONE_WITH_CONCERNS

## Phạm vi

Đây là rà soát read-only sau recovery. Tôi đã đọc hai report trước, đọc các assertion liên quan trong `e2e/shell-share-workflow.spec.ts`, và mở 12 ảnh fresh trong `test-results/shell-share-resumed-final/`. Không khởi chạy browser, test, build, hay sửa source ứng dụng.

Các ảnh tham chiếu được đối chiếu là:

- `docs/design/sonflash-redesign/canvas/reference/AnimeSystem-light.png`
- `docs/design/sonflash-redesign/canvas/reference/AnimeSystem-dark.png`
- `docs/design/sonflash-redesign/canvas/reference/SystemStates-light.png`
- `docs/design/sonflash-redesign/canvas/reference/SystemStates-dark.png`

Ảnh fresh được dùng làm evidence chính:

- Offline Crystal desktop: `test-results/shell-share-resumed-final/shell-share-workflow-cryst-4b6b9-ocking-accessibility-issues-chromium/system-offline-crystal-light-en-1440.png`, `test-results/shell-share-resumed-final/shell-share-workflow-cryst-9930c-ocking-accessibility-issues-chromium/system-offline-crystal-dark-en-1440.png`
- Sync error Crystal mobile EN/VI, light/dark: `test-results/shell-share-resumed-final/shell-share-workflow-cryst-2cbed-ocking-accessibility-issues-chromium/system-sync-error-crystal-light-en-390.png`, `test-results/shell-share-resumed-final/shell-share-workflow-cryst-563e5-ocking-accessibility-issues-chromium/system-sync-error-crystal-dark-en-390.png`, `test-results/shell-share-resumed-final/shell-share-workflow-cryst-85b92-ocking-accessibility-issues-chromium/system-sync-error-crystal-light-vi-390.png`, `test-results/shell-share-resumed-final/shell-share-workflow-cryst-264ad-ocking-accessibility-issues-chromium/system-sync-error-crystal-dark-vi-390.png`
- Account final row at 390×560, Crystal EN/VI, light/dark: `test-results/shell-share-resumed-final/shell-share-workflow-cryst-2cbed-ocking-accessibility-issues-chromium/account-menu-final-row-crystal-light-en-390.png`, `test-results/shell-share-resumed-final/shell-share-workflow-cryst-563e5-ocking-accessibility-issues-chromium/account-menu-final-row-crystal-dark-en-390.png`, `test-results/shell-share-resumed-final/shell-share-workflow-cryst-85b92-ocking-accessibility-issues-chromium/account-menu-final-row-crystal-light-vi-390.png`, `test-results/shell-share-resumed-final/shell-share-workflow-cryst-264ad-ocking-accessibility-issues-chromium/account-menu-final-row-crystal-dark-vi-390.png`
- Fresh initial mobile account evidence: `test-results/shell-share-resumed-final/shell-share-workflow-class-74876-ocking-accessibility-issues-chromium/account-menu-classic-dark-en-390.png`, `test-results/shell-share-resumed-final/shell-share-workflow-cryst-264ad-ocking-accessibility-issues-chromium/account-menu-crystal-dark-vi-390.png`

## Findings disposition

### 1. Crystal desktop offline due cards overlapped Lumi — CLOSED visually

The light and dark 1440 captures show two compact cards with the Canvas proportions and a clear right-side Lumi placement. Lumi does not cover the second card or its lower-right content in either theme. This matches `AnimeSystem-light.png` / `AnimeSystem-dark.png` and the Canvas source rule `width: 132px; height: 138px; flex-shrink: 0` in `docs/design/sonflash-redesign/canvas/src/AnimeSystem.dc.html:63-64`. `SystemStates-light.png` / `SystemStates-dark.png` confirms the same offline composition and card/Lumi separation at the reference level.

The implementation evidence is also aligned: `src/components/workspace-sync-panel.css:584-587` sets Crystal cards to `height: 138px` and `flex: 0 0 132px`, while `:646-655` positions Lumi at the panel's right edge. The mobile exception is intentionally separate and is not part of this desktop finding.

### 2. Long sync error hid the queued count — CLOSED visually for EN/VI mobile

All four 390px Crystal sync captures show the full queued count row (`3 changes queued` / `Đang chờ 3 thay đổi`) below the bounded error detail and above the action buttons. The long red error text remains inside its detail region; the count is no longer clipped into that scroll area. This preserves the visible pending-write information present in the `AnimeSystem` and `SystemStates` sync references while allowing the mobile detail to scroll independently.

This matches the DOM boundary in `src/components/WorkspaceSyncPanel.tsx:136-143`: the detail scrollport closes before the separate `.workspace-sync-pending-count` paragraph. The corresponding sizing is visible in `src/components/workspace-sync-panel.css:89-104` and `:116-122`, with the Crystal detail max-height at `:494-515`.

### 3. Clear action was hidden behind mobile navigation — CLOSED visually at 390×560

Each final-row capture is a 390×560 PNG. The red Clear row is fully rendered, its bottom edge ends above the fixed bottom navigation, and the navigation does not cover the row in either Crystal theme or language. The result is consistent across the four EN/VI light/dark captures.

The source assertions cover the requested interaction boundary in `e2e/shell-share-workflow.spec.ts:368-402`: the menu must scroll to the final action, the action must stay inside the panel, `buttonBottom <= navTop`, and `elementFromPoint` at the button center must resolve inside the Clear button. Those assertions were read but not executed during this visual review, so the screenshots establish geometry while the parent-owned test run must establish the live hit target.

## Correction to the previous account report

The prior statement that the mobile menu lacked the profile/status in its initial view is false for the fresh captures. The classic dark EN initial screenshot visibly contains `Mina Tran`, `mina@example.test`, and the green `Synced` block before the action list. The Crystal dark VI capture likewise contains the profile and `Đã đồng bộ` status at the top. The initial mobile visibility and bounds are explicitly asserted at `e2e/shell-share-workflow.spec.ts:353-364`.

## Reduced motion evidence

The previous report's wording that the artifact matrix had no reduced-motion variant should be removed. `preparePage` defaults `reducedMotionEnabled` to `true`, emulates `reduced` media, and persists the reduced-motion setting at `e2e/shell-share-workflow.spec.ts:23-38`; each captured state calls `expectReducedMotion` (for example lines 295, 301, 309, 317, 332, and 365). The matrix therefore includes the intended reduced-motion path and its assertion coverage.

## Limitations

- This closure is visual/source inspection only. No browser, test, build, or pointer check was run by this reviewer.
- `test-results/shell-share-resumed-final/.last-run.json` currently reports `failed` with five failed test IDs. It is not evidence that the resumed suite has passed; root owns the final rerun and build gate.
- The report closes the three requested visual findings based on fresh renders and records the exact source assertions that cover interaction. It does not make a new broad audit claim.

Status: DONE_WITH_CONCERNS
Summary: Fresh renders close the Crystal offline-card/Lumi overlap, the long sync pending-count clipping, and the 390×560 Clear-row occlusion. Fresh initial account captures also disprove the prior “mobile profile missing” claim; reduced-motion coverage is present in the matrix. Final test status remains parent-owned and unresolved here.

## Final browser gate evidence addendum

**Status:** DONE

The previously unresolved parent gate is now closed by the exact final log:

- `plans/260925-1005-claude-design-workflow-recovery/evidence/phase-02-03-resumed-final-browser.log`
- The log runs 33 tests and ends with `33 passed (3.0m)`; the parent reports exit 0.
- `test-results/shell-share-accepted/.last-run.json` records `{ "status": "passed", "failedTests": [] }`.

The accepted capture set contains the relevant evidence used by this report. Representative files are present with the expected dimensions: Crystal offline desktop light/dark at 1440×900, Crystal sync mobile at 390×844, Crystal final-row mobile at 390×560, and the classic dark EN initial account capture at 390×844. The corresponding accepted images are under `test-results/shell-share-accepted/`, while the full visual artifact set is under `artifacts/recovery-shell-share-20260925-1653/`. Representative accepted and recovery captures have matching SHA-256 values, so the accepted gate uses the reviewed renders for those states.

The passing matrix includes the relevant Crystal and Classic EN/VI desktop/mobile cases, and the source assertions at `e2e/shell-share-workflow.spec.ts:353-364` and `:368-402` cover initial profile visibility, 390×560 final-row reachability, bottom-nav separation, and the Clear-button center hit test. No new browser or test run was performed by this reviewer.

The earlier `test-results/shell-share-resumed-final/.last-run.json` failure remains documented above as historical recovery evidence. It is superseded for final-gate status by the accepted 33/33 run, not erased.

**Summary:** The parent-owned browser gate concern is closed: 33/33 passed with exit 0 and the accepted artifact set is passed. The three visual findings and the mobile profile correction remain closed as recorded above.

**Concerns:** None for this visual closure. The historical failed resumed run is retained for provenance only.
