# Phase 6 audio and speech lifecycle

## Changed files

- `src/lib/audio.ts`, `src/lib/audio.test.ts`
- `src/features/practice/SpellingView.tsx`
- `src/features/practice/ShadowingView.tsx`, `src/features/practice/ShadowingView.lifecycle.test.tsx`
- `src/features/practice/usePracticeGames.ts`, `src/features/practice/usePracticeGames.test.ts`
- `src/features/library/AiDialogueModal.tsx`
- `src/components/flashcard/ActiveRecallPrompt.tsx`

## Result

`playWordAudio` now returns an idempotent, scoped cancellation handle. Each assigned caller retains and replaces only its own handle, cancelling on replay and its navigation/unmount path. A tiny fallback-speech coordinator tracks one owned utterance: cancellation before `onstart` clears its queue; cancellation after `onstart` calls global synthesis cancellation only when that handle still owns the active utterance. Stale handles therefore cannot stop a newer surface. Shadowing stops and aborts recognition where available, gates callbacks by the current recognition instance, and accepts one final result per session. Its pronunciation control is now 44px.

## Validation

- `npx vitest run src/lib/audio.test.ts src/features/practice/usePracticeGames.test.ts src/features/practice/ShadowingView.test.tsx src/features/practice/ShadowingView.lifecycle.test.tsx src/features/practice/practiceViews.test.tsx src/features/library/AiDialogueModal.test.tsx` — 40 passed.
- `npx vitest run src/lib/audio.test.ts src/features/practice/usePracticeGames.test.ts src/features/practice/ShadowingView.lifecycle.test.tsx` after the speech-owner coordinator — 24 passed.
- `git diff --check -- <owned files>` — passed.
- `npm run lint` — passed.

## Remaining risk

Browser speech synthesis has a global API; ownership is therefore coordinated within this module. External, untracked speech synthesis consumers remain outside this surface-level contract.

Status: DONE
Summary: Scoped audio and recognition lifecycle behavior is implemented and focused tests pass.
Concerns/Blockers: Repository-wide lint remains blocked by an unrelated existing TypeScript error.
