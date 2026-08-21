# Comprehensive Project Remediation Plan

Date: 2026-08-21
Project: SonFlash / LingoFlash
Workspace: `/Users/sonson/Documents/code/person/lingoflash-2`
Initial reviewed HEAD: `c494d39421386d70ea8aec675323860b1dadf2a6`
Status: **Local Phase 0–12 remediation closure recorded; Phase 5/12 exact-SHA CI proof remains blocked pending authorization**

## Purpose of this document

This file is the durable handoff for the full-project audit and remediation plan.
It is intentionally self-contained so a future AI session can resume without
depending on conversation history or compacted context.

Before doing any implementation work, the next agent must:

1. Read `AGENTS.md`, `/Users/sonson/.codex/SKILL_ROUTER.md` and
   `/Users/sonson/.codex/CODEBASE_MEMORY.md`.
2. Read this file completely.
3. Inspect `git status --short`, because the worktree was being changed by another
   process during the audit.
4. Do not overwrite, revert, stash, commit or delete user changes without explicit
   permission.
5. Start at Phase 0 and execute only one phase at a time.
6. After each phase, update the execution ledger in this file, report the diff and
   test evidence, then wait for human approval before continuing.

## Executive assessment

No confirmed P0/Critical defect or exploitable security vulnerability was found.
The project has strong automated test coverage and unusually careful data-integrity
contracts, but the reviewed snapshot is not ready for an unconditional production
claim because it still has visible correctness defects, an extension cleanup race,
misleading product copy and no current-revision Rules/CI proof.

Indicative assessment from the audit:

| Area | Assessment |
| --- | ---: |
| Test engineering | 8.5/10 |
| Security | 8/10 |
| Architecture | 7/10 |
| Correctness | 6.5/10 |
| UX/accessibility | 6.5/10 |
| Release readiness | 5.5/10 |
| Overall | 7/10 |

These numbers are prioritization aids, not release evidence.

## Audit baseline

The following evidence was collected on 2026-08-21 against the dirty worktree
visible during the review:

| Gate | Result |
| --- | --- |
| Root TypeScript lint | Passed |
| Root Vitest | 189 files, 1,514/1,514 tests passed |
| Functions lint | Passed |
| Functions Vitest | 75 passed, 2 integration tests skipped |
| Browser extension | 74/74 tests passed |
| Production build | Passed |
| Secret scan | Passed |
| Bundle gate | Passed |
| Initial JavaScript | 285,455 B gzip / 290,000 B budget |
| Total JavaScript | 640,554 B gzip / 700,000 B budget |
| Root + Functions npm audit | Zero configured high-severity vulnerabilities |
| `git diff --check` | Passed |
| Chromium/browser run | 51 cases passed before the Firefox section |
| Firefox on local macOS | Browser launch blocked by sandbox/SWGL; tests did not reach app assertions |
| Firestore Rules emulator | Did not run because Java was unavailable |
| GitHub Actions for reviewed HEAD | No run found for `c494d394...` |

The local Firefox error was:

```text
sandbox_extension_issue_file_to_process ... Operation not permitted
RenderCompositorSWGL failed mapping default framebuffer
```

This is host/browser evidence, not twelve application regressions. The interrupted
run recorded 12 Firefox launch timeouts, 4 interrupted cases, 2 skips, 84 not run
and 51 passes before termination.

The Rules source and test hashes differ from the retained 2026-08-12 evidence, so
that historical 47/47 result must not be used as proof for the current revision.

Semgrep scanned 575 files with 261 rules and emitted 11 heuristic findings plus
several timeouts. Manual triage did not confirm an exploitable issue: workflow
inputs are bounded before use, and relevant dynamic regular expressions either
use constants or escape input. This does not replace current Rules and CI proof.

## Confirmed findings

### P1 — Required before release

#### P1.1 Landing Quick Start discards the entered word

- State exists at [`LandingPage.tsx`](../../src/features/landing/LandingPage.tsx)
  around line 97.
- `handleDemoSubmit` only calls `onEnterApp()` around lines 149–152.
- The form promises “Enter a word to explore” around lines 304–323.
- The entered value is neither persisted nor passed to Card Intake.

Required outcome: submitting a non-empty word opens the Library/Card Intake flow
with that word prefilled, without automatically spending an AI request.

#### P1.2 Production mobile navigation omits Paths

- `App.tsx` renders `FloatingMobileNav` around line 268.
- `FloatingMobileNav` exposes Home/Today/Library/Progress, not Paths.
- `MobileNavigation` exposes Today/Paths/Vocabulary/Progress but has no production
  caller.
- `AppNavigation.test.tsx` tests the orphan module and therefore gives false
  confidence.
- ADR-003 specifies Today/Paths/Vocabulary/Progress as the final mobile IA.

Required outcome: one canonical production navigation and one matching test
surface.

#### P1.3 Extension cleanup can report failure after success

- `extensions/lingoflash/background-core.js` runs `removeJob`, `clearAlarm` and
  `closeTab` concurrently in `cleanup()` around lines 39–46.
- `tabs.onRemoved` reads remaining jobs and treats a worker tab close as failure
  around lines 316–334.
- If tab removal wins before storage removal, a completed Quick Add can emit a
  false error.
- The test mock at `extensions/lingoflash/tests/background.node.mjs` around line 98
  does not emit `onRemoved` when `tabs.remove` is called, so the race is uncovered
  despite the extension suite passing.

Required outcome: a job emits exactly one terminal status and intentional tab
closure cannot be mistaken for user cancellation.

#### P1.4 Product copy exceeds implementation or available evidence

Current landing claims include:

- “60,000+ Deep Memory Cards” despite no published catalog artifact.
- “AI-generated vivid illustrations” while the implementation performs bounded
  provider/Wikipedia/Pexels/Unsplash image search.
- “Real-time word-by-word pronunciation accuracy” while scoring compares speech
  transcripts using character similarity, word coverage and recognizer confidence.
- “B2 • Oxford” without source/licensing evidence in the repository.

Relevant sources:

- `src/features/landing/LandingPage.tsx`
- `src/lib/speechMatch.ts`
- `src/components/flashcard/SpeechMatchFeedback.tsx`
- `src/lib/images.ts`
- `docs/reviews/comprehensive-upgrade-closure-2026-08-10.md`

Required outcome: all user-facing claims are measurable and supported by current
runtime behavior and content rights.

#### P1.5 Current-revision production proof is missing

- `npm run test:rules` fails locally because Java is unavailable.
- `.github/workflows/quality.yml` correctly configures Temurin Java 21, but no
  Quality run was found for reviewed HEAD `c494d394...`.
- Current Rules/test hashes differ from the latest retained evidence.

Required outcome: Rules emulator and full Quality workflow pass for one clean,
immutable SHA before any production approval.

### P2 — Important improvements

#### P2.1 Landing sample speaker is inert and unnamed

The sample-card speaker button in `LandingPage.tsx` around line 560 has no click
handler, `aria-label` or useful title. It should either become a real audio control
or stop being rendered as a button.

#### P2.2 Card Intake and Library Replica duplicate convergence orchestration

Both modules currently coordinate repository create-if-absent, mirror state,
Device Store data, stale cleanup and acknowledge-last semantics:

- `src/features/intake/cardIntakePipeline.ts`
- `src/features/librarySession/libraryReplica.ts`

The desired architecture is one deep Library Replica write seam. Card Intake keeps
validation, generation, optimistic UI and XP compensation; Library Replica owns
convergence and persistence ordering. ADR-006 must remain intact.

#### P2.3 Catalog has parallel runtime adapters and reverse dependency direction

- `CatalogWorkspace.tsx` imports `appDependencies`, producing `features -> app`.
- It also creates a default runtime through `catalogWorkspaceService.ts`.
- `appDependencies.catalog.install/readPage` forwards to `src/app/catalogRuntime.ts`
  but has no production consumer after the workspace creates its own runtime.

Desired outcome: one injected `CatalogWorkspaceRuntimePort` owned by composition.

#### P2.4 Multi-script direction policy is not wired to runtime

`scriptPresentation()` returns canonical `lang` plus `dir`, but production Lesson,
Placement and Catalog presentation currently render only `lang`. Phase-6 evidence
must reflect actual runtime behavior, especially for Arabic, Persian, Hebrew and
Urdu.

#### P2.5 Architecture analyzer misses direction and reachability

The analyzer currently detects cycles, presentation-to-infrastructure imports and
configured line limits. It does not reject `features -> app`, nor does it report
production-orphan modules such as the unused mobile navigation.

#### P2.6 Bundle passes with insufficient headroom

Initial JavaScript is 285,455 B gzip against a 290,000 B budget, about 1.6%
headroom. Firebase is a 135.16 KB gzip chunk and is module-preloaded even for the
landing page because App imports/initializes library runtime before returning the
landing branch.

Desired outcome: at least 10% initial-JS headroom without increasing the budget.

#### P2.7 Dead Landing contract

`onOpenProgress` is declared and supplied by App but is not destructured or used by
LandingPage. It must either be wired to a real control or removed.

## Explicit non-goals

Do not perform the following as part of this plan unless a separate authorization
is given:

- Production deploy, traffic promotion or rollback.
- Firestore migration or destructive cleanup.
- Catalog publication without rights and human-review evidence.
- Secret rotation or billing changes.
- Removal of Shared Device Store; it is a development adapter by design.
- Mechanical splitting or deletion of `catalogCache.ts`; it is a deep atomic cache
  module supported by ADR-002.
- Removal of legacy compatibility bridges before their ADR revisit triggers.
- Raising bundle budgets to make a regression pass.

## Architecture decisions for implementation

1. **Quick Start:** keep the word in session/navigation state, not the URL; prefill
   intake but do not auto-call AI.
2. **Mobile navigation:** retain the currently shipped `FloatingMobileNav`, update
   it to Today/Paths/Vocabulary/Progress and delete the unused competing module.
3. **Product truth:** remove unsupported claims until evidence exists; do not invent
   substitute metrics.
4. **Catalog:** composition injects one runtime port; features do not import app.
5. **Library convergence:** Library Replica becomes the sole intent-level write
   seam; repository transaction semantics remain those of ADR-006.
6. **Multi-script:** apply `lang` and `dir` at content containers, not the whole app
   shell.
7. **Performance:** lazy-bootstrap Firebase/library runtime after leaving landing;
   target no more than 261,000 B initial JS gzip for at least 10% headroom.
8. **Evidence:** release claims always bind to an exact clean SHA.

## Execution protocol

Every phase follows the same workflow:

1. Confirm the phase scope and current worktree.
2. Write or strengthen a failing test first.
3. Implement the smallest change that makes the test pass.
4. Refactor only inside the approved phase scope.
5. Run focused verification.
6. Run the phase checkpoint gates.
7. Update this document's execution ledger.
8. Report changed files, test evidence and remaining risks.
9. Stop and wait for human approval before the next phase.

