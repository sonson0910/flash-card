# Phase 6 touch targets and undo

## Outcome

- Undo now retains the real remaining lifetime while pointer hover or focus-within is active, pauses/resumes its progress animation, ignores repeated dismissal, continues to use the latest dismissal callback, and disposes its timeout on unmount or toast replacement.
- Raised owned LibraryTools and mnemonic interactive controls to Tailwind `11` spacing (44px), retaining their existing semantics and wrapping layouts.
- Preserved the pre-existing dirty Flashcard target changes. Added its mnemonic target assertion only.
- Reviewer follow-up: raised the Flashcard learning-details close control and SessionRecapModal close control from 40px to 44px; recap actions already use `min-h-11` and are asserted.
- Added measured Chromium evidence. Real app journeys cover LibraryTools, Flashcard, CardMnemonicSection, and Shadowing at 320px/200% text. A production-built React harness covers UndoToast and SessionRecapModal because guest deletion does not create an undo toast and guest review is intentionally sync-pending rather than recap-eligible.

## Changed files

- `src/components/ui/UndoToast.tsx`
- `src/components/ui/UndoToast.test.tsx`
- `src/features/library/LibraryTools.tsx`
- `src/features/library/LibraryTools.test.tsx`
- `src/components/flashcard/CardMnemonicSection.tsx`
- `src/components/Flashcard.test.tsx`
- `src/features/practice/SessionRecapModal.tsx`
- `src/features/practice/SessionRecapModal.test.tsx`
- `e2e/phase6-touch-targets.spec.ts`
- `e2e/fixtures/phase6-touch-targets.tsx`
- `phase6-touch-targets.html`
- `vite.config.ts`

## Validation

- `npx vitest run src/components/ui/UndoToast.test.tsx src/features/library/LibraryTools.test.tsx src/components/Flashcard.test.tsx src/features/practice/SessionRecapModal.test.tsx` — PASS, 28 tests.
- `npm run build && npx playwright test e2e/phase6-touch-targets.spec.ts --project=chromium` — PASS, 3 measured browser journeys.
- `npm run test:a11y` — PASS, build plus 3 Chromium accessibility/reflow tests.
- `git diff --check` — PASS.
- `npm run lint` — PASS.

## Risk

The 44px contract is now asserted from real browser bounding boxes; the timer helper also retains deterministic fake-timer coverage. The dedicated harness is a build entry solely for the browser test because production guest routes intentionally cannot reach both toast and committed-session recap states.
