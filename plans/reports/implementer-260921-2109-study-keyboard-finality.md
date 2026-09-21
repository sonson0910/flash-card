# Phase 6 study keyboard and finality

## Changed

- `src/features/practice/usePracticeSession.ts`
  - Removed the document-wide study key listener and its global/dead `aria-hidden` queries.
  - Preserved the Phase 3 settlement contract: only `published` marks a review committed; queued reviews remain sync-pending and cannot be resubmitted.
- `src/features/practice/StudyView.tsx`
  - Scoped all study shortcuts to the rendered study surface.
  - Excluded interactive/editable/dialog targets, composing/default-prevented input, and undocumented modifier combinations.
  - Scoped flip, playback, and pronunciation actions to the study surface rather than querying the document.
  - Kept recap, counts, weak cards, and confetti behind an awaited committed result and a local single-flight guard.
  - Advances an intermediate queued review only with a visible provisional status; queued final reviews never show recap or final effects.
- `src/app/AppRuntime.tsx`
  - Owns pre-lazy Study shortcuts on the common practice-stage ancestor that also contains the focused Study heading.
  - Uses only bubbling keyboard handling; no window/document capture listener remains.
- `src/features/practice/PracticeScreen.tsx`
  - Passes the explicit study settlement to `StudyView` instead of reducing it to a boolean.
- `src/features/dailyLearning/lessonReducer.ts`, `dailySessionController.ts`, `DailyLearningWorkspace.tsx`, `dailyLearningPresentation.ts`, and `LessonScreen.tsx`
  - Advance queued non-final daily reviews provisionally with a visible sync-pending indicator.
  - Keep a queued final daily review out of the completion state and rating-retry flow.
- `src/features/dailyLearning/dailySessionController.test.ts`
  - Covers queued intermediate and final outcomes without treating them as committed.
- `e2e/app-shell-remediation.spec.ts`
  - Aligns the Study keyboard assertion with the approved visible provisional state.
- `src/features/practice/StudyView.finality.test.tsx`
  - Added behavioral shortcut ownership/exclusion coverage alongside deferred finality coverage.

## Validation

- `npx vitest run src/features/dailyLearning/dailySessionController.test.ts src/features/dailyLearning/lessonReducer.test.ts src/features/dailyLearning/DailyLearningScreens.test.tsx src/features/practice/StudyView.finality.test.tsx src/features/practice/usePracticeSession.ownerRace.test.ts src/features/practice/practiceViews.test.tsx` — passed: 68 tests.
- `npm run build` — passed.
- `npx playwright test e2e/phase5-learning.spec.ts --project=chromium` — passed: 5 tests.
- `npx playwright test e2e/app-shell-remediation.spec.ts --project=chromium --grep "study shortcuts"` — passed: 1 test.
- `npm run lint` — passed.
- `git diff --check -- <assigned practice files>` — passed.

## Decisions and risk

- A durably queued intermediate review advances only provisionally and creates no final stats/XP/confetti/recap; a queued final review remains visibly sync-pending without recap/completion. Both rely on the existing Phase 3 queue checkpoint/compensation path.
- Shortcut handling is owned by the common practice-stage ancestor before lazy StudyView mount, then by the Study surface; interactive, editable, dialog, composing, default-prevented, and unsupported-modifier input is never consumed.

Status: DONE
Summary: Study keyboard controls are surface-scoped and final session effects only occur after a committed review.
Concerns/Blockers: None in this capsule. Focused tests intentionally log exercised conflict/persistence-failure paths to stderr.
