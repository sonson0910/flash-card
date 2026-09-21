# Phase 3 study finality

## Changed

- `StudyView` waits for an explicit committed settlement before updating recap counters, weak cards, XP display, confetti, or the final-session recap.
- `usePracticeSession` now returns a four-state rating settlement and distinguishes a locked `sync-pending` review from retryable failures.
- `PracticeScreen` maps only `committed` to the study view's finalization signal.
- Added final-card coverage for pending, committed, queued, conflict, and permanent-error outcomes.
- Removed the public `void` review result from Practice, Daily Learning, App View, and Learning Workspace contracts; missing or non-final outcomes are explicit and Daily Learning does not advance for them.

## Validation

- `npx vitest run src/features/dailyLearning/dailySessionController.test.ts src/features/learning/useLearningWorkspace.test.tsx src/features/practice/StudyView.finality.test.tsx src/features/practice/usePracticeSession.ownerRace.test.ts src/features/practice/practiceViews.test.tsx` — passed (48 tests).
- `git diff --check` — passed.
- `npm run lint` — passed.

## Risk

`sync-pending` remains intentionally non-final and locked against resubmission; later authoritative promotion is handled by the broader persistence/replay contract. Daily Learning accepts only `published` as final; it intentionally does not assume `noop` represents a durable review.