No commit or push is implied by approval to edit. Commit/push requires explicit
authorization.

## Dependency graph

```text
Phase 0: Stabilize snapshot
    |
    +-- Phase 1: Extension cleanup race
    +-- Phase 2: Landing Quick Start
    +-- Phase 3: Landing truth + accessibility
    +-- Phase 4: Mobile navigation
              |
              +-- P1 checkpoint
                     |
                     +-- Phase 5: Current-revision release proof
                     +-- Phase 6: Catalog runtime
                     |      +-- Phase 7: Architecture guard
                     +-- Phase 8: Library Replica contract
                     |      +-- Phase 9: Migrate Card Intake
                     +-- Phase 10: Multi-script runtime
                     +-- Phase 11: Bundle/lazy bootstrap
                                |
                                +-- Phase 12: Final verification
```

## Phase 0 — Stabilize the worktree and baseline

**Status:** Blocked — clean baseline and exact-SHA checkpoint pending
**Estimated scope:** Small; no production code
**Dependencies:** None

### Objective

Create an immutable starting point and prevent unrelated concurrent edits from
being mixed into remediation work.

### Tasks

- Inspect and attribute every current modified/untracked file.
- Agree on a clean commit or explicit snapshot as the baseline.
- Decide whether Java 21 Rules verification runs locally or in CI.
- Record current test and bundle metrics.

### Acceptance criteria

- The worktree is stable for the duration of implementation.
- No user change is lost, overwritten or silently included.
- One exact SHA/snapshot identifies the baseline.
- Local and CI-only gates are explicitly identified.

### Verification

```bash
git status --short
git diff --check
npm run lint
npm test -- --run
npm --prefix functions run lint
npm --prefix functions test
npm run extension:check
npm run build
npm run verify:bundle
```

### Stop condition

If the worktree continues changing unexpectedly, do not start Phase 1. Report the
conflicting files and wait for the user.

## Phase 0 execution record — 2026-08-21 14:14 ICT

**Result:** Blocked; no production code changed by this phase.

### Snapshot observed

- HEAD: `c494d39421386d70ea8aec675323860b1dadf2a6`
- Branch: `codex/stable-extension-selector`
- Worktree: 38 modified tracked files and three untracked plan files plus the
  `.serena/` directory.
- Two `git status --short` snapshots taken three seconds apart were identical.
- `git diff --check` passed.
- Existing changes include extension, browser-extension import, intake, Gemini,
  Functions validation and documentation work from other activity. They were not
  reverted, stashed or overwritten.

### Baseline gates

| Gate | Result |
| --- | --- |
| Root `npm run lint` | **Failed**: `requestedDeck` is accessed on the V2/V3 union in `src/features/browserExtension/browserExtensionImportRuntime.ts:125,156`; V2 does not declare that property. |
| Root Vitest | Passed: 189 files, 1,520 tests |
| Functions lint/tests | Passed lint; 75 passed, 2 integration tests skipped |
| Extension check | Passed: 83/83 |
| Build | Passed: 1,963 modules transformed |
| Secret scan | Passed: 79 production files |
| Bundle | Passed: 285,797 B initial JS gzip, 641,052 B total JS gzip |
| npm audit | Passed: zero vulnerabilities in root and Functions |
| Rules emulator | **Blocked**: Java runtime unavailable on host |
| `git diff --check` | Passed |

### Why Phase 0 is not complete

The snapshot is stable enough to inspect, but it is not a green implementation
baseline. The TypeScript error belongs to an already-dirty browser-extension deck
metadata change and must not be silently repaired as part of stabilization. The
Rules gate also cannot be accepted until Java 21 is available locally or a current
revision CI run proves it.

### Decision gate before Phase 1 — resolved for this session

One of the following must happen:

1. The other in-progress change is completed and the worktree is rechecked; or
2. The user authorizes this agent to fix only the three TypeScript errors and then
   re-run Phase 0; or
3. The user designates the current dirty snapshot as the implementation baseline,
   accepting that Phase 0 remains red until Rules proof is obtained.

The user explicitly authorized Phase 1 to proceed on this dirty but stable
snapshot. Phase 0 remains blocked; its TypeScript and Rules blockers are carried
forward and are not silently fixed by Phase 1.

## Phase 1 — Fix the extension cleanup race

**Status:** Complete — core acceptance met; residual hardening remains
**Estimated scope:** Small/Medium; two files
**Dependencies:** Phase 0

### Objective

Ensure intentional worker-tab cleanup cannot emit a false error after Quick Add
succeeds.

### Tasks

- Add a regression test where `tabs.remove()` emits `onRemoved`.
- Delay storage removal in the test to reproduce the ordering race.
- Mark programmatic closure or serialize remove-job before close-tab.
- Preserve idempotence for competing source/worker close events.

### Acceptance criteria

- A job produces exactly one terminal status.
- `created` or `existing` can never be followed by a cleanup `error`.
- User-closing a worker tab still reports failure.
- Source and worker tab simultaneous closure remains idempotent.

### Files likely touched

- `extensions/lingoflash/background-core.js`
- `extensions/lingoflash/tests/background.node.mjs`

### Verification

```bash
node --test extensions/lingoflash/tests/background.node.mjs
npm run extension:check
git diff --check
```

## Phase 1 execution record — 2026-08-21 14:24 ICT

**Result:** Complete; no unrelated Phase 0 blocker was changed.

### TDD evidence

- Added a regression test that delays `storage.remove`, makes `tabs.remove` emit
  `tabs.onRemoved`, and asserts that a successful `created` result never produces
  an injected or popup `error` status.
- Confirmed the new test failed against the old concurrent cleanup ordering.
- Changed `cleanup()` to await persisted job removal before clearing the alarm and
  closing the worker tab. This is the smallest ordering fix and preserves the
  existing user-close and idempotence paths.

### Files changed by Phase 1

- `extensions/lingoflash/background-core.js`
- `extensions/lingoflash/tests/background.node.mjs`

### Verification

| Gate | Result |
| --- | --- |
| Focused background test | Passed: 30/30 |
| `npm run extension:check` | Passed: 84/84 tests and extension checks |
| `git diff --check` | Passed |

The root TypeScript lint error recorded in the Phase 0 execution record remains
untouched because it belongs to another dirty browser-import change. Rules
verification is still blocked locally by the unavailable Java runtime.

### Phase 1 post-review addendum — user assessment

The user reviewed Phase 1 as approximately **8/10**: the primary cleanup race is
fixed and the core regression gates pass, but the phase is not an absolute close.
The following hardening items remain open and must be handled in a separately
authorized follow-up rather than being silently folded into Phase 2:

1. **P1 alarm/cleanup race:** `alarms.onAlarm` does not currently check
   `resultClaimedAt` or an in-flight cleanup before emitting an error.
2. **P2 storage-removal failure:** `removeJob()` swallows removal errors; if the
   job remains readable, closing the worker tab can still be misclassified as a
   user failure.
3. **P2 tab-removal lock lifecycle:** `tabRemovalLocks` entries are never
   released and can accumulate in a long-lived service worker.
4. **P2 result coverage:** the delayed-removal race is covered for `created`, but
   an equivalent `existing` result regression test is still missing.

These are recorded as residual risk, not as evidence that the Phase 1 primary
fix failed.

### Phase 1 hardening plan — authorized follow-up

**Status:** Complete

Scope is limited to `background-core.js`, its Node regression tests, and this
ledger. The follow-up will:

1. Guard alarm handling when a result is already claimed or cleanup is in flight,
   and retry cleanup rather than emitting a second terminal error.
2. Make storage removal report success/failure; do not close the worker tab or
   clear its retry alarm after a failed removal.
3. Release `tabRemovalLocks` when cleanup settles.
4. Add the delayed-removal regression for `existing` in addition to `created`.

The same TDD gate applies: tests first, focused extension tests, full extension
check, then stop before any later phase.

### Phase 1 hardening execution record — 2026-08-21 14:33 ICT

**Result:** Core hardening complete; the four reviewed residuals are covered.

### Changes

- `removeJob()` now returns success/failure. Cleanup only clears the alarm and
  closes the worker tab after a successful removal; failed removal keeps the
  job/tab intact and the one-shot alarm is re-scheduled for another retry.
- Alarm handling now waits for in-flight cleanup and routes claimed results back
  through cleanup instead of emitting a second error. Expired claimed jobs on
  startup use the same path.
- `tabRemovalLocks` is released when cleanup settles.
- Added regressions for alarm overlap, storage-removal failure, `existing`
  results, and lock release after cleanup.

### Verification

| Gate | Result |
| --- | --- |
| Focused background test | Passed: 34/34 |
| `git diff --check` | Passed |
| `npm run extension:check` | **Blocked by unrelated dirty changes:** manifest test expects version `1.6.0` while the manifest is `1.5.0`, and package test expects missing `selection-icon.js` |

The full extension gate reached all hardening tests successfully; its remaining
failures are outside the two Phase 1 hardening files and were not modified.

## Phase 2 — Complete the Landing Quick Start journey

**Status:** Complete
**Estimated scope:** Medium; three to five files
**Dependencies:** Phase 0

### Objective

Preserve the entered word and open the real Card Intake journey without automatic
network or AI cost.

### Tasks

- Add a failing test for word entry, submit and prefilled intake.
- Introduce a bounded session/navigation intake intent.
- Navigate to Library and apply the intent to the draft once.
- Define empty-submit behavior: disable submit or remain on landing.

### Acceptance criteria

- Entering `Serendipity` produces a Library intake draft of `Serendipity`.
- Unicode text survives trimming and navigation.
- No AI request is made until the learner explicitly requests generation.
- The word is not placed in URL history or logs.
- Empty input does not navigate to an unrelated screen.

### Files likely touched

- `src/features/landing/LandingPage.tsx`
- `src/App.tsx`
- One navigation/intake intent module
- Landing/intake tests

### Verification

```bash
npm test -- --run LandingPage
npm test -- --run src/features/intake
npm run lint
git diff --check
```

## Phase 2 execution record — 2026-08-21 14:27 ICT

**Result:** Complete within scope; no unrelated browser-extension changes were
modified.

### TDD evidence

- Added `LandingPage.test.tsx` first; it failed because the Quick Start intent
  contract did not exist.
- Added a small in-memory `LandingQuickStartIntent` contract with trim-only
  normalization, explicit empty-input rejection, and a destination that only
  changes the draft and opens Library.
- Wired Landing submit to dispatch the intent, and App to apply it through
  `intakeActions.changeDraft` before switching to `library`.
- The submit path never calls card generation, and the word is not embedded in
  the route location; only the normal `view=library` navigation state is used.

### Files changed by Phase 2

- `src/features/landing/LandingPage.tsx`
- `src/features/landing/LandingPage.test.tsx`
- `src/features/navigation/landingQuickStartIntent.ts`
- `src/App.tsx`

### Verification

