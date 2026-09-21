---
title: "Phase 6: Practice UI and accessibility"
status: complete
---

# Phase 6: Practice UI and accessibility

## Overview

Restore Match and Shadowing composition, use the existing XP/persistence contracts, fix keyboard and session ordering, and finish the lifecycle/accessibility work without replacing current dirty Flashcard/Undo edits.

## Requirements

- [x] Match and Shadowing render through the practice workspace and award XP exactly once.
- [x] Word Match eligibility and displayed totals derive from the same generated round.
- [x] Study shortcuts act only in the active practice surface and never consume interactive/editable targets.
- [x] A committed review shows final recap/statistics; a durably queued offline review advances only with visible provisional state and Phase 3 compensation support.
- [x] All named controls have a measured minimum 44×44 target.
- [x] Undo timing pauses during hover/focus and audio/recognition/focus timers cancel on replay, navigation, or unmount.

## File inventory

| Concern | Paths |
|---|---|
| Composition/XP | `src/app/useAppLearningCoordination.ts`, `src/app/AppRuntime.tsx`, `src/app/AppDeferredViews.tsx`, `src/features/practice/PracticeScreen.tsx` |
| Match/Shadowing/Spelling | `src/features/practice/practiceModel.ts`, `src/features/practice/usePracticeGames.ts`, `src/features/practice/WordMatchView.tsx`, `src/features/practice/ShadowingView.tsx`, `src/features/practice/SpellingView.tsx` |
| Study | `src/features/practice/usePracticeSession.ts`, `src/features/practice/StudyView.tsx`, `src/features/practice/SessionRecapModal.tsx` |
| Touch targets/undo | `src/components/ui/UndoToast.tsx`, `src/features/library/LibraryTools.tsx`, `src/components/flashcard/CardMnemonicSection.tsx`, `src/components/Flashcard.tsx` |
| Audio/focus | `src/lib/audio.ts`, `src/features/library/AiDialogueModal.tsx`, `src/components/flashcard/ActiveRecallPrompt.tsx`, `src/components/AppOverlays.tsx`, `src/features/overlays/useOverlayState.ts` |
| Component tests | `src/app/AppDeferredViews.test.tsx`, `src/features/practice/usePracticeGames.test.ts`, `src/features/practice/practiceViews.test.tsx`, `src/features/practice/WordMatchView.test.tsx`, `src/features/practice/ShadowingView.test.tsx`, `src/features/practice/usePracticeSession.ownerRace.test.ts`, `src/lib/audio.test.ts`, `src/features/library/AiDialogueModal.test.tsx`, `src/components/ui/UndoToast.test.tsx`, `src/features/library/LibraryTools.test.tsx`, `src/components/Flashcard.test.tsx`, `src/components/AppOverlays.test.tsx`, `src/features/overlays/useOverlayState.test.ts` |
| Browser tests | `e2e/accessibility.spec.ts`, `e2e/app-shell-remediation.spec.ts`, `e2e/phase5-learning.spec.ts`, `e2e/flashcard-remediation.spec.ts` |

## Implementation steps

1. Include `match` and `shadowing` in the practice-mode mapping. Add a composition test that reaches both views through the production entry path.
2. Thread the existing `gamification.addXp` port through runtime/deferred view/screen and pass it to Match/Shadowing. Do not create another XP service.
3. Centralize Match eligibility (nonblank word/translation, logical-pair dedupe, minimum four) and derive score/victory/timeout denominator from the actual board.
4. Replace document-wide/dead `[aria-hidden="false"]` lookups with scoped actions/refs. Ignore buttons, links, inputs, selects, textareas, editable content, dialogs/overlays, composing/default-prevented events, and modifier combinations outside the documented shortcuts.
5. Await the Phase 3 rating result. On `committed`, finalize counts, weak cards, XP/confetti, index, and recap. On `durably-queued`, show sync-pending/provisional state and only the effects covered by Phase 3's promotion/compensation contract. On stale/conflict/error, keep the card actionable. Prevent a second submit while pending.
6. Preserve the dirty Flashcard target fixes and current Undo callback stabilization. Add pause/resume-with-remaining-time behavior for hover and focus-within, including progress animation.
7. Bring UndoToast, LibraryTools, CardMnemonicSection, Shadowing, SessionRecapModal, and remaining Flashcard controls to 44×44 measured targets without changing semantic roles.
8. Return a scoped playback handle from `playWordAudio`. Each caller (`SpellingView`, `ShadowingView`, `usePracticeGames`, `AiDialogueModal`) owns one current handle, cancels it before replay and on unmount/navigation, and cannot cancel another surface's playback. Keep `fetchAudioUrl` timeout ownership separate unless its API is explicitly changed. Apply equivalent owned cleanup to Active Recall and speech recognition; abort recognition when supported and prevent duplicate final-result XP.
9. Reuse `scheduleOverlayFocusRestore` and cancel outstanding focus tasks on rapid close/reopen/unmount; add no second focus scheduler.

## Scenario matrix

| Scenario | Expected |
|---|---|
| Open Match/Shadowing from real app route | Correct nonblank view |
| Complete one attempt with repeated final callback | XP once |
| Four or five eligible Match pairs | UI denominator is four or five |
| Focused button/link/input receives Space/Enter | Native action/typing preserved; Study shortcut does not hijack |
| Final rating save pending/rejected | No recap; card remains actionable |
| Undo hovered/focused past original 5s | Remains visible; resumes remaining time on disengage |
| Navigate during TTS/audio/recognition | Playback and late state/XP callbacks stop |
| Spelling/dialogue starts playback then unmounts | Its own playback stops without cancelling a different surface |
| 320px viewport at 200% text | No clipped action; targets remain at least 44×44 |

## Validation

- Focused unit/component tests listed above.
- `npm run test:a11y` and targeted Chromium practice E2E first.
- Then run the same keyboard, focus, target-size, and audio fallback journeys on Firefox and WebKit.
- Use measured bounding boxes/axe plus keyboard behavior; class-name grep alone is insufficient.

## Success criteria

- [x] Match/Shadowing route, score, XP, and teardown regressions pass.
- [x] Study shortcut and persistence ordering are behaviorally tested.
- [x] All audited controls meet the target-size contract at normal and 200% text.
- [x] No timer, `Audio`, speech synthesis, recognition, or focus callback mutates an unmounted/stale surface.

## Completion evidence

- Independent acceptance: `plans/reports/reviewer-260921-2210-phase6-final-acceptance.md` — PASS.
- Focused Phase 6 tests: 63/63; root Vitest: 1704/1704.
- Browser touch/Undo matrix: 9/9 across Chromium, Firefox, and WebKit at normal and 320px/200% layouts.
- The test-only touch harness is served from `e2e/fixtures/` and is absent from the production build.

## Risks and rollback

- Risk: global keyboard changes can break assistive/native interactions. Keep shortcut ownership inside the practice surface and prove exclusions in browser tests.
- Roll back composition and XP wiring independently; retain accessibility/cancellation fixes that pass their focused contracts.
