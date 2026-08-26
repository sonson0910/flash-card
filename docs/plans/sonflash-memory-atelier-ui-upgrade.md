# Implementation Plan: SonFlash Memory Atelier UI Upgrade

## Overview

Implement the approved [Memory Atelier specification](../specs/sonflash-memory-atelier-ui-upgrade.md) as ten rollback-friendly slices. The work preserves application behavior and data boundaries while upgrading the shared material language, core learning hierarchy, supporting views, focused study experience, and landing page.

The implementation uses one writer. Every slice starts with the smallest relevant failing assertion when markup or interaction changes, then updates presentation code, runs its targeted checks, and captures the affected light/dark desktop/mobile states before moving on.

## Assumptions

1. The target is the current repository UI on `main`, not the unavailable dirty workspace described in the prior handoff.
2. The redesign preserves all routes, navigation labels, feature availability, data behavior, Auth/App Check boundaries, and landing video content.
3. Existing React, Tailwind, CSS variables, Lucide, GSAP, Radix, and Playwright capabilities are sufficient. No dependency will be added.
4. Product surfaces use the existing design system. `design-taste-frontend` governs only the landing/marketing surface and the visual continuity into the app.
5. Implementation does not include deployment.

## Architecture Decisions

- **Targeted evolution, not replacement:** refine existing presentation components and semantic tokens instead of introducing a second design system.
- **Today is the reference composition:** establish the primary-action hierarchy there, then apply the same type, spacing, material, and utility rules to other product views.
- **One semantic accent:** cyan is the brand/action color. Amber, emerald, and rose remain semantic feedback colors only.
- **Fewer surface levels:** one elevated focus panel may contain low-elevation grouped content, but nested glass-on-glass styling is removed.
- **Existing motion language only:** use current GSAP helpers and CSS transitions; animate transform/opacity; preserve reduced-motion and data-saver behavior.
- **Real product evidence on landing:** replace the hand-built sample card preview with a screenshot captured from the actual Study/Flashcard UI or a direct reuse of an existing real visual asset. Do not build a fake dashboard preview.
- **Test behavior, inspect aesthetics:** automate semantic structure, responsive bounds, accessibility, and motion invariants; verify composition and polish with browser screenshots.

## Dependency Graph

```text
Baseline evidence
    |
    v
Shared tokens + shell
    |
    v
Today reference composition
    |
    +--> Paths
    +--> Progress
    +--> Vocabulary overview/tools
             |
             v
        Flashcard + Study
    |
    v
Landing semantics/copy
    |
    v
Landing visual recomposition
    |
    v
Cross-view pre-flight and final review
```

## Phase 0: Evidence and Safety

### Task 0: Freeze the visual and engineering baseline

**Description:** Record the exact source state and regenerate disposable runtime evidence before any presentation edit. Keep all existing user files and unrelated changes untouched.

**Acceptance criteria:**

- [ ] Record HEAD, branch, dirty files, current build/bundle output, and the expected local App Check/device API errors.
- [ ] Capture Landing, Today, Paths, Vocabulary, Progress, Study front/back, and practice dialog at 1440x900 and 390x844 in light and dark where applicable.
- [ ] Store screenshots under ignored test output or `/tmp`; do not commit runtime screenshots or user data.

**Verification:**

- [ ] `git status --short --branch`
- [ ] `npm run build && npm run verify:bundle`
- [ ] `npx playwright test e2e/accessibility.spec.ts e2e/app-shell-remediation.spec.ts e2e/motion-remediation.spec.ts --project=chromium`

**Dependencies:** None

**Files likely touched:** None

**Estimated scope:** XS

## Phase 1: Shared Product Language

### Task 1: Recalibrate semantic tokens and flatten the shell

**Description:** Establish the cold-mineral light/dark token hierarchy and reduce nested chrome in desktop and mobile navigation without changing labels, routes, control availability, or focus behavior.

**Acceptance criteria:**

- [ ] Navigation reads as one shell layer with one active state; sync, management, theme, and count remain visually secondary.
- [ ] Light/dark tokens preserve WCAG AA contrast and the official cyan identity.
- [ ] Header controls remain on-screen and at least 44px tall at 320, 390, 768, 800, 920, 1024, and 1440px.

