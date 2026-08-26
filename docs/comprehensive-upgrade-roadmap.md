# SonFlash Comprehensive Upgrade Roadmap

Date: 2026-07-26

## Executive verdict

SonFlash already has a strong product foundation: an offline-first card library,
stable normalized word identities, durable pending operations, bounded Firestore
queries, spaced repetition, accessible card interactions, and a useful automated
test suite.

The next release should not lead with more surface features. It should first make
the data mutation protocol conflict-safe, separate the application controller
into testable domains, and turn the documented release checklist into enforced
CI gates. Product polish and new learning experiences should follow on top of
that foundation.

Current verdict: **not ready for a broad production rollout**.

## Historical evidence baseline (2026-07-26)

- CodeGraph: 123 indexed files, 997 symbols and 1,762 edges.
- Main architecture hotspot: `src/App.tsx` has 2,963 lines, 27 `useState`,
  29 `useEffect`, 18 `useCallback`, and 15 `useRef` calls.
- Automated verification:
  - 181/181 application tests passed.
  - 14/14 Cloud Functions tests passed.
  - 29/29 Chromium E2E tests passed.
  - Root TypeScript, Functions build, production build, and artifact secret scan passed.
  - Functions dependency audit reported zero vulnerabilities.
- Open release evidence:
  - Root dependency audit reports one High advisory through `postcss@8.5.10`.
  - Firestore Rules emulator was not run because the machine has no Java runtime.
  - There is no repository CI workflow.
  - Production App Check configuration has not been verified.

## Execution status correction (2026-08-10)

This roadmap began as a proposal and its baseline numbers above are intentionally
historical. Phases 0–6 now have substantial local implementation and fixture-backed
tests, but that does not mean every product or rollout dependency exists:

- `public/catalog/english-core/` is empty and every configured language remains
  `unavailable`; no English, Japanese, Korean or Chinese release is published;
- catalog install/query/offline browser evidence uses deterministic fixtures. It
  proves the runtime contract, not source rights, editorial approval or content
  availability;
- the staging smoke transport, canary policy and rollback runbook are implemented
  and locally tested, but no authorized real staging smoke, canary observation,
  production deployment, traffic promotion or rollback exercise is recorded;
- current worktree evidence and environment blocks live in the
  [2026-08-10 closure acceptance record](reviews/comprehensive-upgrade-closure-2026-08-10.md).

Repository release controls now seal one verified candidate with a revision/component
digest manifest. Production promotion downloads that exact candidate rather than
rebuilding it, orders separately approved Functions and Hosting from their compatibility
decision (with additive callable endpoints deployed first), and
never includes Firestore Rules in the normal workflow. Rules have a separate fail-closed
cutover/rollback workflow requiring fresh Admin evidence, exact digests and a protected
approval. These are configured controls only: the production environments, authorized
Admin migration/evidence producer, App Check observation, deployment and rollback
exercise remain external gates and are not claimed as executed.

Accordingly, “implemented locally” below refers to code and local/fixture evidence
only. It never means catalog published, staging verified or production approved.

## Product principles for this release

1. Never lose or silently overwrite learning progress.
2. A repeated word is one logical card across every creation and import path.
3. Offline actions are immediately useful and visibly recoverable.
4. Loading, errors, and synchronization always explain what happened and what
   the user can do next.
5. Motion supports spatial understanding; it never blocks content.
6. Release readiness is proven by automated gates, not a manual checklist.
7. Large-library behavior must stay bounded in memory, network reads, and UI work.

## P0 — release blockers

### 1. Replace full-card retry upserts with conflict-aware commands

Pending full-card upserts can overwrite newer cloud learning state. Introduce a
single mutation protocol with:

- `opId`
- `operation: create | patch | review | delete`
- `baseRevision`
- `fieldMask`
- `libraryEpoch`
- server-assigned `updatedAt`

Only a true create may carry a full card. Existing cards must be updated with
field-level commands or a dedicated review transaction.

Evidence:

- `src/lib/cardCreation.ts:86`
- `src/App.tsx:691`
- `src/lib/cardCreation.test.ts:123`

### 2. Prevent offline devices from resurrecting deleted cards

Clear-all currently clears the active device and cloud, but another offline
device can later flush stale upserts. Add a server-owned `libraryEpoch`, include
it in every mutation, and reject mutations from older epochs. Use revisioned
tombstones for per-card deletion.