| Gate | Result |
| --- | --- |
| `npm test -- --run LandingPage` | Passed: 3/3 |
| `npm test -- --run src/features/intake` | Passed: 60/60 |
| `npm run lint` | Initially blocked by unrelated dirty `browserExtensionImportRuntime.test.ts` nullability errors; **passed in the Phase 2 follow-up** |
| `git diff --check` | Passed |

The lint blocker is outside the Phase 2 file set and was left untouched. No AI
request is made by the Landing submit; the learner must explicitly submit the
Library generation form.

## Phase 2 follow-up — close integration and length-contract gaps

**Status:** Verified — human approval pending
**Scope:** Small; Landing intent, unit test, one Chromium integration test
**Reason:** The original Phase 2 record proved helper behavior but did not
exercise the mounted Landing → App → Library path, and a draft longer than the
Card Intake limit could still be navigated into an unusable Library form.

### Execution plan

1. **RED:** add a mounted-browser integration test that fills the real Landing
   input, submits it, and asserts the real Library input contains the trimmed
   Unicode draft. Add unit coverage for the 80-character boundary and rejection
   of longer input.
2. **GREEN:** make the Landing intent reject drafts over the existing Card
   Intake limit without truncating user data; prevent an over-limit submit from
   navigating and expose the same 80-character input bound in Landing.
3. **VERIFY:** run Landing/intake tests, the focused Chromium integration test,
   lint, build and diff-check. Correct the stale Phase 2 ledger evidence to
   record the latest lint pass.
4. **STOP:** do not begin another phase in this follow-up.

### Follow-up acceptance criteria

- A mounted Landing submit with `Serendipity` opens the real Library form with
  `Serendipity` in `#new-word`.
- Unicode survives the mounted flow after trimming.
- Exactly 80 characters are accepted; 81 characters are rejected without
  navigation or a truncated draft.
- No AI generation request is made by the Landing submit.
- The Phase 2 ledger no longer reports the already-resolved lint blocker.

### Follow-up verification

```bash
npm test -- --run LandingPage
npm test -- --run src/features/intake
npm run build
npx playwright test e2e/landing-quick-start.spec.ts --project=chromium
npm run lint
git diff --check
```

The original Phase 2 record remains historical; its verification table is
updated below with the follow-up correction rather than rewritten silently.

### Phase 2 follow-up execution record — 2026-08-21 14:51 ICT

**Result:** Follow-up complete within scope; Phase 4 was not started.

### TDD evidence

- Added a failing 80/81-character unit contract and `maxLength` assertion
  before implementation.
- Added a mounted Chromium flow that fills the real Landing input, submits the
  form, observes the real Library view and asserts the real `#new-word` value.
- Added a request assertion proving the Landing submit emits no
  `generateVocabulary` request.
- Added `LANDING_QUICK_START_MAX_LENGTH = 80`; the intent rejects over-limit
  input without truncating it, while the native Landing input prevents normal
  typing beyond the same bound.

### Follow-up verification

| Gate | Result |
| --- | --- |
| `npm test -- --run LandingPage` | **Passed: 6/6** |
| `npm test -- --run src/features/intake` | **Passed: 60/60** |
| `npm run build` | **Passed** |
| `npx playwright test e2e/landing-quick-start.spec.ts --project=chromium` | **Passed: 1/1** |
| `npm run lint` | **Passed**; the previous stale blocker is resolved |
| `git diff --check` | **Passed** |

## Phase 3 — Make Landing truthful and accessible

**Status:** Verified — pending human approval
**Estimated scope:** Medium; three to five files
**Dependencies:** Phase 2

### Execution plan

1. **RED — contract tests:** extend the Landing test contract to reject the
   unsupported catalog/licensing, image-generation and pronunciation-accuracy
   claims; require the truthful replacement copy; assert the sample speaker is
   presentation-only; and let the type-check catch any remaining
   `onOpenProgress` Landing callsite. Add a Playwright axe case that visits the
   landing at desktop and mobile widths.
2. **GREEN — smallest implementation:** update only the Landing copy and
   semantics, remove the dead Landing prop and App callsite, and keep existing
   navigation/actions unchanged. Do not add audio or new product claims.
3. **VERIFY:** run the focused Landing tests, the landing axe/reflow checks,
   TypeScript lint, production build, and `git diff --check`. Record exact
   results and any pre-existing unrelated blockers in the execution ledger.
4. **STOP:** do not begin Phase 4 until this phase has been reviewed and
   explicitly accepted.

### Objective

Remove unsupported claims, inert controls and dead contracts from the landing
experience.

### Tasks

- Replace or remove unsupported catalog, image-generation, pronunciation and
  Oxford claims.
- Describe pronunciation as transcript/speech matching unless phoneme-level
  analysis is actually added in a separate product project.
- Describe images as relevant image cues/search results.
- Convert the inert sample speaker to non-interactive presentation, or wire a real
  bounded speech action. The default recommendation is to remove button semantics
  to keep landing lightweight.
- Remove `onOpenProgress` if no landing control consumes it.
- Add Landing accessibility coverage.

### Acceptance criteria

- Every landing claim is supported by repository evidence.
- No icon-only button lacks an accessible name.
- No interactive control is inert.
- No unused Landing prop remains.
- Landing passes the applicable axe and reflow checks.

### Files likely touched

- `src/features/landing/LandingPage.tsx`
- `src/App.tsx`
- A Landing unit test
- `e2e/accessibility.spec.ts`

### Verification

```bash
npm test -- --run LandingPage
npm run test:a11y
npm run lint
npm run build
git diff --check
```

### Phase 3 execution evidence

- Unsupported numeric/licensing and outcome claims were removed or rewritten:
  `60,000+`, `Oxford`, generated “vivid illustrations”, pronunciation
  accuracy, `70%` study-time savings, permanent-retention language and
  instant-sync language no longer appear in the Landing source.
- Image copy now says `relevant image cue/search result`; speech copy now says
  `speech/transcript matching` and describes transcript comparison.
- The sample speaker is a decorative `aria-hidden` icon rather than an inert
  button. Optional mobile navigation callbacks fall back to `onEnterApp`.
- `onOpenProgress` was removed from the Landing prop contract and its Landing
  callsite; the shell navigation callback remains untouched.
- `npm test -- --run LandingPage`: **6/6 passed**.
- `npm run test:a11y`: **3/3 Chromium tests passed**, including Landing at
  1280×720 and 375×812; the command’s production build passed.
- `npm run lint`: **passed**.
- `npm run build`: **passed**.
- `git diff --check`: **passed**.

At the Phase 3 checkpoint, Phase 4 was intentionally not started. Human review
was still required before advancing, and Phase 4 is now recorded below.

### Phase 3 post-review addendum — user assessment

**Assessment:** Primary objective achieved, approximately **9/10**.

Residual risks identified in review and closed by the authorized follow-up below:

1. The hardcoded sample card's AI provenance wording was replaced with an
   example/format-preview label.
2. Product-truth coverage now includes desktop CTA clicks, mobile keyboard
   activation, and an all-impact Landing axe assertion.
3. The execution evidence and ledger remain synchronized to Landing **6/6**.

Phase 4 was intentionally not started at the Phase 3 review point; its
authorized implementation and verification are recorded in the next section.

### Phase 3 residual follow-up — authorized by user

The follow-up closes all three review residuals without changing the Phase 4
navigation contract:

1. **RED:** require sample-card copy that does not claim unsupported AI
   provenance; strengthen the Landing axe assertion to fail on every reported
   impact; and add a real Chromium interaction case covering desktop CTA clicks
   plus keyboard activation through the mobile menu.
2. **GREEN:** label the hardcoded sample as an example/format preview, keep all
   existing destinations unchanged, and retain the interaction tests as the
   behavior contract.
3. **VERIFY:** run Landing unit tests, Landing all-impact axe checks, the new
   interaction E2E, lint, build and diff-check; update the ledger to the current
   6/6 Landing count.
4. **STOP:** do not start a new remediation phase or alter Phase 4 behavior.

### Residual follow-up acceptance criteria

- Landing contains no unsupported `Auto-generated by SonFlash AI` provenance
  claim for the hardcoded sample card.
- Desktop CTA buttons navigate to their implemented destinations when clicked.
- Mobile menu CTA navigation works from keyboard focus and Enter activation.
- Landing axe has no violations at any impact level at desktop or mobile.
- The Phase 3 execution evidence and ledger both report Landing **6/6**.

### Phase 3 residual follow-up execution record — 2026-08-21 15:11 ICT

**Result:** All three review residuals closed within scope; Phase 4 behavior was
not changed and Phase 5 was not started.

### TDD evidence

- Added a failing product-truth assertion for the unsupported
  `Auto-generated by SonFlash AI` text before changing the sample card.
- Strengthened the Landing axe contract to assert an empty violation list at
  every impact level instead of filtering to serious/critical only.
- Added real Chromium interaction coverage for five desktop Landing CTA
  destinations and keyboard Enter activation through the mobile menu.
- Replaced the provenance claim with `Example card format preview`, which labels
  the hardcoded card without implying runtime generation.

### Residual follow-up verification

| Gate | Result |
| --- | --- |
| `npm test -- --run LandingPage` | **Passed: 6/6** |
| `npm run test:a11y` | **Passed: 3/3**; Landing has no axe violations at any impact |
| `npx playwright test e2e/landing-interactions.spec.ts --project=chromium` | **Passed: 2/2** |
| `npm run lint` | **Passed** |
| `npm run build` | **Passed** |
| `git diff --check` | **Passed** |

Phase 3 remains verified pending human approval. The combined Phase 1–4 P1
checkpoint is still the stop condition before Phase 5.

## Phase 4 — Consolidate mobile navigation

**Status:** Verified — human approval pending; P1 checkpoint open
**Estimated scope:** Medium; four to five files
**Dependencies:** Phase 0

### Objective

Make production and tests use one Today/Paths/Vocabulary/Progress mobile IA.

### Tasks

- Add a failing production-navigation test for Paths.
- Update `FloatingMobileNav` to the final ADR-003 IA.
- Move canonical navigation assertions to the production module.
- Delete `MobileNavigation` only after reachability confirms no caller.
- Add a mobile E2E assertion for Paths and 44px targets.

### Acceptance criteria

- Paths is reachable on mobile outside landing/practice views.
- `aria-current` is correct for each destination.
- All targets are at least 44px and fit at 320px.
- Only one mobile navigation implementation remains.
- Tests exercise the module rendered by App.

### Files likely touched

- `src/components/shell/FloatingMobileNav.tsx`
- `src/components/shell/FloatingMobileNav.test.tsx`
- `src/components/shell/MobileNavigation.tsx` — deletion candidate
- `src/components/shell/AppNavigation.test.tsx`
- One E2E spec

### Verification

```bash
npm test -- --run FloatingMobileNav AppNavigation
npm run test:e2e:chromium
npm run lint
git diff --check
```

