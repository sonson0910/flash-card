# Phase 4 — Catalog UI and learning paths

Date: 2026-08-04

Status: workspace implementation accepted locally with fixtures; no catalog
release is published and release acceptance remains blocked

Execution gate: allowed by the user's request to execute all of Phase 4.

## Problem

Phase 3 provides a strict, versioned, offline catalog runtime but the learner
cannot discover a language, choose IELTS/TOEIC/General, download an approved
release, browse tiers, combine catalog filters, inspect full Lexeme content or
see learning-path progress. The existing Library screen represents learner-owned
cards and must not be overloaded with shared read-only catalog semantics.

## Goal

Add a lazy, accessible Catalog workspace that turns an installed published
catalog into a clear learning path while preserving the existing Library,
Study, Practice and Insights behavior. All UI state must be URL-addressable and
history-safe; catalog download must remain same-origin, bounded and atomic.

## Scope

- Language selector backed by a registry, initially English plus honest
  unavailable states for future languages.
- IELTS, TOEIC and General track cards with total/started/mastered summaries.
- Foundation, Core and Advanced roadmap with explicit text/icon state, not color alone.
- Combined filters: tier, CEFR, topic, part of speech, skill and lemma prefix.
- Cursor-based catalog browsing, full Lexeme hydration and responsive cards.
- Same-origin reviewed catalog download with progress/status/error/retry states.
- Owner Learning State progress projection, bounded to the 10,000-item catalog limit.
- URL state, back/forward restoration and preservation of unrelated parameters.
- Lazy App composition and navigation entry without eagerly loading catalog UI.
- WCAG 2.2 AA-oriented automated and manual verification.

## Non-goals

- Publishing the Phase 3 AI-assisted pilot or showing draft content to learners.
- Human review, license approval, production import, migration or deployment.
- Phase 5 daily plans, placement checks or new exercise engines.
- Replacing the existing learner-owned Library or removing Practice behavior.
- Claiming Japanese/Korean/Chinese content exists before approved releases exist.

## Architecture decisions

1. A separate `features/catalogWorkspace` vertical slice owns the UI/controller;
   Library remains learner-owned cards.
2. `AppViewMode` gains `catalog`; the screen is dynamically imported. Existing
   mobile navigation gains a Paths destination. The final four-item Today/Paths/
   Vocabulary/Progress information architecture waits for Phase 5's Today screen,
   avoiding a behavior-breaking removal of Practice in Phase 4.
3. A pure URL controller owns `catalog`, `lang`, `track`, `tier`, `cefr`, `topic`,
   `pos`, `skill` and `term`. It preserves UTM/unknown parameters, resets the
   cursor on filter change and restores state on `popstate`.
4. Catalog summaries/progress are computed in a bounded release-scoped IndexedDB
   cursor operation. Learning State is supplied as a map keyed by Lexeme ID; an
   installed catalog never implies learning progress.
5. Download first fetches a bounded same-origin manifest, then reuses Phase 3's
   verified atomic installer. A missing manifest is an honest unavailable state.
6. The learner screen reads only published installed releases. The draft pilot is
   used only in pipeline tests and never imported by production UI.
7. English registry metadata is configuration, not a hard-coded query engine;
   adding a language requires a reviewed release plus registry entry, not UI rewrites.

## URL contract

Example:

`/?view=catalog&catalog=english-core&lang=en&track=ielts&tier=foundation&cefr=A2&topic=education&pos=noun&skill=reading&term=learn`

Rules:

- every value is bounded before use;
- unknown language/track/tier values fall back deterministically;
- empty/default filters are omitted from the canonical URL;
- filter or language/track changes reset paging cursor;
- back/forward restores the visible screen and filters without network writes;
- unrelated parameters and hash fragments survive updates.

## UX states

- `checking`: announce cache status without blocking the shell;
- `unavailable`: no reviewed release; explain that draft vocabulary is not published;
- `downloading`: disable duplicate actions and announce progress/status;
- `ready`: render language, tracks, roadmap, filters and vocabulary;
- `empty-filter`: keep filters visible and offer reset;
- `offline-ready`: explicitly say the installed release is available offline;
- `offline-missing`: explain that first download needs a connection;
- `error`: actionable retry with technical detail hidden from the primary message.

## Work breakdown and ownership

### Task 1 — Domain and URL controller

- Language/track registry and pure validated selection model.
- Catalog URL read/write/history controller.
- Progress aggregation contracts and tier state derivation.
- RED/GREEN unit tests for bounds, canonicalization and history restoration.

Own: `src/features/catalogWorkspace/*Query*`, registry/progress domain files.

### Task 2 — Runtime/cache and download seam

- Active release inspection and bounded summary/progress API.
- Bounded same-origin release-manifest fetch with timeout and strict parser.
- Workspace controller for check/download/query/hydrate/retry/load-more.
- Owner Learning State progress adapter; no catalog writes outside installer.

Own: catalog cache/runtime additions and catalog workspace controller/hooks.

### Task 3 — Accessible responsive presentation

- Catalog screen, language switcher, track cards, tier roadmap, filters,
  vocabulary cards, skeleton/empty/error/offline states.
- Semantic landmarks/headings; native controls; 44px targets; live regions;
  visible focus; reduced motion; 320px reflow; no color-only status.

Own: catalog workspace TSX/presentation tests and scoped styles only.

### Task 4 — App/navigation integration