Evidence:

- `src/lib/deviceSync.ts:63`
- `src/App.tsx:691`
- `src/App.tsx:2162`

### 3. Make every creation path atomic and duplicate-safe

Manual creation already has a create-if-absent path, but spreadsheet and shared
deck imports still use preflight-then-write flows with a race window. Route
manual create, spreadsheet import, shared deck import, and media repair through
one repository/sync engine.

Evidence:

- `src/features/importExport/useSpreadsheetImport.ts:89`
- `src/features/importExport/useSpreadsheetImport.ts:144`
- `src/features/importExport/useSpreadsheetImport.ts:206`
- `src/features/importExport/useSpreadsheetImport.ts:235`
- `src/App.tsx:1352`
- `src/App.tsx:1375`

### 4. Verify production App Check before rollout

Cloud Functions enforce App Check by default, while the client can still start
without a production site key. A production build must fail when the key is
missing, and staging smoke tests must verify Auth, App Check, Firestore, AI, and
image calls together.

Evidence:

- `src/lib/firebase.ts:28`
- `functions/src/index.ts:12`

### 5. Patch the High build dependency advisory

Update the lockfile so the Vite dependency tree no longer resolves to the
vulnerable PostCSS version. Re-run full root and Functions audits after the
upgrade.

Evidence:

- `package-lock.json:3958`
- `package-lock.json:4612`

### 6. Add an enforced release pipeline

Create CI with Node 22 and Java 21. It must block release on:

1. clean install for root and Functions;
2. dependency and secret audit;
3. TypeScript;
4. application and Functions tests;
5. Firestore Rules emulator tests;
6. production build and bundle budgets;
7. accessibility checks;
8. Chromium, Firefox, and WebKit E2E;
9. staging smoke tests.

Firebase predeploy should call the same verified release command instead of only
building Functions.

Evidence:

- `package.json:6`
- `firebase.json:2`
- missing `.github/workflows`

## P1 — architectural upgrade

### Decompose the application controller

Split `App.tsx` into domain controllers and views:

- auth/session
- library query and URL state
- mutation and synchronization
- creation and media repair
- import/export
- sharing
- practice/study
- overlays and notifications

Use reducers or explicit state machines for synchronization and card creation so
invalid combinations such as loading + failed + stale user session cannot arise.
Keep Firestore calls behind one repository boundary.

### Introduce a versioned data model

Add:

- `schemaVersion`
- immutable `createdAt`
- server `updatedAt`
- `revision`
- `libraryEpoch`
- `lastOpenedAt` or `sortTouchedAt`

Stop using `createdAt` to move an existing card to the top. That behavior
currently corrupts creation history, date filters, and exported “Date Added”.

Evidence:

- `src/features/library/libraryPresentation.ts:66`
- `src/App.tsx:1995`
- `src/features/importExport/useSpreadsheetImport.ts:219`

### Move the local mirror to incremental synchronization

Mirror freshness based on age and count cannot detect a changed or deleted card
when the total stays constant. Add a watermark/change sequence and local indexes
for category, deck, difficulty, bookmark, normalized word, and sort order.
Coordinate sync between tabs with an atomic lock.

Evidence:

- `src/lib/cardMirror.ts:32`
- `src/lib/cardMirror.ts:305`
- `src/App.tsx:771`

### Redesign the pending store

Store one IndexedDB record per operation, indexed by user, card, status, and
creation time. Avoid rewriting one full pending array for every mutation. Make
acknowledgement idempotent and based on operation ID, not client timestamps.

Evidence:

- `src/lib/pendingOperationStore.ts:63`
- `src/lib/deviceSync.ts:85`
- `src/lib/deviceSync.ts:323`

### Clean legacy duplicates in the cloud

Current presentation logic hides or prefers one duplicate, but old documents
remain in Firestore. Add an idempotent, resumable migration that:

1. groups by normalized word;
2. selects a primary card by learning progress;
3. merges useful content and media;
4. preserves the earliest real creation date;
5. tombstones/deletes losing documents;
6. rebuilds facets and validates counts.

Evidence:

- `src/lib/cardMirror.ts:239`
- `src/lib/cardRepository.ts:195`

### Make bulk work resumable

Clear-all, deck deletion, duplicate cleanup, and full-library media repair should
be resumable server jobs with job state, idempotency, progress, and cancellation.
Do not run an unbounded image backfill during normal app startup.

