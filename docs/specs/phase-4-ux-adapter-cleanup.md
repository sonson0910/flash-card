# Phase 4 UX and development-adapter cleanup

## Scope

Phase 4 improves the existing Library, Today, and Progress experiences and deepens the installed-Catalog read seam without changing the Catalog/Library boundary, learning write path, or Library Replica invariants.

## Behavioral contracts

### Library management

- Export and Clear are grouped behind one visible `Manage library` disclosure in the Library workspace.
- The disclosure is available at desktop and mobile widths, supports keyboard navigation, exposes expanded state, closes with Escape, and returns focus to its trigger.
- Clear continues through the existing confirmation dialog. The stable disclosure trigger is the dialog's focus-return target.
- Export exposes its pending state and cannot be started twice.

### Learning calls to action

- Empty Today offers explicit ways to add vocabulary or browse reviewed learning paths.
- Empty Progress offers `Start your first review` when vocabulary exists and `Add vocabulary` when it does not.
- These actions reuse existing navigation and Practice coordination; they introduce no new learning write path.

### Focus

- Merely mounting a screen, loading data, changing owner, or changing a lesson phase does not move focus.
- A user or browser navigation intent may move focus to the destination heading.
- Required focus restoration after dialogs/destructive mutations remains allowed.
- Every custom control retains a visible `:focus-visible` treatment.

### Shared Device Store

- Vite configuration declares plugins and build settings only.
- The development-only Shared Device Store owns local trust checks, filesystem locking, merge/reconciliation, SSE, and endpoint registration behind one typed Vite plugin factory.
- Endpoint behavior and owner-conflict protections remain unchanged.
- The adapter and Vite config contain no explicit `any` types.

### Installed Catalog page reads

- One `readCatalogCachePage` call owns active-release lookup, complete-release validation, indexed membership paging, and lexeme hydration.
- The active pointer, release record, memberships, and lexemes are read inside one IndexedDB readonly transaction, so activation cannot produce a page that mixes two releases.
- Paging cursors remain bound to the active release and filter signature. Incomplete releases are not readable, and missing or identity-mismatched lexemes fail explicitly.
- `CatalogWorkspace` coordinates one page request and one stale-result check; it does not sequence query and hydration itself.
- `queryCatalogCache` remains an internal compatibility seam, but production composition exposes only the hydrated page read.

## Non-goals

- No Firestore, Rules, migration, IndexedDB schema, Catalog install/delivery, or FSRS behavior changes.
- `catalogCache.ts` is not split mechanically. The deep seam is limited to the concrete Catalog query/hydration coordination problem in `catalogIndex.ts` and its callers.

## Acceptance

- Focused unit, release-race regression, and source-contract tests pass.
- Keyboard/a11y and desktop/mobile Playwright checks pass on Chromium.
- Core verification, production build, bundle budget, architecture graph, and `git diff --check` pass.