### Phase 4 execution plan — authorized follow-up

The production shell already renders `FloatingMobileNav` from `App.tsx`; the
separate `MobileNavigation` module is currently referenced only by tests and is
therefore a dead contract. Work proceeds in this order:

1. **RED:** extend `FloatingMobileNav.test.tsx` with the ADR-003 destination
   contract, Paths reachability, `aria-current` state, 44px touch targets and
   practice/landing hiding behavior. Add a failing 320px Chromium flow against
   the production shell.
2. **GREEN:** replace the production Home tab with Paths (`catalog`), keep the
   production Today/Vocabulary/Progress destinations, and ensure every target
   remains at least 44px without horizontal overflow at 320px.
3. **MIGRATE:** move canonical assertions out of `AppNavigation.test.tsx`,
   remove its dead `MobileNavigation` import/test, delete
   `src/components/shell/MobileNavigation.tsx`, and remove the stale shell
   boundary entry only after a caller search is clean.
4. **VERIFY:** run focused navigation tests, the full Chromium E2E suite, lint,
   and diff-check. Record exact results and the P1 checkpoint evidence.
5. **STOP:** do not begin Phase 5 or release-proof work in this phase.

### Phase 4 pre-implementation checkpoint

- Root tests, Functions tests and extension checks are green in the current
  dirty worktree; Phase 1 cleanup-race coverage remains present.
- Landing Quick Start and Landing accessibility/product-truth gates are already
  recorded as passing in Phases 2–3.
- No unresolved P1 correctness item from Phases 1–3 is being silently folded
  into this navigation change.
- User authorization to process Phase 4 is recorded by the current request;
  combined Phase 1–4 human diff review remains a stop condition before Phase 5.

### Phase 4 execution record — 2026-08-21 15:06 ICT

**Result:** Phase 4 implementation complete within scope; Phase 5 was not
started. The combined Phase 1–4 diff is ready for human review.

### TDD evidence

- Added a failing production-module contract before implementation: the old
  Home/Today/Library/Progress markup failed the Paths, four-state `aria-current`
  and 44px target assertions.
- Added a Chromium E2E case against the real `App.tsx` shell at 320px before the
  production tab was changed; it could not find the new Learning paths control.
- Replaced the production Home tab with Paths (`catalog`) and kept Today,
  Vocabulary and Progress in one `FloatingMobileNav` implementation.
- Moved mobile assertions to `FloatingMobileNav.test.tsx`, removed the dead
  `MobileNavigation` test/boundary entry, and deleted
  `src/components/shell/MobileNavigation.tsx` after the caller search was clean.
- Added explicit `min-h-11 min-w-11` target bounds and preserved the existing
  practice/landing suppression behavior.
- Added a type-narrowing guard to the pre-existing Card Intake test so the
  requested lint gate can type-check the dirty worktree; runtime behavior is
  unchanged.

### Phase 4 verification

| Gate | Result |
| --- | --- |
| `npm test -- --run FloatingMobileNav AppNavigation` | **Passed: 24/24** |
| `npm run test:e2e:chromium` | **Passed: 54/54** |
| `npm run lint` | **Passed** after the test-only narrowing guard |
| `git diff --check` | **Passed** |

### P1 checkpoint evidence

- Root Vitest: **191 files, 1,533/1,533 passed**.
- Functions lint: **passed**; Functions Vitest: **75 passed, 2 integration tests skipped**.
- Extension check: **99/99 tests passed** plus extension packaging/protocol checks.
- Landing Quick Start: **1/1 mounted Chromium flow passed**; Landing axe gate:
  **3/3** at desktop/mobile; product-truth tests remain green.
- Mobile Paths: production `FloatingMobileNav` reaches `?view=catalog` at
  320px, all four targets are at least 44px, and there is no horizontal overflow.
- No unresolved Phase 1–3 P1 correctness item was folded into this change.

The P1 checkpoint is **ready for human review, not yet approved**. Phase 5 and
release-proof work remain blocked until that review is complete.

### Phase 4/P1 verification refresh — 2026-08-21 15:29 ICT

The later current-worktree snapshot supersedes only the aggregate counts above;
the original Phase 4 record is retained as historical execution context.

- Floating/AppNavigation: **24/24 passed**.
- Full Chromium E2E: **56/56 passed**.
- Root Vitest: **191 files, 1,544/1,544 passed**.
- Functions: **75 passed, 2 integration tests skipped**.
- Extension check: **102/102 passed**, including package/protocol checks.
- Lint, build and `git diff --check`: **passed**.
- Worktree remains dirty and the evidence is not bound to a clean SHA.
- Rules/Java 21 remains a release blocker from Phase 0/5; it is not a Phase 4
  navigation defect and no historical Rules result is promoted to current proof.

This refresh leaves the P1 checkpoint **ready for human approval**. No commit,
push or CI action was performed.

## Checkpoint after Phases 1–4

Do not continue until all items are satisfied:

- Root and Functions tests pass.
- Extension check passes with the new race test.
- Landing Quick Start works end to end.
- Mobile Paths works in the production navigation.
- Landing accessibility and product truth checks pass.
- Human has reviewed the combined P1 diff.

## Phase 5 — Produce current-revision release proof

**Status:** Blocked — local gates green; exact-SHA/CI proof still missing
**Estimated scope:** Small if green; external CI authorization required
**Dependencies:** P1 checkpoint

### Objective

Prove Firestore Rules and browser gates against one exact clean revision.

### Tasks

- Run the Firestore emulator with Java 21.
- Run full Chromium locally.
- Run Firefox and WebKit in the supported CI/Linux environment.
- Run the Quality workflow against a clean SHA.
- Retain revision-bound artifacts.

### Acceptance criteria

- `npm run test:rules` passes for current Rules and tests.
- Browser projects reach and pass app assertions.
- GitHub Actions succeeds for the exact candidate SHA.
- No historical evidence is presented as current evidence.

### Verification

```bash
npm run test:rules
npm run verify:core
npm run verify:audit
npm run test:e2e:chromium
```

### Authorization gate

Starting CI may require committing and pushing. Stop and obtain explicit user
authorization before those actions.

### Phase 5 execution record — 2026-08-21 15:20 ICT

**Result:** Local proof collection completed without changing production source,
committing, pushing, dispatching a workflow or using historical evidence as a
current result. The initial attempt was blocked by Java not being on `PATH`,
then the already-installed OpenJDK 21 runtime was used successfully. Phase 5
remains blocked only because the current worktree has no clean immutable release
revision, cross-browser CI evidence and current-HEAD GitHub Actions run.

### Snapshot and environment

- Branch: `codex/stable-extension-selector`
- HEAD: `c494d39421386d70ea8aec675323860b1dadf2a6`
- Worktree: **dirty**; 63 status entries were present before/after the gates,
  including Phase 1–4 changes and unrelated in-progress changes. No reset,
  checkout, stash, deletion or overwrite was performed.
- Node: `v22.23.2`; npm: `10.9.8`.
- Java on the default `PATH`: unavailable; OpenJDK 21.0.12 is already installed
  at `/opt/homebrew/opt/openjdk@21` and was supplied through an explicit
  `JAVA_HOME` for the current Rules proof. No system installation or
  configuration change was made.
- `gh run list --commit c494d39421386d70ea8aec675323860b1dadf2a6` returned no
  workflow runs (`[]`).

### Local verification

| Gate | Result | Current-revision interpretation |
| --- | --- | --- |
| `npm run test:rules` | **Passed through the repository wrapper using OpenJDK 21.0.12**: Rules **48/48**, Firestore Admin integration **2/2** | Current dirty-worktree Rules proof; not an exact-SHA attestation |
| `npm run verify:core` | **Passed with the resolved Java 21 runtime** after root Vitest **192 files / 1,553 passed**, Functions **75 passed / 2 skipped**, Functions build and Rules | Core and Rules gates are green locally; no CI attestation |
| `npm run verify:audit` | **Passed**: root and Functions report 0 high-severity vulnerabilities | Current local dependency snapshot only; not a CI release attestation |
| `npm run test:e2e:chromium` | **Passed: 56/56**; build passed and every Chromium case reached its assertion | Current dirty-worktree Chromium evidence; no pre-assertion browser failure |
| Release contract tests | **Passed: 28/28** (`release-workflows`, `release-artifact`, `releaseEvidence`) | Static contract confirms exact-SHA checks, not a workflow run |
| `git diff --check` | **Passed** | Worktree remains dirty, so this is not clean-SHA evidence |

### Phase 5 local follow-up — 2026-08-21 15:34 ICT

OpenJDK 21.0.12 was found already installed at
`/opt/homebrew/opt/openjdk@21`; it was not on the default `PATH`. Running the
Rules gate with that explicit `JAVA_HOME` produced:

- Firestore Rules: **48/48 passed**.
- Firestore Admin emulator integration: **2/2 passed**.
- `npm run verify:core` with the same Java runtime: **passed**, including lint,
  root Vitest, Functions lint/tests/build and Rules.

This resolves the local Java/Rules blocker without changing system
configuration. It does not resolve the clean-SHA or CI authorization boundary.

The local build metadata mechanism was also exercised with
`RELEASE_REVISION=c494d39421386d70ea8aec675323860b1dadf2a6`; it produced
`dist/health.json` with that revision. This validates metadata wiring only. It
does not attest the dirty worktree as a release, and the existing ignored
`artifacts/phase6-readiness.json` carries revision
`0f39689bba0e07cc9a7aa6e53b5ad987612fe7be`, so it is historical and was not
used as evidence for HEAD.

### Phase 5 tooling follow-up — 2026-08-21 16:00 ICT

The `test:rules` package script now runs `scripts/test-rules.mjs`. The wrapper
resolves a usable Java 21 runtime from `JAVA_HOME` or standard Homebrew/Linux
JDK locations before invoking the pinned Firebase CLI, and forwards the
emulator command's exit code instead of relying on a shell wrapper. Regression
coverage in `scripts/test-rules.test.mjs` verifies candidate ordering and
environment construction and emulator exit-code forwarding.

With the default command (without manually exporting `JAVA_HOME`), Rules
**48/48** and Firestore Admin integration **2/2** passed. `npm run verify:core`
(root **192 files / 1,553 passed**, Functions **75 passed / 2 skipped**),
`npm run lint`, `npm run verify:audit`, and `git diff --check` also passed. This
closes the local Java/PATH/tooling gap only; clean-SHA, Firefox/WebKit CI, and
GitHub Actions authorization remain outstanding.

### Workflow/artifact inspection

- `.github/workflows/quality.yml` provisions Temurin Java 21, installs
  Chromium/Firefox/WebKit, runs `npm run verify` with
  `RELEASE_REVISION: ${{ github.sha }}`, and names browser/readiness artifacts
  with `${{ github.sha }}`.
- `playwright.config.ts` defines Chromium, Firefox and WebKit projects; the
  current local run covered Chromium only.