**Verification:**

- [ ] Test first, then pass: `npx vitest run src/themeTokens.test.ts src/components/shell/AppNavigation.test.tsx src/components/shell/FloatingMobileNav.test.tsx`
- [ ] `npx playwright test e2e/app-shell-remediation.spec.ts --project=chromium`
- [ ] Manual: compare light/dark shell screenshots at 390x844 and 1440x900.

**Dependencies:** Task 0

**Files likely touched:**

- `src/index.css`
- `src/themeTokens.test.ts`
- `src/components/shell/DesktopNavigation.tsx`
- `src/components/shell/FloatingMobileNav.tsx`
- `e2e/app-shell-remediation.spec.ts`

**Estimated scope:** M

### Task 2: Make Today the reference learning composition

**Description:** Strengthen the daily action, express due -> strengthen -> first look as one sequence, and reduce visible practice choices to at most three contextual shortcuts while retaining the complete catalogue in the existing dialog.

**Acceptance criteria:**

- [ ] The primary daily action is the first dominant control at desktop and mobile sizes.
- [ ] The plan reads as one ordered journey rather than three equal metric cards.
- [ ] Today exposes no more than three direct practice shortcuts; every existing practice mode remains reachable.

**Verification:**

- [ ] Test first, then pass: `npx vitest run src/features/dailyLearning/DailyLearningScreens.test.tsx`
- [ ] `npx playwright test e2e/app-shell-remediation.spec.ts --project=chromium --grep "Today"`
- [ ] Manual: populated, short, empty, offline, and error states at 390x844 and 1440x900 in both themes.

**Dependencies:** Task 1

**Files likely touched:**

- `src/features/dailyLearning/TodayScreen.tsx`
- `src/features/dailyLearning/DailyLearningScreens.test.tsx`
- `src/components/AppOverlays.tsx`
- `e2e/app-shell-remediation.spec.ts`

**Estimated scope:** M

## Checkpoint A: Shell and Today

- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm run verify:bundle`
- [ ] No new axe serious/critical violations.
- [ ] Human screenshot review before propagating the language to the remaining views.

## Phase 2: Supporting Learning Spaces

### Task 3: Turn Paths into a connected learning journey

**Description:** Recompose the personal-path summary as one connected sequence with visible progression while preserving counts, copy meaning, actions, personal-library boundaries, and all loading/error/unavailable states.

**Acceptance criteria:**

- [ ] Review due, keep learning, and mastered read as connected stages rather than independent cards.
- [ ] Continue review remains primary and Open vocabulary remains secondary.
- [ ] Mobile presentation collapses to a readable vertical path without overflow or obscured actions.

**Verification:**

- [ ] Test first, then pass: `npx vitest run src/features/catalogWorkspace/CatalogScreen.test.tsx`
- [ ] `npx playwright test e2e/catalog-workspace.spec.ts --project=chromium`
- [ ] Manual: personal mode, loading, empty, unavailable, error, and populated catalogue states.

**Dependencies:** Task 2

**Files likely touched:**

- `src/features/catalogWorkspace/CatalogScreen.tsx`
- `src/features/catalogWorkspace/CatalogScreen.test.tsx`
- `e2e/catalog-workspace.spec.ts`

**Estimated scope:** M

### Task 4: Make Progress read as a learning narrative

**Description:** Preserve the actionable next step while demoting raw counts into supporting evidence and tightening the transition from summary to detailed charts.

**Acceptance criteria:**

- [ ] Empty, due, and clear states each expose one unambiguous next action or status.
- [ ] Reviewed, mastered, and due-today values support the story instead of competing as three hero cards.
- [ ] Existing charts remain lazy, legible, and unchanged in meaning.

**Verification:**

- [ ] Test first, then pass: `npx vitest run src/features/dailyLearning/DailyLearningScreens.test.tsx src/features/dailyLearning/ProgressWorkspace.test.tsx`
- [ ] `npx playwright test e2e/app-shell-remediation.spec.ts --project=chromium --grep "Progress"`
- [ ] Manual: empty, due, clear, loading, offline, and error states in both themes.

**Dependencies:** Task 2

**Files likely touched:**

- `src/features/dailyLearning/ProgressScreen.tsx`
- `src/features/dailyLearning/DailyLearningScreens.test.tsx`
- `src/features/dailyLearning/ProgressWorkspace.test.tsx`

**Estimated scope:** S

### Task 5: Rebalance the Vocabulary overview and workspace

**Description:** Make the vocabulary collection the visual focus, reduce competition from overview metrics and tools, and preserve the mobile rule that the card grid precedes secondary tools.

**Acceptance criteria:**

- [ ] Hero copy and the primary review action remain clear without four equal summary tiles dominating the viewport.
- [ ] The card grid is the richest region and appears before tools on mobile.
- [ ] Create, share, study, filter, pagination, loading, empty, and error behavior remain intact.

**Verification:**

- [ ] Test first, then pass: `npx vitest run src/features/library/LibraryScreen.test.tsx src/features/library/LibraryCardGrid.test.tsx`
- [ ] `npx playwright test e2e/library-remediation.spec.ts e2e/app-shell-remediation.spec.ts --project=chromium --grep "library"`
- [ ] Manual: populated and empty library at 320, 390, 1024, and 1440px in both themes.

**Dependencies:** Tasks 1 and 2

**Files likely touched:**

- `src/features/library/LibraryOverview.tsx`
- `src/features/library/LibraryScreen.tsx`
- `src/features/library/LibraryCardGrid.tsx`
- `src/features/library/LibraryScreen.test.tsx`
- `e2e/library-remediation.spec.ts`

**Estimated scope:** M

### Task 6: Simplify Vocabulary tools without reducing capability

**Description:** Tighten the create/filter/tool hierarchy, keeping rare actions quiet and every existing operation available and accessible.

**Acceptance criteria:**

- [ ] Smart-card creation is visually primary inside tools; import, dialogue, scan, filters, decks, and destructive management remain secondary.
- [ ] Labels, input names/order, validation, and file handling remain unchanged.
- [ ] Mobile filters remain reachable from the grid shortcut and return focus correctly.

**Verification:**

- [ ] Test first, then pass: `npx vitest run src/features/library/LibraryTools.test.tsx src/features/library/LibraryScreen.test.tsx`
- [ ] `npx playwright test e2e/library-remediation.spec.ts e2e/app-shell-remediation.spec.ts --project=chromium --grep "filter|settings|library"`
- [ ] Manual: create, filters, deck list, import control, and management menu at 390x844 and 1440x900.

**Dependencies:** Task 5

**Files likely touched:**

- `src/features/library/LibraryTools.tsx`
- `src/features/library/LibraryTools.test.tsx`
- `src/features/library/LibraryScreen.tsx`
- `e2e/library-remediation.spec.ts`

**Estimated scope:** M

## Checkpoint B: Product Views

- [ ] Targeted tests for Today, Paths, Vocabulary, and Progress pass.
- [ ] `npm run lint && npm run build && npm run verify:bundle`
- [ ] Desktop/mobile screenshots show one shared grammar with distinct compositions.
- [ ] No route, URL-state, focus, touch-target, loading, empty, offline, or error-state regression.

## Phase 3: Focused Learning Experience

### Task 7: Refine Flashcard and Study focus mode

**Description:** Make the flashcard the richest product object and improve the front/reveal/rating rhythm without altering scheduling, shortcuts, translation, audio, image, mnemonic, or review behavior.

**Acceptance criteria:**

- [ ] Front, revealed meaning, supporting explanation, memory hook, and rating controls have a clear reading order.
- [ ] Rating controls remain visible after reveal through the existing auto-scroll behavior at desktop and mobile sizes.
- [ ] All keyboard shortcuts, focus transitions, audio controls, and reduced-motion flip behavior remain intact.

**Verification:**

- [ ] Test first, then pass: `npx vitest run src/components/Flashcard.test.tsx src/features/practice/practiceViews.test.tsx src/lib/motion.test.ts`
- [ ] `npx playwright test e2e/flashcard-remediation.spec.ts e2e/motion-remediation.spec.ts --project=chromium`
- [ ] Manual: front/back, long text, missing media, Vietnamese explanation, mnemonic, rating, and mobile scroll states.

**Dependencies:** Tasks 1, 5, and 6

**Files likely touched:**

- `src/components/Flashcard.tsx`
- `src/components/Flashcard.test.tsx`
- `src/features/practice/StudyView.tsx`
- `src/features/practice/practiceViews.test.tsx`
- `e2e/flashcard-remediation.spec.ts`

**Estimated scope:** M

## Phase 4: Landing Continuity

### Task 8: Correct landing semantics, claims, and CTA contract

**Description:** Fix the verified landing accessibility failures and replace unsupported or absolute claims before visual recomposition, so the redesigned surface starts from trustworthy content.

**Acceptance criteria:**

- [ ] All content is inside appropriate header/main/footer landmarks with sequential headings and named icon-only controls.
- [ ] Unsupported counts, percentages, retention guarantees, and absolute preservation claims are removed or replaced with verified capability copy.
- [ ] Every app-entry CTA uses the canonical label `Start learning`; `#features` and `#methods` remain stable.

