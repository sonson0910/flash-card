# Phase 03 shell navigation work

## Owned scope and source boards

Implemented the Phase 03.1, 03.2, and 03.5 navigation scope in `src/components/shell/{DesktopNavigation,FloatingMobileNav,LanguageMenu,LibraryManagementMenu,ThemeMenu,CourseSwitcherSlot,SkipToContentLink,AppFooter}.tsx` and `src/styles/shell.css`. Updated direct tests for DesktopNavigation, FloatingMobileNav, ThemeMenu, and CourseSwitcherSlot. AppFooter and SkipToContentLink behavior remain intact.

Canvas references checked:

- `docs/design/sonflash-redesign/canvas/src/partials.html`, `@@NAV`: classic header geometry is 76px with 56px horizontal padding and 28px item gap; brand mark is 30px; nav actions include quick theme toggle, streak, level, and account. `tokens.js` supplies the classic dark/light nav active and idle colors.
- `docs/design/sonflash-redesign/canvas/src/AnimeMobile.dc.html`, nav block and `$preview` (390×844): full-width 78px, four-column rail with 8px/16px/20px padding; it is shown on review/today/recap. `anime-tokens.js` provides Crystal active gradients, light/dark tab-bar backgrounds, and the Today/Goals/Collection/Friends labels.
- `AnimeSystem.dc.html`, `SystemStates.dc.html`, `AnimeSettings.dc.html`, plus `anime-tokens.js`: checked Crystal typography, panels, and four-theme variants. These boards do not define replacement account or language flows; the existing real menu actions remain the behavior source.

## Changes and behavior

- Desktop uses a `header` containing the `nav.app-navigation` expected by shell motion. Classic uses the source 76px outer header; the child nav measures 75px because its 1px border is outside the content box. Crystal remains 78px without a bottom border. The source quick-toggle is 40px; app action targets use 45px to preserve the shared minimum-height guard.
- Rebuilt the mobile nav as a fixed, full-width bottom rail instead of the old inset floating capsule. It uses four equal columns, Canvas-like Crystal skew/active treatments, a classic theme treatment, and bottom safe-area padding. It remains hidden on practice and landing routes; ordinary Today, Paths, library, progress, and settings views retain navigation.
- Removed the `quickOnly` path from ThemeMenu use. The header now exposes both quick mode toggle and the four-choice theme picker, including the existing appearance-settings action. Language/theme popovers retain keyboard navigation and focus restoration; language/account/theme panels are constrained to viewport height and scroll internally.
- Account menu continues to call the real sign-in/out, export, clear, settings, account-data, and zen-mode actions. Its account image/initials and sync label still come from runtime identity/status props.
- Streak, level, and XP indicators render only when real finite runtime values are supplied. There are no shell defaults that present `0` streak, `Lv 1`, or sample XP as learner data.
- `CourseSwitcherSlot` renders only authenticated, supplied UI; the fabricated `English ← Tiếng Việt` fallback is removed. `DesktopNavigation` now accepts optional `courseSwitcher?: ReactNode` as the integration seam.
- Skip-to-content continues to target `#learning-workspace`. The footer sync strip stays hidden because the Canvas shell has no footer; its live sync announcement remains in the primary nav.

## Explicit route/board exceptions

- Crystal AnimeMobile source calls the catalog tab “Goals”; Phase 03 keeps “Paths” on both desktop and mobile while the callback opens the real `catalog` destination. Phase 10 task 10.2 must wire the real Goals destination/data and change both labels with that route; do not treat a renamed current route as completion. Desktop uses the existing `shell.nav.paths` translation ID.
- Crystal AnimeMobile calls the last tab “Friends”; this app still has a real Progress callback. It remains “Progress” until required task 15.5 in `phase-15-commercial-and-motivation-workflows.md` supplies the Friends destination/action. Phase 03 does not relabel Progress as Friends.
- Crystal AnimeMobile says “Collection”; the existing library route is wired and may keep that label.
- Header metrics use the runtime `streak`, `level`, and `xp`; Canvas specimen values are not copied. The course switcher remains absent until Phase 10 task 10.1 supplies real current-course data and an actual change action.

## Verification and visual evidence

- Focused command: `npx vitest run src/components/shell/AppNavigation.test.tsx src/components/shell/FloatingMobileNav.test.tsx src/components/shell/ThemeMenu.test.tsx src/components/shell/CourseSwitcherSlot.test.tsx src/components/shell/LanguageMenu.test.tsx src/components/shell/LibraryManagementMenu.test.tsx src/components/shell/SkipToContentLink.test.tsx src/components/shell/AppFooter.test.tsx` — **PASS**, 8 files / 14 tests.
- Follow-up after the Crystal label alignment: `npm exec vitest run src/components/shell/AppNavigation.test.tsx` — **PASS**, including a Crystal-specific assertion that the catalog item is “Paths” and the obsolete “Goals” string is absent.
- `npm run lint -- --pretty false` (project `tsc --noEmit`) — **FAIL**, with existing errors outside this lane: `functions/test/legacySharedDeckMigration.test.ts:310,320`, `src/app/AppRuntime.tsx:234` (`AppFeedbackProps.sessionLost`), and `src/components/AppOverlays.test.tsx:37,130,164`. It reported no errors in the owned shell components/tests.
- Direct `npx eslint ...` is not a configured check here: ESLint 10 could not find an `eslint.config.*` file. No build, extraction, or new server was run.
- Root captured in-progress shell images under `plans/260925-1005-claude-design-workflow-recovery/evidence/in-progress-nav-*`. Those captures predate the final Crystal Paths label and missing-metrics change; final visual verdict remains pending a recapture/side-by-side Canvas comparison at 1440×900 and 390×844 in all four themes, plus the 360px pseudo-locale check. Root owns the shared dev server/capture.

Status: **DONE_WITH_CONCERNS**

Summary: Rebuilt desktop/mobile shell geometry and menu availability in the assigned files, preserved real runtime actions/data, and removed fabricated course/metric defaults. Focused shell tests pass; route-specific Canvas deltas and remaining visual proof are recorded above.

Concerns/Blockers: Final screenshot comparison is pending. Phase 10 must provide the real course switcher/Goals destination; required task 15.5 must provide Friends route behavior. Project-wide TypeScript check currently fails in unrelated shared files listed above.