- `.github/workflows/release-candidate.yml` is the supported clean-revision
  path: it runs the full verify job, seals with the exact `${{ github.sha }}`
  and `${{ github.run_id }}`, and uploads `lingoflash-${{ github.sha }}` plus
  the revision-bound manifest.
- No Firefox/WebKit CI run, Quality success, release-candidate manifest, or
  exact-SHA artifact exists for `c494d394...` yet.

### Required next action (explicit authorization boundary)

Phase 5 can only close after the user authorizes the external step: create a
clean commit containing the approved Phase 1–4 snapshot, push it, and run or
allow the Quality/release-candidate workflow for that exact full SHA. That run
must pass Rules and all three browser projects and retain its SHA-bound
artifacts. Until then, Phase 5 stays **blocked**, and no commit/push/CI action
is performed by this phase.

## Phase 6 — Consolidate the Catalog runtime

**Status:** Verified — human approval pending
**Estimated scope:** Medium; four to five files
**Dependencies:** P1 checkpoint

### Objective

Inject one Catalog runtime from composition and remove `features -> app`.

### Tasks

- Characterize inspect/install/readPage/learning-state behavior.
- Define one `CatalogWorkspaceRuntimePort`.
- Inject it through App/View Stage.
- Move owner-scoped Learning State loading behind the same port.
- Delete duplicate install/readPage forwarding only after all callers migrate.

### Acceptance criteria

- Catalog features do not import `appDependencies` or other app modules.
- One implementation owns catalog install and page reads.
- Owner-scoped Learning State behavior remains unchanged.
- Download, cache, query and optimistic add tests remain green.

### Files likely touched

- `src/features/catalogWorkspace/CatalogWorkspace.tsx`
- `src/features/catalogWorkspace/catalogWorkspaceService.ts`
- `src/app/appDependencies.ts`
- `src/app/catalogRuntime.ts`
- Catalog tests

### Verification

```bash
npm test -- --run src/features/catalogWorkspace src/app/catalogRuntime
npm run test:phase6
npm run lint
npm run build
git diff --check
```

### Phase 6 execution plan — authorized slice

1. **RED:** characterize the four runtime responsibilities (inspect, install,
   readPage and owner-scoped Learning State), require a runtime prop at the
   Catalog boundary, and assert that CatalogWorkspace has no `appDependencies`
   import. Assert that App composition forwards one runtime port and that the
   legacy install/readPage adapters are absent from `appDependencies`.
2. **GREEN:** move the single install/readPage implementation into the App-owned
   Catalog runtime factory, extend the port with owner-scoped Learning State
   loading, and inject it through `AppViewStage` into CatalogWorkspace.
3. **REFACTOR:** remove the duplicate default runtime from the feature service
   and delete obsolete app adapter exports only after all caller searches are
   clean. Preserve request guards, cache/query behavior, optimistic add and
   owner scoping.
4. **VERIFY:** run focused Catalog/App tests, `npm run test:phase6`, lint, build
   and diff-check. At this checkpoint, stop for human review; Phase 7 requires
   a separate authorization.

### Phase 6 execution record — 2026-08-21 15:46 ICT

**Result:** Verified within scope; Catalog runtime ownership is now composed in
App and injected into the feature. No commit, push or external CI action was
performed, and unrelated dirty-worktree changes were not reverted or rewritten.

### TDD evidence

- **RED:** added characterization contracts for the injected runtime boundary,
  owner-scoped Learning State delegation, App/View Stage composition and the
  absence of duplicate `appDependencies` catalog adapters.
- **GREEN:** introduced `CatalogWorkspaceRuntimePort.loadLearningStates`, made
  the port required by `createCatalogWorkspaceService`, injected it through
  `AppViewStage`, and moved the only install/readPage implementation to
  `createCatalogWorkspaceRuntime`.
- **REFACTOR:** removed the feature service's default runtime implementation,
  deleted obsolete `installSameOriginCatalog`/`readInstalledCatalogPage`
  exports and removed the duplicate app dependency adapters. Heavy Catalog
  cache/delivery imports remain dynamic so App does not eager-load the runtime.

### Phase 6 verification

| Gate | Result |
| --- | --- |
| Focused Catalog/App tests | **Passed: 91/91** across 13 test files using `npm test -- --run src/features/catalogWorkspace src/app/catalogRuntime` |
| `npm run test:phase6` | **Passed: 74/74** across 8 test files |
| Catalog Chromium E2E | **Passed: 2/2** (`e2e/catalog-workspace.spec.ts`) |
| `npm run lint` | **Passed** |
| `npm run build` | **Passed** |
| `npm run verify:bundle` | **Passed**: initial JS 287,594 B gzip; total JS 645,638 B gzip |
| `git diff --check` | **Passed** |

### Phase 6 evidence synchronization — 2026-08-21 16:20 ICT

The focused command specified by Phase 6 currently discovers **13 test files and
91 passing tests**. The earlier **106/106 across 15 files** figure included
additional App composition coverage and remains historical context, not a
contradictory runtime result. The Phase 6 ledger now records the exact command
and current 91/91 result. The worktree remains dirty, so this is behavior
evidence for the current snapshot rather than clean-SHA release evidence.

The current worktree remains dirty. Phase 7 execution is recorded below.

## Phase 7 — Strengthen the architecture analyzer

**Status:** Verified — human approval pending
**Estimated scope:** Small/Medium; two to three files
**Dependencies:** Phase 6 and Phase 4

### Objective

Prevent reverse dependencies and production-orphan modules from returning.

### Tasks

- Add a forbidden rule for `src/features/** -> src/app/**`.
- Add production entrypoint reachability reporting.
- Add an explicit allowlist for intentional dynamic/worker entrypoints.
- Add regression fixtures for Catalog reverse dependency and orphan navigation.

### Acceptance criteria

- Analyzer rejects reverse feature-to-app imports.
- Orphan production modules are reported.
- Tests and intentional dynamic entries do not produce false positives.
- The production graph remains acyclic.

### Files likely touched

- `scripts/architectureAnalyzer.ts`
- `scripts/architectureAnalyzer.test.ts`
- Optional reachability allowlist/config

### Verification

```bash
npm test -- --run scripts/architectureAnalyzer.test.ts
npm run lint
git diff --check
```

### Phase 7 execution record — 2026-08-21 16:14 ICT

**Result:** Analyzer upgrade completed within scope; no commit, push or CI
action was performed. The analyzer now rejects `src/features/**` imports into
`src/app/**`, calculates reachability from `src/main.tsx`, and accepts an
explicit `reachabilityAllowlist` for standalone catalog/release tooling roots.
String-based dynamic imports remain graph edges, while missing allowlisted roots
are reported as configuration errors rather than silently ignored.

The current production scan is acyclic and reports these five existing
unreachable modules for follow-up instead of hiding them behind a broad
allowlist:

- `src/features/importExport/useSpreadsheetImport.ts`
- `src/features/librarySession/librarySessionLifecycle.ts`
- `src/lib/cardImageHydration.ts`
- `src/lib/cardUpdates.ts`
- `src/lib/deviceStore.ts`

Regression fixtures cover the Catalog reverse dependency, dead navigation,
worker allowlisting, dynamic imports and missing entrypoints. The unrelated
lint failure uncovered while verifying this phase was fixed by moving the
shared `StaleIntakeSessionError` definition to the controller and re-exporting
it from the pipeline, avoiding a new dependency cycle.

Verification: architecture analyzer **16/16**, `npm run lint` passed, and
`git diff --check` passed. Phase 7 is **verified pending human approval**;
the five reported orphans remain explicit cleanup candidates for a later phase.

### Phase 7 analyzer hardening follow-up — 2026-08-21 16:58 ICT

The two P1 analyzer gaps identified during review are now closed without
changing the five runtime orphan candidates. Relative imports are normalized
against their importer before boundary rules run, so equivalent paths such as
`./../app/runtime` and `../foo/../app/runtime` are detected while an
out-of-root `../../app/runtime` is not misclassified. Runtime reachability now
excludes `import type`, all-type named imports, `export type` and all-type
re-exports; type-only contract files are not treated as production modules.

The regression suite now contains a concrete
`src/features/catalogWorkspace/CatalogWorkspace.tsx` →
`src/app/catalogRuntime` fixture, normalization/bypass coverage, a type-only
edge fixture and a false-positive guard. Verification is **19/19** analyzer
tests, lint passed and `git diff --check` passed. No commit, push or CI action
was performed; human approval remains pending.

## Phase 8 — Define the Library Replica intake contract

**Status:** Verified — human approval pending
**Estimated scope:** Medium; three to four files
**Dependencies:** P1 checkpoint

### Objective

Create the intent-level seam and characterize persistence invariants before moving
Card Intake callers.

### Tasks

- Characterize create/settle behavior for created, existing, queued, deleted and
  stale-epoch cases.
- Define a small Library Replica intake interface that does not expose Firebase,
  IndexedDB or Device Store.
- Implement the interface inside Library Replica.
- Keep the old Card Intake orchestration temporarily so this phase is behavior
  preserving.

### Acceptance criteria

- Interface inputs are domain intents, not infrastructure operations.
- Tests prove epoch, revision, tombstone and acknowledge-last invariants.
- Card Intake behavior is unchanged in this phase.
- ADR-006 repository transaction remains authoritative.

### Files likely touched

- `src/features/librarySession/libraryReplica.ts`
- One small intake contract module
- `src/features/librarySession/libraryReplica.test.ts`
- Optional shared test fixture

### Verification

```bash
npm test -- --run libraryReplica cardRepositoryUniqueness deviceSync
npm run lint
git diff --check
```

### Phase 8 execution record — 2026-08-21 16:26 ICT

**Result:** Verified within scope; the intent-level seam is implemented without
migrating Card Intake or changing its runtime behavior. No commit, push or
external CI action was performed.

### TDD evidence

- **RED:** added contract tests for a domain-only interface, queued creation,
  stale epochs and created/existing/deleted/stale settlements. The new tests
  initially failed because `createIntake` was not exposed by the replica.
- **GREEN:** added `LibraryReplicaIntakePort` and the opaque create/settle
  receipts, then implemented both operations inside `createLibraryReplica`.
  Current-epoch creates stage through the existing queue-first path; stale
  epochs never queue. Settlement converges the authoritative card or cleans
  the queued identity before acknowledging the operation.
- **REFACTOR/hardening:** duplicate existing cards clean the optimistic ID at
  its original epoch/revision boundary; deleted/stale outcomes target the
  queued identity; mirror failure prevents acknowledgement. Contract comments
  keep infrastructure adapters out of the public type surface.

### Phase 8 verification

| Gate | Result |
| --- | --- |
| `npm test -- --run src/features/librarySession/libraryReplica.test.ts` | **Passed: 17/17** |
| `npm test -- --run libraryReplica cardRepositoryUniqueness deviceSync` | **Passed: 150/150** across 4 files |
| `npm test -- --run src/features/intake` | **Passed: 67/67** across 5 files |
| `npm run lint` | **Passed** |
| `git diff --check` | **Passed** |