**Verification:**

- [ ] Add the failing landing assertions first, then pass: `npx playwright test e2e/accessibility.spec.ts --project=chromium --grep "landing"`
- [ ] Automated copy guard confirms forbidden claims and duplicate entry labels are absent.
- [ ] Manual keyboard and screen-reader-tree inspection of desktop and mobile navigation.

**Dependencies:** Task 0; may be implemented after Task 2 to use the final product voice.

**Files likely touched:**

- `src/features/landing/LandingPage.tsx`
- `e2e/accessibility.spec.ts`
- `docs/design/sonflash-redesign/product-facts.md`

**Estimated scope:** M

### Task 9: Recompose landing as the cinematic entrance to Memory Atelier

**Description:** Preserve the train-window video hero and atmosphere selector while replacing repeated equal feature cards and the fake sample card with an asymmetric, product-grounded story that hands off visually to the application.

**Acceptance criteria:**

- [ ] Hero fits the initial viewport with one headline, one concise value statement, one primary CTA, and the existing atmosphere control.
- [ ] Feature and method sections use distinct compositions, one cyan accent, consistent radius roles, and no repeated equal-card grid.
- [ ] The product preview is a real local screenshot/asset captured from the current app, not a hand-built fake UI; mobile uses an explicit single-column fallback.

**Verification:**

- [ ] `npx playwright test e2e/accessibility.spec.ts e2e/motion-remediation.spec.ts --project=chromium --grep "landing|motion"`
- [ ] Manual light-independent landing screenshots at 390x844, 768x900, 1024x900, and 1440x900 with normal and reduced motion.
- [ ] Verify CTA text does not wrap, navigation stays one line on desktop, no horizontal overflow, and video fallback remains readable.

**Dependencies:** Tasks 1, 2, 7, and 8

**Files likely touched:**

- `src/features/landing/LandingPage.tsx`
- `src/index.css`
- `public/marketing/sonflash-study-preview.png`
- `e2e/accessibility.spec.ts`
- `e2e/motion-remediation.spec.ts`

**Estimated scope:** M

## Checkpoint C: Complete Experience

- [ ] Landing and app read as one brand when navigating through `Start learning`.
- [ ] Landing pre-flight passes: landmarks, heading order, accessible names, one CTA label, one accent, consistent radii, no unsupported claims, no em dash, no duplicate layout family.
- [ ] Study pre-flight passes: focus, shortcuts, reveal, auto-scroll, rating, long content, and reduced motion.
- [ ] `npm run lint && npm run build && npm run verify:bundle`

## Phase 5: Final Integration

### Task 10: Run the cross-view pre-flight and resolve only substantiated regressions

**Description:** Inspect the complete diff and run the full targeted UI matrix. Fix only failures attributable to this redesign; record unrelated pre-existing warnings rather than widening scope.

