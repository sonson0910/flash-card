# Phase 8 owner behavior

Status: DONE

## Changed files

- `src/features/practice/practiceSessionLifecycle.test.ts`
- `src/features/practice/usePracticeSession.ownerRace.test.ts`

## Result

- Replaced parallel-lifecycle-store source regex checks with deferred observable owner-race coverage while retaining the lifecycle UI/persistence adapter boundary checks.
- Added deterministic A -> B -> A quiz and review races. A stale quiz cannot publish or overwrite the returned owner's active quiz; a stale persisted review cannot mark, clear, or otherwise alter the returned owner's study state. The quiz case also proves no stale XP award, while a current interaction remains authorized.
- Preserved existing Phase 3 review-finality edits in the shared owner-race test file. No production lifecycle change was needed.

## Validation

- `npx vitest run src/features/practice/practiceSessionLifecycle.test.ts src/features/practice/usePracticeSession.ownerRace.test.ts` — passed (23 tests).
- `npm run lint` — passed.
- `git diff --check` — passed.
- `npx vitest run src/features/practice` — passed (82 tests across 11 files). Expected retry-path `console.warn` output appeared during two existing finality tests.

## Risk

- The test harness deliberately emulates hooks synchronously; browser integration coverage remains owned elsewhere.