The contract imports only `CardData`; Firebase, IndexedDB and Device Store
details remain internal to the replica. `createCardIfAbsent` remains the
ADR-006 repository transaction used by the existing replica flush and legacy
Card Intake adapter; no alternative write path was introduced. Card Intake's
adapter and settlement code were not migrated in this phase. The worktree
remains dirty, so this is snapshot behavior evidence rather than clean-SHA
release proof.

## Phase 9 — Migrate Card Intake to Library Replica

**Status:** Verified; human approval pending
**Estimated scope:** Medium; four to five files
**Dependencies:** Phase 8

### Objective

Remove duplicated convergence orchestration from Card Intake.

### Tasks

- Route `persistCards` through the Phase-8 interface.
- Keep validation, generation, optimistic UI and XP compensation in Card Intake.
- Remove direct repository/mirror/Device Store/acknowledgement imports that are no
  longer needed.
- Remove the temporary adapter after every caller migrates.

### Acceptance criteria

- Card Intake no longer calls `createCardIfAbsent` directly.
- Card Intake no longer acknowledges Device Store operations directly.
- Duplicate, offline queue, stale owner and compensation behavior does not change.
- Library Replica is the sole application convergence path.

### Files likely touched

- `src/features/intake/cardIntakePipeline.ts`
- `src/features/intake/cardIntakePipeline.test.ts`
- Library Replica contract/adapter
- Intake composition port
- One integration test

### Verification

```bash
npm test -- --run src/features/intake src/features/librarySession
npm test -- --run deviceBackupReconciliation.test.ts
npm run test:rules
npm run lint
git diff --check
```

### Dedicated high-risk checkpoint

Stop after this phase even if all tests pass. Report how create, duplicate,
offline, stale epoch, tombstone and acknowledgement ordering were preserved.

### Phase 9 execution record — 2026-08-21 16:53 ICT

**Result:** Verified within the implementation scope; Card Intake now routes
create/settle work through the Library Replica intent port. No commit, push or
external CI action was performed. The worktree remains dirty, so this is
snapshot behavior evidence rather than clean-SHA release proof.

### TDD evidence

- **RED:** added integration coverage for authoritative duplicate settlement,
  offline queue notification, owner-session staleness, and anonymous cache
  lookup. Added direct Replica characterization for `created`, `existing` and
  queued outcomes through the mocked ADR-006 transaction.
- **GREEN:** `persistCards` stages via `createIntakeBatch`; asynchronous
  settlement uses `resolveIntake`; duplicate compensation and existing-card
  promotion remain in Card Intake while mirror/device convergence and
  acknowledgement stay inside the Replica.
- **REFACTOR/hardening:** restored anonymous local-cache lookup through the
  shared owner/epoch selector, while keeping Firebase, mirror and device
  adapters out of Card Intake. Stale owner sessions cannot compensate or touch
  a later owner's card.

### Phase 9 verification

| Gate | Result |
| --- | --- |
| `npm test -- --run src/features/intake src/features/librarySession` | **Passed: 161/161** across 16 files |
| `npm test -- --run deviceBackupReconciliation.test.ts` | **Passed: 76/76** |
| `npm run test:rules` | **Passed: Rules 48/48; Firestore integration 2/2** |
| `npm run lint` | **Passed** |
| `git diff --check` | **Passed** |

The pipeline has no direct `createCardIfAbsent` or Device Store acknowledgement
import. The only Card Intake write call is the injected intent port; the
ADR-006 `createCardIfAbsent` transaction remains implemented inside the
Library Replica. Duplicate compensation, offline queueing, stale-owner
publication guards, revision-bound cleanup and acknowledge-last ordering are
covered by the focused tests above. Existing-card promotion after a duplicate
settlement publishes UI state without re-running mirror/device convergence.
This high-risk phase is complete in code,
but requires human review before Phase 10; Phase 5's exact-SHA/CI blocker is
unchanged.

### Phase 8/9 hardening follow-up execution record — 2026-08-21 17:09 ICT

**Trigger:** review found that the dirty snapshot mixed the Phase-9 Card Intake
migration into the Phase-8 evidence, that an intake receipt could be falsely
acknowledged after a replica reload, and that settlement could acknowledge after
an owner/epoch switch.

**TDD evidence:**

- **RED:** added deferred mirror-convergence regressions. Before the fix,
  settlement returned `created/acknowledged: true` after the owner epoch changed
  while the mirror write was pending.
- **GREEN:** `resolveIntake` now recovers the opaque operation from the durable
  owner-scoped pending queue; an unrecoverable operation remains queued and is
  never reported acknowledged. `settleIntake` captures `{ value, verified }`,
  checks the replica context after every convergence await and leaves the
  operation pending when the owner/epoch is no longer current. A stale settlement
  is translated to the public stale resolution instead of a false successful
  resolution.
- **Regression coverage:** replica recreation, missing receipt operation,
  mirror lookup/staging races, cloud-create race, settlement race and full
  resolve-through-settlement race are covered. Existing created/existing/
  deleted/stale, duplicate cleanup, mirror failure and acknowledge-last cases
  remain green.

**Current snapshot verification:**

| Gate | Result |
| --- | --- |
| `npm test -- --run src/features/intake src/features/librarySession` | **Passed: 169/169** across 16 files |
| `npm test -- --run deviceBackupReconciliation.test.ts` | **Passed: 76/76** |
| `npm run test:rules` | **Passed: Rules 48/48; Firestore integration 2/2** |
| `npm run lint` | **Passed** |
| `git diff --check` | **Passed** |

The worktree is still dirty and contains the already-implemented Phase-9
migration, so this addendum proves the current combined snapshot rather than an
isolated Phase-8-only revision. No commit, push or CI action was performed.

### Phase 9 migration hardening follow-up — 2026-08-21 17:20 ICT

**Trigger:** review found that stale create receipts were still published as
successful optimistic cards, and anonymous intake constructed a second queueing
implementation inside `useLibraryDeviceSync`.

**Changes:**

- `persistCards` now drops `stale` receipts before creating settlement work,
  optimistic publication or XP/cloud-stat updates. It revalidates owner and
  library epoch immediately after `createIntakeBatch` and again before publish.
- Added `createAnonymousLibraryReplica` in the Library Replica module. Anonymous
  intake, create/patch/delete staging and existing-card convergence now use that
  factory; `useLibraryDeviceSync` no longer imports or calls queue adapters for
  anonymous intake.
- Added a real pipeline + owner-scoped replica integration test with a deferred
  mirror write, plus anonymous `createIntakeBatch` coverage and epoch-mismatch
  regressions.

**Current snapshot verification:**

| Gate | Result |
| --- | --- |
| `npm test -- --run src/features/intake src/features/librarySession` | **Passed: 174/174** across 17 files |
| `npm test -- --run deviceBackupReconciliation.test.ts` | **Passed: 76/76** |
| `npm run test:rules` | **Passed: Rules 48/48; Firestore integration 2/2** |
| `npm run lint` | **Passed** |
| `npm run build` | **Passed** |
| `git diff --check` | **Passed** |

The worktree remains dirty and no commit, push or CI action was performed.

## Phase 10 — Wire multi-script presentation into runtime

**Status:** Verified; human approval pending
**Estimated scope:** Medium; four to five files
**Dependencies:** P1 checkpoint

### Objective

Apply canonical `lang` and `dir` consistently to learner-facing content.

### Tasks

- Route Lesson, Placement and Catalog content through `scriptPresentation()`.
- Add Arabic/Hebrew RTL fixtures alongside existing Latin/Han/Kana/Hangul cases.
- Apply direction at content containers, not the complete application shell.
- Update release evidence only after runtime tests pass.

### Acceptance criteria

- RTL content has canonical `lang` and `dir="rtl"`.
- Latin and CJK presentation remains LTR.
- Keyboard and control order is unchanged.
- Phase-6 evidence reflects production runtime, not test-only policy.

### Files likely touched

- `src/features/releaseReadiness/multiScriptRelease.ts`
- `src/features/dailyLearning/LessonScreen.tsx`
- `src/features/dailyLearning/PlacementScreen.tsx`
- `src/features/catalogWorkspace/CatalogScreen.tsx`
- Presentation tests

### Verification

```bash
npm test -- --run multiScriptRelease DailyLearningScreens CatalogScreen
npm run test:e2e:phase6
npm run lint
git diff --check
```

### Phase 10 execution record — 2026-08-21 17:31 ICT

Implemented the runtime presentation seam without changing application-shell
direction or control order:

- `scriptPresentation()` now normalizes invalid locale failures to `TypeError`
  and continues to publish canonical language tags with RTL detection for Arabic,
  Persian, Hebrew and Urdu.
- Lesson prompt/content, answer choices and feedback answers now publish
  canonical `lang` plus `dir`; control groups explicitly remain LTR so DOM and
  keyboard order do not reverse.
- Placement question content and choices use the same seam and preserve the
  surrounding session shell as LTR.
- Catalog vocabulary cards apply canonical direction metadata to lemma,
  meanings, translations, examples and collocations without putting RTL on the
  Catalog shell or provenance/action controls.
- Added Arabic/Hebrew fixtures and Latin/CJK regression coverage, including
  shell-scope and control-order assertions.

Verification on the current dirty worktree:

| Gate | Result |
| --- | --- |
| `npm test -- --run multiScriptRelease DailyLearningScreens CatalogScreen` | **Passed: 49/49** |
| `npm run test:e2e:phase6` | **Passed: 6/6 Chromium cases** |
| `npm run lint` | **Passed** |
| `npm run build` (within Phase-6 E2E command) | **Passed** |
| `git diff --check` | **Passed** |

The evidence is still dirty-worktree evidence on `c494d394...`; no commit,
push or CI action was performed. Human approval is required before advancing
to Phase 12.

### Phase 10 residual follow-up — 2026-08-21 18:52 ICT

**Result:** The two P1 review findings and the remaining logical-alignment P2
are closed on the current dirty snapshot.

#### TDD and implementation evidence

- Added RED coverage first; the focused run failed **11 tests** because typed
  answers, sentence tokens, selected sentences, feedback explanations and
  runtime exercises did not yet carry RTL metadata and controls still used
  physical `text-left` alignment.
- Added `answerLanguage` to the exercise contract and derived presentation
  language from bounded learner content at exercise construction. Arabic and
  Hebrew now flow through spelling, sentence-building, recognition and
  Placement instead of being relabeled as English/Vietnamese.
- Added answer-language fields to text/sentence presentation models and an
  `explanationLanguage` field for learner-facing feedback. Lesson inputs,
  sentence tokens and selected sentences now publish canonical `lang`/`dir`.
- Replaced physical `text-left` with logical `text-start` for Lesson and
  Placement answer controls. Learner content overrides the explicit LTR control
  wrapper, while the session shell and DOM/keyboard order remain LTR.
