# Baseline verification

Captured 2026-09-25 against revision `8d1ec44e3af7e08e45b90454c887055a902ef7d2`. The source snapshot hash was `cd2c28c3440b97d3bb342c3140939b522a8f3dc77b53ecc982dd5275a5a41264` across 1,632 tracked and non-ignored worktree files, excluding `plans/` and local tooling metadata. The start, pre-build, and end snapshots match.

## Results

| Check | Result |
|---|---|
| `npm run verify:core` | **FAIL**, exit 1. Root TypeScript lint passed. Vitest: 2 failed files / 224 passed; 7 failed tests / 1,950 passed (226 files, 1,957 tests). The fail-fast script did not reach Functions or rules checks. |
| `npm run build` | **PASS**, exit 0. Vite warned that `reviewScheduler.ts` is imported dynamically and statically, so the dynamic import will not split it into another chunk. |
| `npm run verify:bundle` | **PASS**, exit 0. 100 JS chunks; initial JS 220,300 B raw / 70,086 B gzip, initial CSS 193,970 B raw / 28,741 B gzip, total JS 2,522,705 B raw / 793,656 B gzip. |
| Canvas `build.py --check` | **PASS**, exit 0; compiled 112 components. The script writes generated `project/*.dc.html` files even with `--check`, so it ran from an isolated copy of the unchanged Canvas source. |
| `npm --prefix functions run lint` | **PASS**, exit 0. |
| `npm --prefix functions test` | **FAIL**, exit 1. 1 failed / 273 passed / 38 skipped across 35 files. |
| `npm --prefix functions run build` | **PASS**, exit 0. |
| `npm run test:rules` | **FAIL**, exit 1. Firestore rules suites passed 65/65. Emulator-backed Functions tests passed 37/38; one test timed out at its existing 5,000 ms limit. |
| Targeted retry of `sharedDeckPersistenceFirestore.integration.test.ts` | **PASS**, exit 0. Both tests passed; the concurrent identical-operation case completed in 3,225 ms. The timeout did not recur in this single retry. |

## Failures

- `src/features/sharing/sharedDeckSessionController.test.ts`: 2 failures. Incoming previews produced `{ targetLanguage: null, translationLanguage: null }` where the tests expected the unique known language pairs, and produced a null target where a Korean sample card implied `ko`.
- `src/i18n/stringScanner.test.ts`: 5 migrated-file checks failed: `DesktopNavigation.tsx` (`S`, `Lv`), `LandingPage.tsx` (23 visible/sample strings), `LibraryCardGrid.tsx` (`aria-label: Library pages`), `LibraryOverview.tsx` (`LUMI · LINK`), and `LibraryScreen.tsx` (`aria-label: Decks`).
- `functions/test/inputValidation.test.ts:132`: expected `parseCreateSharedDeckRequest` to reject `targetLanguage: 'english'` with `nativeLanguage: 'vi'`; it did not throw.
- `functions/test/sharedDeckPersistenceFirestore.integration.test.ts:67`: `commits one share for concurrent identical operations` timed out at 5,000 ms in the full emulator integration group. The targeted rerun passed once; this does not erase the first failure.

The root controller separately reported `npm run i18n:check` **PASS**, exit 0, in `plans/260925-1005-claude-design-workflow-recovery/evidence/baseline-i18n.log`. It was not run as part of this assignment.

## Evidence

- [Source snapshot at start](../260925-1005-claude-design-workflow-recovery/evidence/baseline-sourcehash-start.txt)
- [Source snapshot before build](../260925-1005-claude-design-workflow-recovery/evidence/baseline-sourcehash-pre-build.txt)
- [Source snapshot at end](../260925-1005-claude-design-workflow-recovery/evidence/baseline-sourcehash-end.txt)
- [Core gate](../260925-1005-claude-design-workflow-recovery/evidence/baseline-verify-core.log)
- [Build](../260925-1005-claude-design-workflow-recovery/evidence/baseline-build.log)
- [Bundle gate](../260925-1005-claude-design-workflow-recovery/evidence/baseline-verify-bundle.log)
- [Canvas check](../260925-1005-claude-design-workflow-recovery/evidence/baseline-canvas-check.log)
- [Functions lint](../260925-1005-claude-design-workflow-recovery/evidence/baseline-functions-lint.log), [tests](../260925-1005-claude-design-workflow-recovery/evidence/baseline-functions-test.log), and [build](../260925-1005-claude-design-workflow-recovery/evidence/baseline-functions-build.log)
- [Rules and emulator integration run](../260925-1005-claude-design-workflow-recovery/evidence/baseline-test-rules.log), [targeted retry](../260925-1005-claude-design-workflow-recovery/evidence/baseline-shareddeck-integration-retry.log), [port preflight](../260925-1005-claude-design-workflow-recovery/evidence/baseline-emulator-preflight.log), and [postflight](../260925-1005-claude-design-workflow-recovery/evidence/baseline-emulator-postflight.log)

Emulator ports were free before and after both runs. Firebase shut the emulators down after each command. No source fixes were made.
