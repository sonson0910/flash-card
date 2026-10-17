# Shell and system-state acceptance

Status: complete for local phase 03; no deployment.

## Scope and revision

Base `6098ada`; accepted source tree `dd8ddbf5abdc6acca4a6a2fa1e5dbbff5023a4e9` contains 121 source/test/catalog paths. This isolates the shell, navigation, appearance, recovery, feedback, first-use Library and caught-up Today from the pending Library and daily-session redesign. The source checkout used for the checks was subsequently moved, with its contents intact, from `plans/verification-workspaces/share` to `.worktrees/verification-phase03` so root test discovery does not include a second checkout.

Desktop/mobile navigation uses the four Canvas themes, real account metrics, accessible menus and safe-area spacing. Appearance applies and persists theme, system-following, Lumi, reduced motion and study-sound preferences. Loading, errors, offline/sync, expired-session recovery and feedback have real actions. Delete Undo preserves the card and its learning state; successful Clear invalidates Undo. Restore updates category facets atomically and replays without duplicate increments. Mutation publication checks owner and capability around asynchronous work; epoch verification remains possible during recovery.

## Verification

All logs below are under `plans/260925-1005-claude-design-workflow-recovery/evidence/`.

| Check | Evidence and result |
|---|---|
| Focused repair | `phase-03-isolated-focused-retry.log`: 2 files / 40 tests PASS. |
| i18n | `phase-03-isolated-i18n-retry.log`: stable extraction, strict compilation and complete EN/VI coverage in 11 catalogs. |
| Core | `phase-03-isolated-core-retry.log`: 230 web files / 2,057 tests; 27 Functions files / 287 tests; 65 Rules tests; 39 emulator integration tests PASS. The initially skipped integration tests ran with the emulator later in the same gate. Emulator shutdown completed. |
| Build and bundle | `phase-03-settings-final-build.log` and `phase-03-settings-final-bundle.log`: PASS, 102 JS chunks. Initial JS 70,930/71,000 B gzip; CSS 29,496/29,500 B gzip. |
| Exact isolated app browser | `phase-03-isolated-browser.log`: 37 passed / 4 failed; `phase-03-isolated-browser-retry.log`: those 4 passed, exit 0. Together these cover all 41 cases. The original failed run remains recorded. |
| Shell/system/share fixture | `phase-02-03-resumed-final-browser.log`: 33/33 PASS. Twenty theme/locale/viewport combinations plus thirteen behavior journeys, using actual shell components and session controllers with test adapters. No cloud/Gemini calls. |

The browser checks cover Delete → Undo → reload, Clear invalidation, initial runtime failure/retry, cloud-free landing, live/persisted theme settings, legal shell entry points, mobile/pseudo-locale sizing, keyboard menus, focus return, and destination focus with reduced or interrupted motion. The two extra motion tests verify the OS preference and absence of running animations; `data-motion=system` correctly distinguishes following the OS from a manually saved reduction preference.

Final appearance-only CSS correction additionally passed all 22 Settings cases (`phase-03-settings-final-browser.log`), then all 16 theme/locale/viewport cases with lower-control focus, pointer hit testing, 44px label rows and actual switch geometry (`phase-03-settings-controls-browser.log`). Core source was unchanged by this CSS-only repair.

## Visual evidence and boundaries

[Visual coverage CSV](../260925-1005-claude-design-workflow-recovery/evidence/phase-03-shell-system-visual-coverage.csv) now maps 292 images. [Mapping review](reviewer-260925-1705-shell-evidence-mapping.md) identifies the specific Canvas regions and later owners.

Preserved exact-app captures: `artifacts/recovery-shell-isolated-20260925-1710/` contains 8 shell and 16 EN/VI settings images at 1440×900 and 390×844. Its 16 Settings images predate the final Classic toggle correction; 32 replacement Settings/controls images are preserved in `artifacts/recovery-settings-20260925-1720/` and used by the CSV. Root opened fresh representatives of all four themes and the corrected desktop/mobile controls. System/account/feedback images, including 360px pseudo-locale and the 390×560 account-menu reachability check, are in `artifacts/recovery-shell-share-20260925-1653/`.

[System closure review](reviewer-260925-1634-system-visual-closure.md) closes the offline-card/Lumi overlap, clipped queued count and bottom-nav overlap of Clear against fresh renders and the passing hit-target assertions. [Account/appearance review](reviewer-260925-1553-account-appearance.md) records the earlier render and its findings; the closure report corrects its mobile-profile claim and resolves the final-row failures. [Motion scope review](reviewer-260925-1525-shell-motion-coverage.md) preserves the remaining card/session workflows; the new runtime motion/focus tests close its shell-specific evidence gap.

Explicit source/data/accessibility boundaries:

- Header controls retain targets of at least 44px; source specimens use some smaller targets. Runtime metrics replace Canvas specimen values; the course slot waits for actual course data.
- Paths and Progress keep their real destinations. Goals/course switching and Friends remain required work in phases 10 and 15; relabeling an existing destination would not implement those flows.
- AnimeMobile, AnimeMotion and MotionStoryboard retain later card, edit-sheet, review, recap, onboarding and commercial states under their owning phases. This acceptance closes their shell and common motion foundation only.
- Empty Library uses its real generation/import/path actions. Caught-up Today does not invent a global next-review date from a bounded pool; the new-card session action is explicitly pending phase 05.
- Appearance preferences are local device preferences. Cloud account preferences, actual sound/haptic events and notifications retain their phase 10/11 contracts.

Classic Appearance switches initially retained browser checkbox styling. They now use the 42×24 rounded track and 18px circular thumb from `ReminderSettings`, with the existing full-row label as the touch target. Keyboard focus remains visible, and the lower mobile controls were proved reachable above navigation. This uses the source control geometry without claiming completion of the reminder workflow.

## Repairs and remaining risk

The first isolated core run exposed two stale assertions looking for inline color tokens after CSS extraction and a legacy Review button displayed for a zero-card Library. Assertions now check the actual scoped theme treatment; the zero-card Review button is omitted while Create remains available. Focused and full core checks passed afterward.

The first bundle exceeded CSS gzip by 189 B. Chart/achievement styles now load with the application shell; declarations and reduced-motion behavior are preserved. No budget was raised. CSS has only 4 B of headroom on this artifact, so later work must continue to keep feature CSS outside the initial asset graph.

Two Undo browser tests had selected the phase-04 article tile in the phase-03 export, whose actual card is an accessible group. Their isolated selectors were corrected without removing the persistence/reload assertions. Two new motion tests initially confused the OS preference with the manual setting; the corrected tests retain destination/focus/animation assertions. All four then passed.

This is local verification. Live authentication/App Check, G1, deployment and cloud rollout are not asserted by these checks.