- Added three deterministic Chromium cases using real Arabic/Hebrew local-card
  flows for Lesson and Placement. Catalog uses the production `CatalogScreen`
  rendered into a browser fixture because the product registry intentionally
  has no published shared release; the test does not invent an installable
  catalog or weaken release-unavailable behavior.

#### Residual follow-up verification

| Gate | Result |
| --- | --- |
| `npm test -- --run multiScriptRelease DailyLearningScreens CatalogScreen` | **Passed: 57/57** |
| Focused exercise/presentation RED→GREEN run | **Passed: 48/48** after the initial 11 expected failures |
| `npx playwright test e2e/multi-script-runtime.spec.ts --project=chromium` | **Passed: 3/3** |
| `npm run test:e2e:phase6` | **Passed: 9/9 Chromium cases**, including the 3 multi-script runtime cases |
| `npm test -- --run src/features/dailyLearning` | **Passed: 65/65** |
| `npm test -- --run scripts/architectureAnalyzer.test.ts` | **Passed: 19/19**; production graph remains acyclic |
| `npm run lint` | **Passed** |
| `npm run build` (within Phase-6 E2E command) | **Passed** |
| `git diff --check` | **Passed** |

`artifacts/phase6-readiness.json` remains historical evidence for revision
`0f39689bba0e07cc9a7aa6e53b5ad987612fe7be`; it was not modified or promoted
as proof for the current `c494d394...` dirty snapshot. Exact clean-SHA evidence
still requires the separately authorized commit/push/CI checkpoint from Phase 5.

## Phase 11 — Lazy-bootstrap the application and recover bundle headroom

**Status:** Verified; human approval pending
**Estimated scope:** Medium; four to five files
**Dependencies:** Phase 6 recommended

### Objective

Prevent landing from loading Firebase/library runtime and recover at least 10%
initial-JS budget headroom.

### Tasks

- Capture the current import and preload graph.
- Separate the landing router/shell from authenticated application runtime.
- Lazy-load Firebase, Library Replica and learning coordination after leaving
  landing.
- Preserve direct URLs such as `?view=library`.
- Add regression coverage for auth redirect, browser-extension import and owner
  session initialization.

### Acceptance criteria

- Landing HTML does not module-preload the Firebase chunk.
- Initial JavaScript is no more than approximately 261,000 B gzip.
- The existing 290,000 B budget is not raised.
- Direct URL, auth redirect and browser-extension import still work.
- Runtime is initialized once per owner session with no new race.

### Files likely touched

- `src/App.tsx`
- `src/app/appDependencies.ts`
- One deferred application-shell/bootstrap module
- App composition tests
- Direct-entry E2E tests

### Verification

```bash
npm run build
npm run verify:bundle
npm test -- --run src/app
npm run test:e2e:chromium
npm run verify:secrets
git diff --check
```

### Phase 11 execution record — 2026-08-21 18:39 ICT

The landing/router boundary is now separate from the authenticated runtime. The
landing path loads only the landing shell and landing CSS; Firebase, Library
Replica, catalog runtime and learning coordination remain behind the lazy
`AuthenticatedApp` boundary. Direct `?view=library` entry, auth bootstrap,
browser-extension import and the mounted Landing → Library Quick Start flow were
covered by the Chromium suite. A practice-dialog regression caused by inherited
Tailwind v4 translate variables was fixed by resetting the dialog translation
variables while retaining the visual centering transform.

Verification on the dirty worktree snapshot:

| Gate | Result |
| --- | --- |
| `npm run build` | **Passed** |
| `npm run verify:bundle` | **Passed** — initial JS 203,446 B raw / 64,528 B gzip; initial CSS 54,782 B raw / 10,005 B gzip; total JS 2,033,740 B raw / 651,641 B gzip |
| `npm test -- --run src/app` | **Passed** — 4 files, 35/35 tests |
| `npm run test:e2e:chromium` | **Passed** — 58/58 Chromium cases, including landing preload, direct-entry and practice regressions |
| `npm run verify:secrets` | **Passed** — 86 production files scanned |
| `npm run extension:check` | **Passed** — 116 Node tests plus package/release checks |
| `npm run lint` | **Passed** |
| `git diff --check` | **Passed** |

Initial JS gzip is approximately 64.5 KB, well below the 261 KB Phase 11 target;
the 290 KB budget was not raised. `HEAD` remains
`c494d39421386d70ea8aec675323860b1dadf2a6` and the worktree has 115 modified or
untracked entries. No commit, push or CI action was performed, so this is not
clean-SHA release evidence.

### Phase 11 verification refresh — 2026-08-21 19:00 ICT

The Phase 11 gates were re-run after the later multi-script work, so this record
supersedes the older aggregate bundle and Chromium counts without changing the
implementation. The emitted `index.html` module-preloads only the React vendor
chunk; `AuthenticatedApp` and its Firebase dependency remain dynamic imports.
The landing runtime assertion confirms that neither Firebase nor the
authenticated runtime is requested before a learner leaves landing.

| Gate | Result |
| --- | --- |
| `npm run build` | **Passed** — 1,968 modules transformed |
| `npm run verify:bundle` | **Passed** — initial JS **203,446 B raw / 64,527 B gzip**; initial CSS **54,782 B raw / 10,005 B gzip**; total JS **2,034,897 B raw / 651,902 B gzip** |
| `npm test -- --run src/app` | **Passed** — 4 files, **35/35** tests |
| `npm test -- --run src/features/browserExtension` | **Passed** — 3 files, **29/29** tests |
| `npm run test:e2e:chromium` | **Passed** — **61/61** Chromium cases, including no Firebase request from landing, Landing → Library intent, and direct `?view=library`/Catalog entries |
| `npm run verify:secrets` | **Passed** — 86 production files scanned |
| `npm run lint` | **Passed** |
| `git diff --check` | **Passed** |

The first browser attempt was unable to bind the local preview port inside the
restricted sandbox (`EPERM` before assertions). Re-running the same unchanged
command with the required localhost permission reached all assertions and passed
61/61; it is therefore a host-sandbox limitation, not product failure evidence.
The initial-JS target is met with approximately **196 KB (75.3%)** headroom,
without raising the 290 KB budget. `HEAD` remains `c494d394...`; the worktree is
still dirty and no commit, push, CI run or release artifact was created. Phase 5
remains the required clean-SHA/cross-browser proof boundary.

## Phase 12 — Final verification and acceptance record

**Status:** Blocked — local evidence complete; clean-SHA CI and Firefox host proof pending
**Estimated scope:** Small if all gates are green
**Dependencies:** All approved implementation phases

### Objective

Produce complete, revision-bound final evidence without deploying.

### Tasks

- Run all local quality gates.
- Run Rules and cross-browser gates in the supported environment.
- Run audit, secrets, bundle and extension checks.
- Re-run dead-code, architecture and product-truth review.
- Record exact SHA, environment and results in a new acceptance document.

### Definition of Done

- All accepted phase criteria are satisfied.
- Root, Functions and extension tests pass.
- Firestore Rules emulator passes.
- Chromium, Firefox and WebKit gates pass for the exact revision.
- Security audit and secret scan pass.
- Initial bundle retains at least 10% headroom.
- Architecture analyzer reports no forbidden dependency or unapproved orphan.
- No unsupported user-facing product claim remains.
- No P1 or unaccepted P2 finding remains.
- No deploy, migration or publication happened as a side effect.

### Verification

```bash
npm run verify
git diff --check
```

`npm run verify` must run in an environment that can launch every configured
browser and provide Java 21 for the Rules emulator.

### Phase 12 execution record — 2026-08-21 19:28 ICT

Local evidence was refreshed on the current dirty snapshot rooted at
`c494d39421386d70ea8aec675323860b1dadf2a6`. Core verification passed with
**1,602/1,602** root tests, Functions **75 passed / 2 skipped**, Rules
**48/48** plus Firestore integration **2/2**, extension **116/116**, Chromium
**61/61**, and WebKit **61/61**. Build, typecheck, secrets (86 production
files), bundle, dependency audit, architecture analyzer (**19/19**) and
`git diff --check` passed. Initial JS is **64,529 B gzip**, retaining 75.3%
headroom under the Phase-11 target without increasing the budget.

`npm run verify` cannot be marked green because Firefox cannot launch in this
macOS sandbox (`plugin-container.app: Operation not permitted`) before any
application assertion. The deterministic 15-second launch probe reproduced the
host limitation; it is not counted as a browser pass. The worktree has 126
modified/untracked entries, so the recorded SHA does not attest the exact source
tested. No commit, push, CI, deployment, promotion, migration or publication
was performed. The five known production-orphan candidates were subsequently
resolved in the re-review closure record below; they are not a remaining
acceptance blocker.

The durable detailed record is
[`docs/reviews/phase-12-final-verification-2026-08-21.md`](../reviews/phase-12-final-verification-2026-08-21.md).

### Phase 0–12 re-review remediation closure — 2026-08-21 20:00 ICT

This addendum is the current local status matrix; earlier execution records are
historical evidence and are intentionally retained rather than rewritten.

| Finding | Closure | Regression/evidence |
| --- | --- | --- |
| Phase 1 duplicate terminal error | Persist `errorClaimedAt`, suppress late app results, and retry cleanup without republishing | Extension Node regression covers source/worker close, failed removal, alarm retry and late result suppression |
| Phase 3 unsupported outcome copy | Replaced with capability copy and expanded truth inventory | Landing unit truth test and Chromium landing interaction suite passed |
| Phase 7 production orphans | Deleted four unused `src/` modules; moved Vite-dev-only merge helper into `dev/` | Architecture analyzer **19/19** reports zero `src/` orphan modules; dev helper test passed |
| Phase 8 direct settlement receipt | Recover opaque queue operation durably before settling; only acknowledge after actual durable ack | Replica restart/settlement regression passed |
| Phase 11 provider contact | Removed eager Google/Firebase `preconnect` hints | Landing Chromium regression asserts no provider preconnect, modulepreload, or request |
| Ledger inconsistency | Current header, Phase 0 status, Phase 1 row, Phase 7/12 notes and this matrix agree | This document and the re-review record were updated together |

Fresh local verification on the current dirty worktree:

| Gate | Result |
| --- | --- |
| Root Vitest | **191 files / 1,587 tests passed** |
| Functions | **75 passed / 2 skipped** |
| Rules emulator | **48/48** plus Firestore integration **2/2** passed |
| Extension check | Passed, including the new terminal-error regression |
| Chromium E2E | **61/61** passed |
| WebKit E2E | **53 passed / 8 Chromium-only skips** |
| Architecture analyzer | **19/19** passed; no production orphan or forbidden dependency |
| Build and bundle | Initial JS **203,446 B raw / 64,529 B gzip**; total JS **2,034,824 B raw / 651,857 B gzip**; budget passed |
| Security | Audit: 0 vulnerabilities; secret scan: 86 files passed |
| Diff hygiene | `git diff --check` passed |

