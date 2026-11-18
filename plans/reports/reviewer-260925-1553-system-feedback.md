# System and feedback visual review

**Status: DONE_WITH_CONCERNS**

## Coverage

Inspected the 100 unique screenshots in `artifacts/recovery-shell-share-20260925-1553` (excluding duplicate attachment copies): 20 each for loading, error, offline, sync error, and combined feedback + Undo. Each group covers Classic/Crystal light and dark, English/Vietnamese at 1440 and 390 widths, and English pseudo-localized at 360. Compared the system regions with `docs/design/sonflash-redesign/canvas/reference/AnimeSystem-light.png` and `AnimeSystem-dark.png`, and feedback/Undo regions with `FeedbackSheet-light.png` and `AnimeFeedback-light.png` / `AnimeFeedback-dark.png`.

Loading and runtime-error panels hold together across the matrix. The Crystal loading/error panels retain the chamfer, rim, Kanit display/buttons, Lumi asset, and correct light/dark surface colors. Long pseudo-localized error copy wraps the buttons vertically at 360; both remain visible. Offline state copy, due-card content, and controls remain visible at mobile widths. Toast and Undo stacks remain separate and fully visible above bottom navigation at 390 and 360; long pseudo-localized copy wraps, while dismissal and Undo controls remain on-screen. Desktop Undo bars match the 400×56 classic / 400×52 Crystal Canvas regions. Crystal sync-error code-detail paint now matches the near-white light and dark Canvas surfaces; the primary gradient and display-button typography also match.

## Findings

1. **Crystal desktop offline due cards were wider than Canvas and overlapped Lumi.** AnimeSystem’s offline sample fixes each due card at 132×138 px, leaving the right side of the 424 px panel for Lumi. The reviewed 1440 captures expand the two cards to about 187 px each; Lumi overlays the second card’s lower-right area. Repro: `system-offline-crystal-light-en-1440.png` (same geometry in Crystal dark). The Crystal card rule now sets `flex: 0 0 132px`, with `flex: 1 1 0` restored below 420 px so mobile cards share available width. The 390 captures hide Lumi and the due cards fit their available width.

2. **Long sync-error detail hid its queued-change count in the initial view.** `.workspace-sync-detail` has a 76 px base / 78 px Crystal max-height and scrolls internally. Long EN details use three lines plus the pending-count line, so captures show the count partly clipped at the bottom; mobile VI also clips part of the count. Repro: `system-sync-error-classic-light-en-1440.png`, `system-sync-error-crystal-light-en-390.png`, and `system-sync-error-crystal-dark-vi-390.png`. The pending-count row now sits outside the scroll viewport as a separate status paragraph. The detail itself remains focusable and scrollable. The Canvas AnimeSystem sync detail keeps its short error and pending-write count together in the visible detail region.

## Limits

This was a screenshot/source inspection; no post-fix browser render was run because the parent owns the build/browser gate. The artifact matrix has no reduced-motion variant, so reduced-motion presentation was not verified. The two source corrections above are therefore not yet visually confirmed by a regenerated capture.
