# Client fixes for the pilot pre-production review

Source: `plans/reports/review-260924-1613-pilot-commits-before-production.md` (main repo checkout). Scope: `src/` only.

## Row 5 — deletion client timeout (`accountDataService.ts`)

- `deleteAccount` now calls `deleteMyAccount` with `{ timeout: 300_000 }` instead of the 70 s SDK default.
- The confirmation phrase is NFC-normalized and trimmed before being sent, and the client-side compare (`AccountDataSection.tsx`) also NFC-normalizes the typed value before enabling the button and before the guard in `remove()`.
- Any callable error whose code is NOT one of `invalid-argument`, `failed-precondition`, `unauthenticated` (the codes the server throws before it touches account data) is now treated as "deletion started": local data is cleared, the user is signed out, and `deleteAccount` resolves `'started'` instead of throwing. A validation error still throws, and the dialog does not touch local data or sign the user out.
- `AccountDataSection.tsx` shows a new Vietnamese notice ("Yêu cầu xóa tài khoản đã được ghi nhận và sẽ tự hoàn tất trên máy chủ. Bạn đã được đăng xuất khỏi thiết bị này.") for the `'started'` outcome, and still closes the dialog silently on a full `'completed'` success, matching the existing tone.
- Added `lingoflash_shared_deck_operation_v1` to the local-cleanup key list in `removeOwnerLocalKeys` (the missing key from the review's lower-priority list).
- Tests: `accountDataService.test.ts` gained a `deleteAccount` describe block mocking `firebase/functions`, `firebase/auth`, `../../lib/firebase`, `../../lib/cardMirror`, `../../lib/deviceSync`, and stubbing `localStorage`/`sessionStorage`, covering the 300 s timeout + NFC send, the validation-error rethrow, the started-deletion path, and local-cleanup failure still signing the user out.

## Row 6 client — draft operation id (`cardIntakeController.ts`)

- The draft operation id is now keyed on normalized word + context + the controller's fixed `language.id`, not the word alone (`CardIntakeDraftOperation` replaces the old `{word, id}` shape in `CardIntakeDraftPort`). This also protects against a stale operation id surviving a target-language switch, since the port's stored `languageId` is compared against the new controller's language.
- `useIntakeSharingSession.ts`'s `browserDraft` port was updated to persist/read `context` and `languageId` alongside `word`/`id` in `sessionStorage`.
- Verified the existing error mapping already gives a sensible message for a server-side `failed-precondition` (hash conflict): `classifyProtectedFunctionError` classifies it as `kind: 'configuration'`, and `captureFailureMessage` turns that into "Dịch vụ AI chưa sẵn sàng. Từ đã chọn vẫn được giữ lại; hãy thử lại sau." No code change was needed there (already covered by an existing test in `cardIntakeController.test.ts`).
- Tests added to `cardIntakeController.test.ts`: a new id is minted when the same word is retried with a different context; the id is reused when word and context are unchanged; a new id is minted for the same word/context under a different language profile (simulating a stale cross-language `sessionStorage` read).

## Row 8 — swipe through dialog (`StudyView.tsx`)

- Added `shouldIgnoreStudyCardTouch(target, cardElement)` (exported) plus a `STUDY_TOUCH_BLOCKING_SELECTOR` covering `input, textarea, select, [contenteditable], [role="dialog"], [role="alertdialog"]`. `handleTouchStart` now calls it with `e.target` and `e.currentTarget` (the actual DOM node the handler is bound to) and bails out before arming the swipe if the touch's real DOM target is not contained by the card element, or if it lands on one of the blocked selectors. Radix dialogs render through a portal (confirmed for `EditCardDialog`, `ReportCardDialog`, and the delete `AlertDialog` in `Flashcard.tsx`), so `currentTarget.contains(target)` correctly returns `false` for their content even though React's synthetic event still bubbles through the card's React subtree.
- Since `touchStartRef` is only armed in `handleTouchStart`, gating just that handler is sufficient — `handleTouchMove`/`handleTouchEnd` already no-op when `touchStartRef.current` is `null`.
- New test file `StudyView.touchGuard.test.tsx`: five unit tests on the pure `shouldIgnoreStudyCardTouch` guard, plus one integration-style test that extracts the real `onTouchStart`/`onTouchMove` handlers from `StudyView`'s returned tree (same "call the component function directly with mocked hooks" harness as `StudyView.finality.test.tsx`) and confirms a portal-bubbled touch never arms a rating.

## Row 9 — edit dialog stale overwrite (`EditCardDialog.tsx`, `editCardModel.ts`, `useLearningWorkspace.ts`)

- `EditCardDialog` now captures `openedCard` via `useState(card)` (evaluated once, at mount) and diffs the draft against that snapshot instead of the live `card` prop, so a field the learner never touched is never reintroduced into the patch just because the live card advanced in the meantime.
- `useLearningWorkspace.ts`'s `updateCard` action now returns the real `LearningStateOutcome` (`Promise<LearningStateOutcome>` instead of `Promise<void>`), including for the two guard paths that used to return `undefined` silently: a stale `expectedLifecycle` now resolves `{status: 'stale-owner'}`, and a card that cannot be found now resolves `{status: 'missing-card'}`.
- Added `editCardModel.ts#isSuccessfulEditCardSave(outcome)`: true for `'published'`, `'durably-queued'`, and `'noop'` (the live card already matched the request, so the intent is satisfied), false otherwise, true for a `void`/absent outcome (a caller that does not report one).
- `EditCardDialog.submit` now awaits `onSave(...)`, checks `isSuccessfulEditCardSave`, and — unless it is true — shows the existing "Không lưu được thay đổi..." message and keeps the dialog open, instead of always closing after `onSave` merely resolved.
- To let the real outcome reach the dialog, `Promise<void>` was widened to the real `LearningStateOutcome` type at every concrete link in the chain: `LearningWorkspaceActions.updateCard`, `useAppLearningCoordination.ts`'s `practiceLearning.updateCard` wrapper, `LibraryScreen.tsx`/`LibraryCardGrid.tsx`'s `updateCard` prop, `Flashcard.tsx`'s `onUpdateCard` prop, and `usePracticeSession.ts`'s `PracticeLearningActions.updateCard`. Fire-and-forget consumers of the same `onUpdateCard` prop (`CardMnemonicSection.tsx`'s mnemonic auto-save, `StudyView.tsx`'s pass-through, and `Flashcard.tsx`'s own AI-translation auto-patch) needed no changes: their declared return type is bare `void` or accepts `void` as a union member, which TypeScript's void-returning-callback rule already allows regardless of what the underlying function actually resolves to; verified this compiles clean via `tsc --noEmit`.
- Tests: `editCardModel.test.ts` gained a diff-against-snapshot test and an `isSuccessfulEditCardSave` describe block; `useLearningWorkspace.test.tsx` gained two tests asserting the new `stale-owner`/`missing-card` return values; new `EditCardDialog.test.tsx` (same "call the component directly with mocked hooks" pattern used elsewhere in this repo, since there is no React Testing Library dependency) covers: dialog stays open with the failure message on a non-durable outcome, dialog closes on `'published'`, and a save only includes the field the learner edited even when the `card` prop is updated in between with a different, untouched field (simulating a remote sync landing while the dialog is open).
- `LibraryScreen.test.tsx` and `useLibraryScreenContract.test.ts` fixtures were updated to satisfy the new `Promise<LearningStateOutcome>` return type for their `updateCard` mocks.

## Lower priority items also fixed

- **Plan meter clock skew** (`usePlanUsage.ts`): extracted a pure, exported `resolvePlanPeriod(plan, now)` from the inline logic inside the Firestore snapshot callback. It now accepts a Pro grant as active up to 5 minutes before its own device-computed `now` reaches `startsAt` (`PRO_START_CLOCK_SKEW_TOLERANCE_MS`), and when the plan is `tier: 'pro'` but `startsAt` has not yet cleared that tolerance, it schedules the next refresh at `startsAt - 5 min` instead of waiting for the free period's month-end rollover. New `usePlanUsage.test.ts` covers: normal active Pro, a 4-minute-slow clock still reading Pro, a 20-minute-slow clock correctly falling back to Free with a refresh scheduled at `startsAt` (not month end), an expired Pro grant, and a missing/malformed plan document.
- **Missing local-cleanup key**: `lingoflash_shared_deck_operation_v1` added to `removeOwnerLocalKeys` (see Row 5 above); covered by the existing `accountDataService.test.ts` local-cleanup test.
- **NFC normalization of the confirmation phrase**: done both client-side compare (`AccountDataSection.tsx`) and before send (`accountDataService.ts`); covered by an `accountDataService.test.ts` test that sends an NFD-decomposed phrase and asserts the callable receives the NFC form.
- **"Báo thẻ sai" guest visibility and per-error messages**:
  - `Flashcard.tsx` now gates both the Zen-layout and the standard-layout report button behind `isAccountSignedIn()` (imported from `accountDataService.ts`), applied symmetrically to both branches so the button stays present in both layouts for a signed-in learner, matching the review's "verified correct" note that it was already present in both. A dedicated Zen-mode render test was not added because `useZenGlassMode` reads `window.localStorage` and this repo's Vitest setup runs in the Node environment (no jsdom, no `window`) — the Zen branch is unreachable from a `renderToStaticMarkup` test as a result. The identical gate applied to both branches is a structural guarantee that the Zen layout keeps the same visibility behavior.
  - `cardReportService.ts` gained `reportCardFailureMessage(error)`, mapping `ProtectedFunctionError.kind`/`code` (authentication, permission, quota, network, configuration, and a specific `not-found` case for "the card no longer exists") to distinct Vietnamese messages, falling back to a plain `Error`'s own message for client-side validation errors and to the original generic "check the connection" message only for a genuinely unrecognized failure. `ReportCardDialog.tsx` now uses it instead of a single catch-all message.
  - Tests: `Flashcard.test.tsx` gained two tests (guest hides the button, signed-in learner sees it) on the revealed/back side, using a `vi.mock` of `accountDataService`. `cardReportService.test.ts` gained a `reportCardFailureMessage` describe block covering every kind plus the `not-found` special case, a plain validation `Error`, and an unrecognized value.

## Flashcard effects and analytics

No changes were made to tilt, spotlight, aura, 3D flip, star pop, blind blur, or audio-wave effects, nor to any pilot analytics event call site. `Flashcard.tsx` was only touched to import `isAccountSignedIn` and gate the two report buttons; `EditCardDialog.tsx`/`ReportCardDialog.tsx` changes are confined to the save/report logic already covered above.

## Verification

- `npm run lint` (`tsc --noEmit`): clean for everything under `src/`. Four pre-existing `TS2556` errors remain in `functions/test/generateVocabularyCallable.test.ts`, an untracked file outside this task's ownership (owned by the concurrent `functions/` agent); not touched.
- `npx vitest run --maxWorkers=1 --pool=forks` (full suite): **206 test files, 1776 tests, all passing.** One test (`appCompositionRoot.test.ts`'s line-count gate on `useAppLearningCoordination.ts`) briefly regressed by one physical line from a wrapped expression and was fixed by keeping the `updateCard` wrapper on one line, matching the file's existing style for similarly long lines.
- `npm run build`: succeeds.
- `npm run verify:bundle`: **passes.** Initial JS: 65,045 B gzip (budget 71,000 B). Initial CSS: 28,403 B gzip (budget 29,500 B).
- Playwright was not run (not required, and not "cheap" for this change set).

## Files changed

- `src/features/account/accountDataService.ts`
- `src/features/account/accountDataService.test.ts`
- `src/features/account/AccountDataSection.tsx`
- `src/features/intake/cardIntakeController.ts`
- `src/features/intake/cardIntakeController.test.ts`
- `src/features/intake/useIntakeSharingSession.ts`
- `src/features/practice/StudyView.tsx`
- `src/features/practice/StudyView.touchGuard.test.tsx` (new)
- `src/features/practice/usePracticeSession.ts`
- `src/features/cardEdit/EditCardDialog.tsx`
- `src/features/cardEdit/EditCardDialog.test.tsx` (new)
- `src/features/cardEdit/editCardModel.ts`
- `src/features/cardEdit/editCardModel.test.ts`
- `src/features/learning/useLearningWorkspace.ts`
- `src/features/learning/useLearningWorkspace.test.tsx`
- `src/features/library/LibraryScreen.tsx`
- `src/features/library/LibraryScreen.test.tsx`
- `src/features/library/LibraryCardGrid.tsx`
- `src/features/library/useLibraryScreenContract.test.ts`
- `src/app/useAppLearningCoordination.ts`
- `src/components/Flashcard.tsx`
- `src/components/Flashcard.test.tsx`
- `src/features/cardReport/cardReportService.ts`
- `src/features/cardReport/cardReportService.test.ts`
- `src/features/cardReport/ReportCardDialog.tsx`
- `src/features/plan/usePlanUsage.ts`
- `src/features/plan/usePlanUsage.test.ts` (new)

## Unresolved questions

- None blocking. The Zen-layout report-button visibility relies on structural symmetry rather than a direct render test, for the environment reason noted above; flag if a jsdom-based test setup is later added and this should get an explicit Zen-mode test.