The remaining Phase 12 blockers are external and explicitly not performed here:
the 142-entry dirty worktree cannot attest an exact source SHA; the local macOS
Firefox sandbox cannot complete a browser launch; and a clean commit, push and
Quality workflow run require explicit user authorization. No deploy or publish
was performed.

### Phase 5 execution plan — checkpoint-constrained

Phase 5 separates evidence that can be collected without external mutation from
evidence that requires a clean commit and GitHub Actions:

1. **SNAPSHOT:** record current branch, HEAD SHA, dirty-worktree state,
   workflow definitions, Java/runtime versions and build metadata rules. Do not
   create a commit, push, dispatch a workflow or rewrite user changes.
2. **LOCAL RULES:** resolve Java 21 if already installed; run
   `npm run test:rules` and capture whether the current Rules source passes. If
   Java 21 is unavailable, record the environment blocker rather than treating
   historical Rules evidence as current proof.
3. **LOCAL BROWSER:** run `npm run test:e2e:chromium`; inspect the result for
   browser-launch failures before assertions. Run the requested `verify:core` and
   `verify:audit` gates when their local prerequisites are available.
4. **EXTERNAL CHECKPOINT:** verify that the Quality workflow pins artifacts to
   the exact revision and identify the precise commit/push/CI action needed. Do
   not perform it without explicit user authorization.
5. **STOP:** mark only the evidence actually observed on this worktree. Phase 5
   cannot be complete until Rules, all required browser/CI gates and the exact
   SHA are independently proven.

### Phase 5 acceptance and authorization boundary

- Local gates may be run read-only in this dirty worktree.
- A dirty worktree cannot satisfy the exact-SHA release-proof criterion.
- Commit, push, workflow dispatch and any external CI action require explicit
  user permission and are intentionally excluded from this execution.
- No historical Rules/browser/CI result will be relabeled as current-revision
  evidence.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Concurrent dirty-worktree edits | High | Freeze/attribute snapshot in Phase 0; never revert user work |
| Extension cleanup race is timing-dependent | High | Deterministic delayed-storage/onRemoved test before implementation |
| Quick Start accidentally spends AI quota | Medium | Prefill only; require explicit generation action |
| Catalog refactor changes offline behavior | High | Characterization tests before moving runtime ownership |
| Replica migration changes convergence ordering | High | Split contract and caller migration into separate phases |
| RTL applied to the whole shell | Medium | Apply `dir` only to language-bearing content containers |
| Lazy bootstrap introduces auth/owner race | High | Direct-entry, account-switch and extension-import E2E coverage |
| Historical evidence reused accidentally | High | Bind every acceptance record to exact SHA and artifact hashes |
| Bundle target proves unrealistic | Medium | Inspect import graph; do not raise budget; report blocker if target cannot be met safely |
| Catalog/marketing rights remain unclear | High | Remove claims/content until source and license evidence exists |

## Open authorization points

The following require explicit user approval at the time they are reached:

- Which stable commit/snapshot becomes the Phase-0 baseline.
- Whether to run CI for cross-platform Rules/browser gates after a clean snapshot.
- Any commit or push required to run current-revision CI.
- Any change to product positioning beyond removing unsupported claims.
- Any production deployment, Rules promotion, migration or catalog publication.

## Execution ledger

Update this table after every phase. Never mark a phase complete based only on
implementation; required verification and human review must also be complete.

| Phase | Status | Revision/snapshot | Verification evidence | Human approval | Notes |
| --- | --- | --- | --- | --- | --- |
| 0 — Stabilize baseline | **Blocked — historical baseline** | `c494d394...` dirty snapshot | Root tests 1,520 pass; lint blocked by `requestedDeck`; Rules were blocked by missing Java at baseline; build/extension/audit pass | Pending | Baseline remains unresolved as a historical snapshot; OpenJDK 21.0.12 is now available locally and current Rules proof passes |
| 1 — Extension cleanup race | **Verified; re-review P1 closed, human approval pending** | `c494d394...` + dirty remediation changes | Extension check passed; terminal error regression covers source/worker close, failed removal, alarm retry and late result suppression | Pending | Exactly one terminal status is persisted before publication; exact-SHA CI proof remains a Phase 5 gate |
| 2 — Landing Quick Start | **Verified; human approval pending** | `c494d394...` + dirty Phase 2 follow-up changes | Landing 6/6; intake 60/60; Chromium mounted integration 1/1; build, lint and diff-check passed | Pending | Unicode trim and no-AI intent flow are now proven through the real Landing → App → Library path; 80-character contract rejects over-limit input without truncation |
| 3 — Landing truth/accessibility | **Verified; re-review P2 closed, human approval pending** | `c494d394...` + dirty Phase 3 follow-up changes | Landing truth 6/6; axe 3/3 all-impact desktop/mobile; CTA interaction 2/2; lint, build and diff-check passed | Pending | Truthful capability copy, decorative sample speaker, dead Landing prop removal, all-impact axe coverage and CTA click/keyboard coverage are complete |
| 4 — Mobile navigation | **Verified; human approval pending** | `c494d394...` + dirty Phase 1–4 changes | Floating/AppNavigation 24/24; Chromium 56/56; root 1,544/1,544; Functions 75 pass + 2 skipped; extension 102/102 plus package checks; lint, build and diff-check passed | Pending | Production navigation is now the sole Today/Paths/Vocabulary/Progress implementation; MobileNavigation was deleted; Paths/aria-current/44px/320px criteria are green; evidence is still dirty-worktree evidence |
| P1 checkpoint | **Ready for human approval** | `c494d394...` + dirty Phase 1–4 changes | Root 1,544/1,544; Functions 75 pass + 2 skipped; extension 102/102 plus package checks; Landing 6/6 + Quick Start 1/1 + all-impact axe 3/3 + CTA 2/2; Chromium 56/56; Mobile Paths 320px E2E passed | Pending | Phase 4 code meets the technical checkpoint; Rules emulator remains blocked by missing Java 21 as a separate release blocker, and exact-SHA evidence still requires a clean authorized commit/CI run |
| 5 — Current-revision proof | **Blocked — local gates green** | `c494d39421386d70ea8aec675323860b1dadf2a6` + dirty worktree | Rules 48/48 + Firestore integration 2/2; default `test:rules` wrapper resolves OpenJDK 21.0.12; `verify:core` root 192/1,553 and Functions 75 + 2 skipped; Chromium 56/56; audit 0 high; release-contract tests 28/28; diff-check passed; no CI run for HEAD | Pending | Local Java/PATH tooling gap is closed. Exact-SHA proof cannot be claimed until a clean authorized commit is pushed and Quality/release-candidate CI passes Rules + Chromium/Firefox/WebKit; no external action performed |
| 6 — Catalog runtime | **Verified; human approval pending** | `c494d394...` + dirty Phase 6 changes | Focused Catalog/App **91/91 across 13 files** using the Phase 6 command; `test:phase6` 74/74; Catalog Chromium E2E 2/2; lint, build, bundle and diff-check passed | Pending | The historical 106/106 included additional App composition coverage. CatalogWorkspace has one injected runtime port, no `appDependencies` import, owner-scoped Learning State preserved, duplicate install/readPage adapters removed; heavy runtime imports remain dynamic; evidence remains dirty-worktree evidence |
| 7 — Architecture analyzer | **Verified; re-review orphan closure complete, human approval pending** | `c494d394...` + dirty Phase 7 hardening changes | Analyzer 19/19; production graph acyclic; no `src/` orphan; normalized reverse feature→app, Catalog, type-only, orphan navigation, dynamic import and allowlist fixtures pass | Pending | Four unused production modules were deleted; the only dev-only helper moved under `dev/` with its Vite owner. No commit/push/CI action performed |
| 8 — Replica intake contract | **Verified; re-review P2 closed, human approval pending** | `c494d394...` + dirty combined Phase 8/9 changes | Replica settlement recreation regression plus focused intake/library/Rules evidence pass | Pending | Both resolve and public settle recover a durable receipt operation, preserve acknowledge-last and report `acknowledged` truthfully |
| 9 — Card Intake migration | **Verified; high-risk human checkpoint pending** | `c494d394...` + dirty combined Phase 8/9 changes | Intake/Library focused 174/174; device reconciliation 76/76; Rules 48/48 + Firestore integration 2/2; lint, build and diff-check passed | Pending | Stale receipts cannot publish or award XP; pipeline revalidates owner/epoch after async staging; signed-in and anonymous intake both route through Library Replica factories. Worktree remains dirty; no commit/push/CI action performed |
| 10 — Multi-script runtime | **Verified; review residuals closed, human approval pending** | `c494d394...` + dirty Phase 10 follow-up changes | Multi-script/presentation **57/57**; Daily Learning **65/65**; architecture **19/19**; multi-script Chromium **3/3**; Phase-6 Chromium E2E **9/9**; build, lint and diff-check passed | Pending | Text and sentence answers, feedback explanations and Placement now receive runtime language metadata; logical `text-start` alignment and browser focus order are proven. Historical `phase6-readiness.json` is explicitly excluded from current evidence; exact-SHA proof remains a Phase 5 authorization gate |
| 11 — Lazy bootstrap/bundle | **Verified; re-review provider-contact policy closed, human approval pending** | `c494d39421386d70ea8aec675323860b1dadf2a6` + dirty Phase 1–11 changes | Build + bundle passed; initial JS **203,446 B raw / 64,529 B gzip**; Chromium **61/61**; secrets, lint and diff-check passed | Pending | Landing has no Firebase modulepreload/request **or provider preconnect** before an action; AuthenticatedApp/authenticated CSS remain lazy; budget unchanged with 75.3% headroom |
| 12 — Final verification | **Blocked — only external exact-SHA/Firefox proof remains** | `c494d394...` + dirty worktree | Root 191/1,587; Functions 75 pass + 2 skipped; Rules 48/48 + integration 2/2; extension check; Chromium 61/61; WebKit 53 pass + 8 skips; build, secrets (86), bundle (64,529 B gzip), audit (0 vulnerabilities), analyzer 19/19 and diff-check pass | Pending | No known P1/P2, unsupported landing claim or `src/` orphan remains. Firefox host launch and an authorized clean commit/push + Quality CI exact-SHA run are required; no deploy/publish occurred. See `docs/reviews/phase-12-final-verification-2026-08-21.md` |

## Resume instruction

When asked to continue this remediation plan:

1. Report the current phase from the execution ledger.
2. Re-check `git status --short` and the current HEAD.
3. Compare the worktree with the snapshot recorded for that phase.
4. Restate the phase objective, acceptance criteria and files in scope.
5. Obtain approval if the phase has not already been approved.
6. Use test-driven development for behavior changes.
7. Execute only that phase.
8. Update the ledger and stop for review.