**Acceptance criteria:**

- [ ] All spec success criteria are checked against runtime evidence.
- [ ] Light/dark and 320/390/768/1024/1440 layouts have no overflow, clipped controls, hidden primary actions, or navigation collisions.
- [ ] Final diff contains no domain, auth, sync, data, dependency, or production configuration changes.

**Verification:**

- [ ] `git diff --check && git diff --stat && git diff`
- [ ] `npm run lint`
- [ ] `npx vitest run src/themeTokens.test.ts src/components/shell/AppNavigation.test.tsx src/components/shell/FloatingMobileNav.test.tsx src/features/dailyLearning/DailyLearningScreens.test.tsx src/features/dailyLearning/ProgressWorkspace.test.tsx src/features/catalogWorkspace/CatalogScreen.test.tsx src/features/library/LibraryScreen.test.tsx src/features/library/LibraryTools.test.tsx src/components/Flashcard.test.tsx src/features/practice/practiceViews.test.tsx src/lib/motion.test.ts`
- [ ] `npm run build && npm run verify:bundle`
- [ ] `npx playwright test e2e/accessibility.spec.ts e2e/app-shell-remediation.spec.ts e2e/catalog-workspace.spec.ts e2e/library-remediation.spec.ts e2e/flashcard-remediation.spec.ts e2e/motion-remediation.spec.ts --project=chromium`
- [ ] Manual pre-flight: screenshots, console, accessibility tree, focus order, responsive bounds, normal/reduced motion, and landing-to-app transition.

**Dependencies:** Tasks 1-9

**Files likely touched:** Only files with verified regressions from Tasks 1-9

**Estimated scope:** S

## Commit Strategy

- Stage explicit task-owned paths only. Never stage `.env.example`, `Archive.zip`, agent metadata, handoff files, or unrelated user changes.
- Use one local commit per completed task after its verification passes.
- Do not push, open a PR, or deploy without a separate explicit request.
- If a slice fails its checkpoint, revert only that slice's explicit paths or fix forward before starting the next task.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---:|---|
| Shared CSS changes unintentionally alter every view | High | Change semantic tokens first, keep task-owned selectors narrow, screenshot after each wave, and retain token contract tests. |
| Visual polish weakens accessibility | High | Write semantic/a11y assertions first, preserve 44px targets and focus rules, run axe and keyboard checks at every checkpoint. |
| Practice simplification hides a mode | High | Test the complete set of existing modes remains reachable through direct shortcuts plus the modal. |
| Landing becomes beautiful but slower | High | Keep one active video, preserve lazy boundaries, add no dependency, and enforce the existing bundle budget. |
| Landing and app remain stylistically disconnected | Medium | Implement shell/Today first and use their final control, type, radius, and accent rules as landing inputs. |
| Mobile bottom navigation obscures content | Medium | Verify safe-area spacing and primary-action visibility at 320x480, 390x844, and 667x320. |
| Large Flashcard content clips after reveal | Medium | Preserve auto-scroll and test long Vietnamese explanation/mnemonic states before visual sign-off. |
| Dirty worktree causes unrelated files to be committed | High | Inspect status before every slice and stage explicit paths only. |
| Existing local App Check 403 or device API 409 is misclassified as a UI regression | Low | Record it in Task 0 and compare exact request URLs instead of requiring a globally clean local console. |

## Parallelization Decision

Do not use parallel writers. Tasks share `src/index.css`, shell grammar, screenshots, and visual decisions, so parallel edits would increase integration risk. Paths and Progress are logically independent after Task 2, but the expected latency benefit is smaller than the consistency cost. Main remains the single writer and integration owner.

## Definition of Done

- [ ] Tasks 0-10 and Checkpoints A-C pass.
- [ ] The approved spec has no unmet success criterion.
- [ ] Before/after evidence exists for all principal views.
- [ ] The final diff is reviewed for behavior, accessibility, performance, and visual consistency.
- [ ] No unrelated user change is modified or committed.
- [ ] No deployment has occurred.

## Open Questions

None. Human approval of this plan is the remaining gate before Task 0 and implementation.