### Strengthen Rules and shared decks

- Reject unknown card and profile fields.
- Validate timestamps and every list item.
- Validate the full shared-card schema.
- Create shared decks through a callable with quota and rate limits.
- Add expiry, revoke, ownership management, and abuse controls.
- Clearly disclose when a share is capped or incomplete.

Evidence:

- `firestore.rules:193`
- `firestore.rules:250`
- `firestore.rules:255`

## P1 — product and UX upgrade

### Make the main intent unambiguous

- **Consider** opens or focuses the card as a learning object.
- **Search** filters the library only.
- Entering an existing word promotes it using `lastOpenedAt`, hydrates missing
  media, and never creates another logical card.

Add direct E2E coverage for these distinctions.

### Add a compact sync-health surface

Use four user-facing states:

- Saved
- Saving offline
- Syncing
- Needs attention

Show pending count/age only when useful. “Needs attention” provides Retry and a
plain-language explanation of where the data is stored. Do not expose internal
Firebase verification language to users.

### Standardize async states

- Immediate local response for every mutation.
- Skeletons for bounded content loading.
- No indefinite spinner.
- A two-second threshold before explanatory slow-state copy appears.
- Errors always state: what happened, whether data is safe, and the next action.

### Keep and refine the card experience

Keep:

- the 3D card flip;
- Vietnamese rich explanation rendering;
- reduced-motion behavior;
- focus restoration;
- 44 px touch targets;
- restrained motion for utilities and expressive motion for learning rewards.

Add:

- a user-controlled Replace/Hide image action;
- a purposeful missing-image placeholder;
- no layout shift when an image arrives;
- Markdown regression tests for bold, lists, blockquotes, and malformed model output.

### Make learning the product hierarchy

The primary daily path should be:

1. Continue due reviews.
2. Add or import vocabulary.
3. Practice weak words.
4. Review progress.

Library management, sharing, export, and advanced filters remain available but
should not compete visually with the daily learning action.

## P2 — performance, accessibility, and operations

### Performance budgets

Current large raw chunks:

- Firebase: about 594 KB
- XLSX: about 500 KB
- StatsCharts: about 418 KB
- Motion: about 131 KB

Retain lazy loading, then add budgets for initial JavaScript, CSS, LCP, INP, and
CLS. Run Lighthouse CI with mobile throttling. Remove unused public brand source
assets from deployment.

### Accessibility gates

Target WCAG 2.2 AA and add automated axe checks plus manual release checks for:

- keyboard-only operation;
- visible focus;
- screen reader announcements;
- 200% text zoom;
- 320 px reflow;
- light/dark/high-contrast palettes;
- reduced motion;
- error identification and recovery.

### Observability and cost controls

Add structured, privacy-aware telemetry for:

- pending depth and oldest operation age;
- conflict and rejected stale mutation count;
- mirror lag and duplicate count;
- image repair success and latency;
- AI/image error and rate-limit rates;
- Firestore reads/writes and estimated cost;
- App Check rejection rate;
- release version and correlation ID.

Add project-level daily budgets, billing alerts, burst limits, and an AI/image
kill switch.

### Release and rollback

- Keep staging and production Firebase authority separate.
- Build once, seal deployable files plus readiness evidence to a full revision and
  candidate SHA-256, and promote only that retained artifact. A same-revision rebuild is
  not equivalent rollback evidence.
- Promote Hosting first. Observe the compatible App Check client and obtain a separate
  protected approval before Functions enforcement; never use a generic all-target deploy.
- Keep Firestore Rules behind a separate workflow that requires project/database/rules/
  client-bound Admin migration evidence, external-KMS encrypted rollback ciphertext
  digest, final delta check and protected cutover approval. Actions never retains the
  plaintext snapshot or decryption authority.
- Use versioned health metadata and synthetic checks, then make canary decisions from an
  exact bounded schema. The decision remains advisory and never changes traffic.
- Retain target-specific last-known-good artifact/digest and compatibility evidence for
  Hosting, Functions, Rules and data rollback. Re-run smoke after every restoration.

## Keep / change / add / remove

### Keep

