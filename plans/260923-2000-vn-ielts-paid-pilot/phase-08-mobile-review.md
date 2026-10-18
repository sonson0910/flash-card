# Phase 08: Mobile review

Effort: 1.75d. Blocked by: none. Release: R3 (G3).

> **Added 2026-09-23:** fix the study recap so it shows the XP actually granted (2 per review,
> read from the same constant as `src/features/librarySession/libraryReplica.ts:347`) instead of
> `good*5 + again*2` (`src/features/practice/StudyView.tsx:312`), with a unit test. +0.25d.

## Context

- GPT P0 #2: review must work well on a phone (the learner captures on a laptop and reviews
  anywhere); no FSRS change.
- Review UI: `src/features/practice/StudyView.tsx` (swipe left = Again at `:140-142`, keyboard
  ratings at `:197`, recap at `:311-312`), `src/components/study/ReviewControls.tsx`, card face in
  `src/components/Flashcard.tsx` (tilt, spotlight, aura, 3D flip, star pop, blind blur, audio waves).
- Playwright projects are desktop only (`playwright.config.ts:31-40`). A touch-target spec exists
  (`e2e/phase6-touch-targets.spec.ts`).
- Must keep every existing effect. Pointer-driven effects (tilt, spotlight) need a sensible touch
  behaviour, not removal.

## Requirements

1. At 360 × 740 and 390 × 844 (and landscape 740 × 360): the card and all four rating buttons fit
   without horizontal scroll; rating buttons ≥ 44 × 44 px with ≥ 8 px spacing; the reveal action is
   reachable with one thumb; text on the card back scrolls inside the card when long.
2. Touch: tap flips; swipe gestures keep working and never fire on vertical scroll inside the back
   face; tilt and spotlight respond to touch position or stay at rest, without jank (≥ 50 fps on a
   mid-range Android in Chrome DevTools performance with 4× CPU throttle).
3. `prefers-reduced-motion` keeps its current reduced behaviour.
4. Safe-area insets respected on iOS Safari (bottom controls clear the home indicator).
5. No FSRS, scheduling or rating semantics change.

## Files

- Modify `src/features/practice/StudyView.tsx`, `src/components/study/ReviewControls.tsx`,
  `src/components/Flashcard.tsx` (layout and touch handling only), and `src/index.css` if shared
  utilities are needed. Tailwind v4 compiles one CSS file with only about 1.5 KB gzip headroom, so
  prefer existing utilities and check the CSS size in `npm run verify:bundle` (red team #14).
- Modify `playwright.config.ts`: add `mobile-chrome` (Pixel 7) and `mobile-safari` (iPhone 14)
  projects limited by `testMatch` to the pilot mobile spec, so the full suite does not triple.
- Create `e2e/pilot-mobile-review.spec.ts` (no horizontal overflow, target sizes, rate a card by tap
  and by swipe, recap visible).

## Steps

1. Measure the current state with the new spec and a real phone; list failures.
2. Fix layout (container sizing, bottom control bar, back-face scroll).
3. Fix touch handling conflicts (swipe vs scroll; pointer effects on touch).
4. Performance check with throttling; adjust only effect parameters (blur radius, layer count) if
   frame rate is below target, never remove an effect.

## Validation

- `npx playwright test e2e/pilot-mobile-review.spec.ts --project=mobile-chrome --project=mobile-safari`.
- Existing `e2e/motion-remediation.spec.ts`, `e2e/flashcard-remediation.spec.ts` and
  `e2e/phase6-touch-targets.spec.ts` pass.
- `npm run verify:bundle`: CSS stays inside its budget.
- Manual: the owner reviews 20 cards on their own phone against production after G3.

## Risk

| Risk | L × I | Mitigation |
|---|---|---|
| Effect changes regress desktop | M × M | Desktop specs above must pass; changes gated by media queries or pointer type |
| Swipe misfires as Again | M × M | Minimum horizontal distance and angle threshold; tested in the spec |
| Layout fixes exceed the CSS budget | M × M | Reuse utilities; measure CSS at G3 (red team #14) |

## Rollback

Hosting rollback; the changes are presentation-only.