- Lazy catalog screen boundary in composition root/App.
- Desktop and mobile Paths navigation with focus restoration.
- `view=catalog` deep link and browser history integration.
- Preserve Library/Study/Practice/Insights contracts.

Own: App navigation/shell/App composition tests.

### Task 5 — Independent review and acceptance

- Architecture/security/readability review.
- WCAG automated scan plus manual keyboard/focus/reflow checks.
- Bundle/performance review and 10,000-item structural progress test.
- Remediate every Critical/Required finding before completion.

## Acceptance criteria (Definition of Done)

1. Opening `?view=catalog` focuses the Catalog heading and does not load catalog
   code in the initial JS chunk before navigation.
2. Language/track/filter state round-trips through the URL, preserves unrelated
   params and restores via back/forward.
3. English exposes IELTS, TOEIC and General; unavailable languages are clearly
   disabled/labeled and trigger no catalog fetch.
4. A deterministic same-origin release fixture downloads atomically, becomes
   available offline and survives reload; corrupt/partial/download failures keep
   the prior release. This is runtime proof, not publication evidence.
5. The UI never displays Phase 3 draft pilot entries as published learner content.
6. Track and tier totals are derived from the active release. Started/mastered
   values come only from validated Learning State and are never inferred from install.
7. All combined filters map to the indexed query API, reset paging, and hydrate
   full meanings/examples/collocations/provenance in batches of at most 100.
8. Load-more uses opaque cursors, prevents stale-response replacement and never
   scans beyond the configured query cap per request.
9. Loading, unavailable, empty, offline, error and ready states are visually and
   programmatically distinct with useful retry/reset actions.
10. Keyboard users can reach and operate every control; focus moves to the view
    heading on navigation and returns predictably after dialogs/actions.
11. Catalog screen has no serious/critical axe violations, reflows at 320px,
    supports 200% text and reduced motion, and never relies on color alone.
12. Existing Library/Study/Practice/Insights unit and E2E behavior remains green.
13. Root/Functions lint, tests and build; catalog gates; release build; secret
    scan; bundle budget; dependency audit; Chromium and WebKit E2E pass.
14. Initial JavaScript remains under 280,000 gzip bytes; catalog presentation and
    data adapters remain lazy chunks. Any budget pressure is recorded explicitly.

## Test matrix

- Small: URL parser/controller, registry, tier/progress derivation, stale request reducer.
- Medium: fake-indexeddb summaries/progress, manifest fetch/download, React screen states.
- Large: deep link/history, offline reload, download failure rollback, keyboard,
  320px/desktop layout and axe on Chromium; product regression on WebKit.

## Boundaries

- Always: validate before I/O, keep catalog read-only, retain prior complete
  release, preserve learner progress, lazy-load large code and use TDD.
- Ask first: reviewed dataset ingestion, named reviewer/license approval,
  staging/production deploy, migration or import apply.
- Never: publish or render draft pilot as approved content, call generated content
  official, manufacture progress, trust URL/manifest fields, or mix shared catalog
  data with learner-owned Learning State.

## Completion evidence required

Status may move to `accepted` only after fresh commands and runtime evidence map
to every criterion above. Environment blockers such as missing Java must be
reported separately and cannot be described as passing.

## Completion evidence — 2026-08-04

Implemented locally on `codex/phase-4-catalog-ui` without catalog publication,
production import, migration or deployment.

- Separate lazy Paths/Catalog workspace; Library remains learner-owned.
- English registry exposes IELTS, TOEIC and General plus Foundation/Core/Advanced;
  Japanese, Korean and Chinese are visibly unavailable rather than simulated.
- URL/history, combined indexed filters, opaque cursors, fixture-backed Lexeme
  hydration, active-release summaries and validated Learning State progress are wired.
- Same-origin bounded manifest/chunk download uses Phase 3 checksum validation and
  atomic activation; incomplete or invalid releases cannot replace the active release.
- Independent review found three required offline/stale-workflow races. All three
  were fixed with regression tests; final re-review found no Critical/Required issues.
- App tests: 751/751; Functions tests: 25/25; catalog verify: 165/165.
- Chromium: 36/36. WebKit: 35/35 plus the existing configured Chromium-only axe
  test skip. The fixture-backed Catalog journey passes on both engines with browser
  offline mode, reload,
  keyboard focus, 320px reflow and 200% root text. Chromium has no serious/critical
  axe findings for the Catalog journey.
- Fresh build and secret scan pass. Initial JavaScript is 278,226 bytes gzip out of
  280,000; the Catalog workspace is a separate 11.91 KiB gzip lazy chunk. The small
  1,774-byte headroom is a recorded constraint for subsequent phases.
- Root dependency audit reports zero vulnerabilities. Functions audit has one
  moderate PostCSS development-tool advisory; the high/critical audit gate passes.

Release acceptance remains explicitly blocked, not passed:

- `public/catalog/english-core/` is empty and the registry marks English, Japanese,
  Korean and Chinese unavailable; no licensed/reviewed release is available.
- Firestore Rules emulator cannot start because Java is absent from this machine.
- Production release configuration is unavailable locally: `.env.production`,
  `VITE_FIREBASE_APP_CHECK_SITE_KEY` and an immutable release revision are missing.
- No real staging smoke, canary, production deploy or rollback exercise ran.

These blockers do not affect the local Phase 4 implementation evidence, but they
must be cleared before a production release can be called accepted.
