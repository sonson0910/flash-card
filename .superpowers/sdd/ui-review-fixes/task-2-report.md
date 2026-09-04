## Task 2: Include all menu items in keyboard navigation

### TDD evidence

1. RED: after extending the accessibility E2E assertion, `npx playwright test e2e/accessibility.spec.ts --project=chromium --grep '320px reflow' --reporter=line` failed because ArrowDown from the trigger focused Export instead of Sound.
2. GREEN: `LibraryManagementMenu` now discovers enabled `[role="menuitem"]` buttons from `rootRef` in DOM order; per-item Export/Clear refs were removed.
3. GREEN: the focused E2E assertion passed after rebuilding the app.

### Changed files

- `src/components/shell/LibraryManagementMenu.tsx`
- `e2e/accessibility.spec.ts`
- `.superpowers/sdd/ui-review-fixes/task-2-report.md`

### Verification

- `npx vitest run src/components/shell/LibraryManagementMenu.test.tsx` — 1 passed.
- `npm run build` — passed; existing `reviewScheduler.ts` dynamic-import chunking warning.
- `npx playwright test e2e/accessibility.spec.ts --project=chromium --grep '320px reflow' --reporter=line` — 1 passed.
- `npx playwright test e2e/accessibility.spec.ts --project=chromium` — 4 passed.
- `git diff --check` — passed.

### Decisions and remaining risk

- Kept existing Escape focus restoration and Arrow/Home/End wrapping logic unchanged; only its item discovery changed.
- Full accessibility E2E covers the menu assertion and passed; the focused assertion covers Sound → Zen → Export → Clear.
