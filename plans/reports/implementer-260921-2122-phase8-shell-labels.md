# Phase 8 shell-label consistency

## Outcome

- Kept the selected shell contract as `Today`, `Paths`, `Vocabulary`, and `Progress` in the UI specification and restored conflicting dirty E2E label assertions to that contract.
- Made the floating mobile navigation's accessible names exactly match its visible `Today`, `Vocabulary`, and `Progress` labels.
- Added focused static-markup assertions for the desktop labels and mobile accessible names.
- Preserved unrelated dirty assertions in `e2e/accessibility.spec.ts` and `e2e/app.spec.ts`.

## Validation

- `npx vitest run src/components/shell/AppNavigation.test.tsx src/components/shell/FloatingMobileNav.test.tsx` — pass (3 tests).
- `npm run lint` — pass.
- `npm run build` — pass.
- `npx playwright test e2e/app.spec.ts e2e/catalog-workspace.spec.ts e2e/phase5-learning.spec.ts --project=chromium` — 12 passed, 1 failed.
- `git diff --check` — pass.

## Concern

The one failing E2E is outside the label change: `e2e/phase5-learning.spec.ts` cannot advance from Question 1 after selecting Good because the UI reports `The review was not saved (durably-queued). This question is still open.` No assertion was weakened to conceal that behavior failure.

Follow-up review found the mobile tab still rendered `Library`; it now visibly renders `Vocabulary` and the focused unit test asserts visible text as well as accessible names. Expanded ownership aligned the desktop and mobile landing-navigation buttons plus the landing-performance selector. After the strict-port owner released port 4173, Chromium accessibility (3 tests) and landing-performance (3 tests) suites passed; root lint and final diff check passed with no listener left behind.