- Offline-first product direction.
- Stable normalized word IDs.
- Field-level patch queue and pending overlay.
- User-scoped IndexedDB mirror with generation guard.
- Bounded Firestore pages and listeners.
- App Check, authenticated callable functions, input bounds, rate limiting.
- Default-deny owner-isolated Firestore Rules.
- Media URL allowlists.
- Card flip, rich Vietnamese content, accessibility and motion foundations.
- Existing unit and E2E regression coverage.

### Change

- One repository/sync engine owns every cloud write.
- Conflict-aware commands replace full-card retries.
- Incremental mirror replaces periodic full rescans.
- `lastOpenedAt` replaces mutation of `createdAt`.
- Bulk client loops become resumable jobs.
- Console-only errors become structured observability and actionable UX.
- Product hierarchy centers daily review rather than management controls.

### Add

- Versioned schema, revision, epoch, tombstones, watermarks.
- Sync-health UI and conflict recovery.
- Duplicate cleanup and media repair jobs.
- Strict schema Rules and Rules tests.
- Share management, expiry, revoke, and privacy controls.
- CI, accessibility, performance, staging, canary, and rollback gates.
- Product metrics for activation, review completion, retention, and sync trust.

### Remove or reduce

- Full-card upsert for existing cards.
- `createdAt` promotion.
- Preflight-then-write import flows.
- Indefinite loading and internal Firebase error copy.
- Scattered direct Firestore writes in UI controllers.
- Legacy duplicate fallbacks after migration is proven.
- Production-facing assumptions about the dev-only shared device endpoint.
- Automatic unbounded background work on app startup.
- Unused public brand source assets.

## Migration and rollout sequence

### Phase 0 — prove the release

- Patch PostCSS.
- Add CI and Java-backed Rules tests.
- Verify App Check and staging.
- Add release versioning, smoke checks, monitoring, and rollback.

### Phase 1 — protect data

- Introduce dual-compatible v2 fields.
- Route every create/import/share through create-if-absent.
- Introduce operation IDs, revisions, epochs, and tombstones.
- Migrate pending operations without converting them to unsafe full upserts.

### Phase 2 — migrate and simplify

- Run duplicate cleanup per user with dry-run reports.
- Upgrade IndexedDB and validate counts/hashes before removing v1 data.
- Rebuild facets.
- Stop mutating `createdAt`.
- Remove proven-obsolete legacy repair paths.

### Phase 3 — upgrade the experience

- Ship sync health and standardized async states.
- Clarify Consider versus Search.
- Refine media repair, card motion, and learning hierarchy.
- Add complete accessibility and cross-browser gates.

### Phase 4 — expand learning value

- Use observed learning data to improve daily plans and weak-word practice.
- Add growth features only when reliability, retention, and cost dashboards are stable.

## Required acceptance gates

These are release gates, not a list of completed work. In particular, fixture
tests cannot satisfy gate 12 and local policy tests cannot satisfy gate 13.

1. Two devices create/review the same word without duplicates or lost history.
2. An offline device cannot resurrect a card after delete or clear-all.
3. Import/share concurrent with create/review cannot overwrite the existing card.
4. Account switches during sync, hydration, or clear cannot write across users.
5. A 10,000-card library supports exact lookup and indexed filters without a
   full IndexedDB scan or blocked UI.
6. Duplicate migration is idempotent, has a dry run, and can be rolled back.
7. Existing-card media repair is idempotent and never blocks card access.
8. Consider never becomes Search; URL/filter/focus state remains intentional.
9. Card flip, reduced motion, Vietnamese Markdown, offline reload, and sync retry
   have E2E coverage.
10. WCAG 2.2 AA automated checks have zero serious/critical violations.
11. Rules emulator, dependency audits, secret scan, build, unit, Functions, and
    three-browser E2E all pass in CI.
12. Staging smoke tests prove App Check/Auth/Firestore/AI/image integration.
13. Production rollout has measurable rollback thresholds for error rate,
    latency, sync loss, quota, and cost.

## Success metrics

- Duplicate logical words: 0 after migration.
- Lost or resurrected cards: 0 in conflict test matrix.
- Pending operation p95 age while online: under 60 seconds.
- Local action feedback: under 300 ms.
- Cached library content visible: under 500 ms.
- Indefinite loading states: 0.
- AI/image failure never blocks existing-card access.
- Serious/critical accessibility violations: 0.
- Root and Functions dependency High/Critical advisories: 0.
- Crash-free sessions and sync-success rate visible by release version.
