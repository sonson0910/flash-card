# Phase 07: Capture, card, edit reliability

Effort: 3.25d (1d triage in W0 before G1, 2.25d in W2; red team #2, #12 add retry and AI-card edit
checks). Blocked by: none for the triage; the edit dialog needs 03 (`origin` in the rules key list)
and the retry check needs 02 (operation id on the intake draft). Release: triage fixes in R1 (only
data-loss and save blockers are above the W0 cut line, plan.md), edit dialog in R3 (G3).

## Context

- GPT P0 #1: capture → correct-sense card → editable → in the review queue, with clear errors and no
  lost data.
- Capture path (extension v1.6.3): selection → `background-core.js` job → inactive worker tab →
  `app-bridge.js` nonce-verified import → `src/features/browserExtension/browserExtensionImportRuntime.ts`
  → `useCardIntake` → `cardIntakeController.ts:289` (existing card?) → `:316` `generateCard` →
  `cardIntakePipeline.ts:501-506` (`generateWordInfo` with the nearby sentence as context, up to 500
  characters) → media (`fetchAudioUrl`, `fetchImageUrl`) → `persistCards` (`:562-640`, local mirror
  first, then `createCard` callable with an 8 s timeout and a queued fallback "Saved locally; awaiting
  sync.").
- Errors surface through `classifyProtectedFunctionError` and `getProtectedFunctionUserMessage`
  (`src/lib/protectedFunctionsCapability.ts`), and the extension shows an inline result on the page.
- There is **no UI to edit a card's text**. The patch protocol already allows `translation`,
  `explanation`, `explanationTranslation`, `exampleSentence` and more (`src/lib/cardMutationProtocol.ts:15-40`),
  and card updates are allowed by rules for non-scheduling fields (`firestore.rules:693-711`).
  Commands reach it through `learningCommands.updateCard` (`src/app/useAppLearningCoordination.ts:221`).
- No list of real capture failures exists yet; the W0 dogfood run creates it.

## Requirements

1. **W0 triage (1d, before G1):** the owner captures 50 words from real IELTS Reading passages on
   5+ sites (Cambridge-style practice pages, BBC, The Guardian, a PDF opened in Chrome if the
   extension supports it) through the extension, in Chrome on a laptop. Log per capture: site,
   success or error text, time to card, sense correct (y/n), meaning in Vietnamese acceptable (y/n).
   Fix every failure that loses the word or blocks the save; list the rest in the decision log.
   Store this log outside analytics (it contains words; it is the owner's own data).
2. **Clear failure states:** every capture failure the learner can hit (signed out, card quota,
   daily allowance, account spend share, service spend cap, network, timeout, provider error,
   operation in flight) shows a Vietnamese message that says what happened and what to do, and
   keeps the selected word so a retry is one click. The retry reuses the draft's `operationId`
   (phase 02): completed results are reused, while a failed or timed-out provider attempt may
   call Gemini again and incur another provider charge. Each attempt still passes the app's
   $5/day spend reservation. The owner accepted this pilot exception. Quota and cap messages
   come from phases 01 and 02.
3. **Edit dialog (W2):** from the card back and the library row, "Sửa thẻ" opens a lazy dialog with
   `translation`, `explanation`, `explanationTranslation`, `exampleSentence`, `exampleTranslation`
   (bounded lengths matching `cardNormalization`), saving through the existing patch path with the
   current revision. Conflicts use the existing recovery (`src/lib/cardConflictRecovery.ts`). Editing
   never changes scheduling fields or `origin`; editing an AI card must pass the rules, which list
   `origin` since phase 03 (red team #12).
4. **Queue guarantee:** a captured card is in the due queue for its first review the same day. Verify
   the initial `nextReviewDate` or FSRS state a new card receives and that the study screen includes
   it; fix only if not.

## Files

- Triage fixes: whichever files the dogfood run implicates (expected in
  `src/features/intake/*`, `src/features/browserExtension/*`, `extensions/lingoflash/*`). Any
  extension change needs `npm run extension:check` and a new extension build.
- Create `src/features/cardEdit/EditCardDialog.tsx` and `src/features/cardEdit/editCardModel.ts`.
- Modify `src/components/Flashcard.tsx` (edit entry next to the phase 03 report action) and the
  library row component found from `src/features/library`.
- Tests: `src/features/cardEdit/editCardModel.test.ts`; a Playwright spec
  `e2e/pilot-capture-edit-review.spec.ts` (generate with the emulator or a stubbed callable as the
  existing e2e specs do, edit the meaning of an AI card with `origin: 'ai'`, bookmark it, review it).

## Steps

1. Dogfood run and log (owner, W0 day 2). Triage same day; fix blockers W0 day 3.
2. Error copy pass over the nine failure kinds; prove a manual retry after a forced failure sends
   the same `operationId`. Check whether the extension worker retries a failed job in a new page
   (and so with a new id); record the answer against the open question in plan.md and, if it does,
   pass the id through the job.
3. Edit dialog and tests (W2).
4. Queue check and the Playwright spec.

## Validation

- Dogfood re-run of 20 captures after fixes: ≥ 95% succeed without a manual retry; none loses the
  word; no completed card is charged twice in the account card quota. Record provider retry
  attempts and their ledger reservations separately, including any ambiguous timeout.
- Playwright spec passes on Chromium; existing `e2e/flashcard-remediation.spec.ts` and
  `e2e/sync-acceptance.spec.ts` stay green.
- Bundle: edit dialog is a lazy chunk.

## Risk

| Risk | L × I | Mitigation |
|---|---|---|
| Dogfood finds more blockers than 1d can fix | M × H | Fix data-loss and save blockers first; the rest go to W2 and onboarding notes |
| Editing races an in-flight review | L × M | Patch carries `baseRevision`; existing conflict recovery handles it |
| Edits of AI cards denied by rules | M × H | Depends on the phase 03 rules change; the e2e spec edits an AI card (red team #12) |
| Extension change needs Chrome Web Store review | M × M | Prefer app-side fixes; if the extension must change, ship it as an unpacked/zip build to the cohort (README install steps) |

## Rollback

Hosting rollback removes the edit dialog. Triage fixes are individual commits that can be reverted
one by one.
