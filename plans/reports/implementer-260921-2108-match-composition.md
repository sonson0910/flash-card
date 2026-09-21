# Match composition handoff

## Changed files

- `src/app/useAppLearningCoordination.ts`
- `src/app/AppRuntime.tsx`
- `src/components/AppOverlays.tsx`
- `src/components/AppOverlays.test.tsx`
- `src/app/AppDeferredViews.tsx`
- `src/app/AppDeferredViews.test.tsx`
- `src/features/practice/PracticeScreen.tsx`
- `src/features/practice/practiceModel.ts`
- `src/features/practice/practiceModel.test.ts`
- `src/features/practice/usePracticeGames.ts`
- `src/features/practice/usePracticeGames.test.ts`
- `src/features/practice/WordMatchView.tsx`
- `src/features/practice/WordMatchView.test.tsx`

## Result

- The production practice-mode map accepts `match` and `shadowing`.
- The existing gamification `addXp` callback now flows from coordination through runtime and deferred practice composition to Match and Shadowing.
- Match rounds trim fields, remove duplicate logical word/translation pairs, require four eligible pairs to start, and display the actual generated-board denominator.
- Match completion awards the legacy 20 XP once; the completion guard prevents duplicate callbacks before React has rendered state updates.
- The Match launcher uses the same round generator over the filtered visible cards, so duplicate or blank cards cannot unlock it.
- Deferred composition tests render both production practice branches and invoke their captured XP ports.

## Validation

- `npm test -- --run src/app/AppDeferredViews.test.tsx src/components/AppOverlays.test.tsx src/features/practice/practiceModel.test.ts src/features/practice/usePracticeGames.test.ts src/features/practice/WordMatchView.test.tsx` — 34 passing tests.
- `npm run lint` — passed (`tsc --noEmit`).
- `git diff --check` — passed.

## Decisions and risk

- Reused the existing gamification callback; no new XP service or persistence contract was introduced.
- Preserved pre-existing dirty Phase 3 edits in coordination and PracticeScreen.
- Shadowing teardown/recognition behavior remains owned by the separate subphase; this change only supplies its XP callback.

Status: DONE
Summary: Match/Shadowing composition and Match round/XP behavior are implemented and focused checks pass.
Concerns/Blockers: Full browser accessibility/E2E validation was outside this owned capsule.
