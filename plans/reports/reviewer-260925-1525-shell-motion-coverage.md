# Phase 03 motion and board-closure audit

**Scope:** source-only review of AnimeMotion, MotionStoryboard, and AnimeMobile. No browser, build, or test command was run.

## Boundary from the accepted baseline

The inventory assigns all three boards to phase 03 and still marks each required / pending-evidence. That assignment does not make every depicted screen a phase-03 deliverable.

| Board region/state | Phase 03 obligation | Later owner; must remain open |
| --- | --- | --- |
| AnimeMobile: bottom navigation, responsive shell, safe-area and reachable labels/focus | 03.2 | Today session stages 05.1; review/card controls 04.4/05.1/05.7/11.3; recap 05.6/06.5; quiz/practice 05.4/05.5/05.7/10.5/15.2; onboarding 10.2/10.3; entitlement/paywall 15.1–15.3. |
| AnimeMotion: common reduced-motion policy; do not let animation invent XP/tier | 03.3/03.4 | Deal, selected-card continuity, wings/flare, flip, grade, combo, tier, and Lumi reactions attach to real card/session state in 04.4/05.2/05.6. |
| MotionStoryboard: accessibility fallback and no animation-dependent completion/focus | 03.4/03.5 | Today-to-Review shared card/focus transfer 05.2; settled recap and next action 05.6; card-preserving edit-sheet transition 04.5. |

This follows the behavior maps: [MotionStoryboard](../260925-1005-claude-design-workflow-recovery/evidence/board-behavior-map-3.json), [AnimeMobile](../260925-1005-claude-design-workflow-recovery/evidence/board-behavior-map-4.json), and [AnimeMotion](../260925-1005-claude-design-workflow-recovery/evidence/board-behavior-map-5.json).

## Existing phase-03 evidence

| Contract | Source evidence | Limit |
| --- | --- | --- |
| Shell entrance and view change | src/components/motion/AppShellMotion.tsx is mounted directly by src/app/AppRuntime.tsx; initial nav/brand/action/view entrance and later view-stage opacity + 8px lift use the browser animation API. It settles/cancels animations and marks nav ready. | It does not implement the storyboard’s selected-card lift/fly, chrome recession, or focus landing. Those remain 05.2. |
| User and OS motion reduction | src/lib/motionPreference.ts combines local user preference with prefers-reduced-motion, writes html[data-motion], and src/features/settings/settings-screen.tsx exposes the switch. src/index.css collapses global animation/transition duration; AppShellMotion, GsapEntrance, and CountUp take the reduced path. | Source review cannot prove every future or existing effect follows this contract. The Canvas-specific flip/crossfade and skipped wings/pillar are card-effect requirements for 04.4/05.2. |
| Overlay entrance/fallback | src/components/motion/GsapEntrance.tsx obtains its variant from src/lib/motion.ts, reduces to immediate motion, and is used by share/practice/stats/clear overlays in src/components/AppOverlays.tsx. | This is not evidence for the edit side sheet or all dialogs; that is 04.5 and requires its own state/focus evidence. |
| Mobile shell primitives | src/components/shell/FloatingMobileNav.tsx provides labelled 4-item navigation; src/components/shell/AppFeedback.tsx positions notification/undo above env(safe-area-inset-bottom). | No source-only proof here covers all AnimeMobile screen variants at 390×844, account/language/settings entry, scrolling, or keyboard/touch traversal. |
| Unit/source assertions present | src/components/motion/AppShellMotion.test.ts, src/lib/motion.test.ts, and src/lib/motionPreference.test.ts assert the implementation choices and reduced-motion result. | They were not run in this audit and do not substitute for Canvas visual/behavior evidence. |

## Closure gaps that remain phase-03-specific

1. **Evidence gate remains open.** The phase-03 checklist is entirely unchecked and all three inventory rows remain pending-evidence; no dark/light visual comparison or interaction evidence ties current shell motion to the three Canvas references.
2. **Reduced-motion acceptance is only partially evidenced.** The shared implementation disables or collapses motion, but no evidence demonstrates the required destination and focus behavior when a shell transition, overlay, or mobile navigation is interrupted or reduced. The MotionStoryboard map explicitly requires immediate/fallback behavior without waiting for animation.
3. **Mobile acceptance is unclosed.** Existing nav and safe-area toast placement are useful implementation evidence, but not proof of the AnimeMobile 390×844 shell contract: CTA clearance, scroll containment, icon/label focus behavior, and account/language/settings routes require phase-03 fixture evidence.
4. **System feedback and appearance are outside these three board snippets but still phase 03.** The accepted phase document requires real loading, offline/sync, expired-session, error, undo/retry recovery and direct theme/system/Lumi/sound behavior. This audit found motion plumbing, not a board-by-board pass for those states.
5. **No shared-element claim.** AppShellMotion’s generic stage animation cannot close the Today→Review shared-card sequence. Retain explicit 05.2 validation for card identity, shell recession, focus transfer, real settled data, and reduced motion.

## Required later-state carry-forward

- Preserve the AnimeMotion reward sequence as real-event rendering only: no timer-derived XP or tier; validate the 04.4/05.6 card/session contracts.
- Preserve MotionStoryboard’s edit side-sheet and recap next-action states for 04.5 and 05.6, including focus return and data settlement.
- Preserve all seven AnimeMobile variants in their assigned flow phases. Phase 03 closes only the mobile shell foundation around them.

Status: DONE_WITH_CONCERNS
Summary: Shared shell motion, user/OS reduction, generic overlay entrances, and mobile navigation primitives exist in source, but phase 03 cannot close the three board rows because inventory and checklist evidence remain pending. The audit preserves every card, session, onboarding, and commercial state under its accepted later owner.
Concerns/Blockers: No visual, device-size, or runtime validation was allowed for this review; current unit tests were inspected but not executed.
