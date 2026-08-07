# ADR-003: Separate catalog workspace from learner library

Date: 2026-08-04

Status: Accepted for Phase 4 local implementation

## Context

The existing Library owns learner-created cards, mutations, decks and legacy
v2 compatibility. Phase 3 introduced a shared, read-only, versioned catalog with
atomic IndexedDB delivery and separate Learning State. Reusing the Library screen
for catalog browsing would mix ownership, write permissions, URL filters and
offline lifecycles that have different invariants.

Phase 4 must expose language/track/tier navigation, combined catalog filters,
progress and download states while keeping the initial bundle below its existing
budget and preserving Library/Study/Practice behavior.

## Options considered

| Option | Benefits | Costs |
| --- | --- | --- |
| Add catalog modes to Library | Fewer top-level screens | Couples shared and learner-owned data; ambiguous mutation controls; larger Library contract |
| Separate catalog workspace | Clear ownership, URL and offline state; independently lazy | One new view and adapter boundary |
| Replace Library with catalog | Simplest future IA | Breaks existing cards, intake, decks and practice behavior |

## Decision

Create a separate lazy `catalogWorkspace` vertical slice and add a Catalog/Paths
view to application navigation. Library remains the mutable learner-owned view.
Catalog presentation consumes only bounded ports for active-release summary,
verified download, indexed query, Lexeme hydration and Learning State progress.

The final four-item Today/Paths/Vocabulary/Progress mobile information architecture
is deferred until Phase 5 provides a real Today screen. Phase 4 adds Paths without
removing the existing Practice entry.

## Trade-offs

- App navigation gains one state and destination.
- Some filters resemble Library filters but intentionally use separate contracts.
- Track progress requires a bounded aggregate over the active release; it cannot
  be inferred from catalog installation.

## Consequences

- Draft or unlicensed catalog data cannot enter learner UI through Library fallbacks.
- Catalog code and IndexedDB adapters remain lazy until Paths is opened.
- New languages are registry/release additions rather than changes to Library.
- Phase 5 can later reorganize navigation without changing catalog domain contracts.

## Revisit triggers

- A unified content/learning search is introduced across Library and Catalog.
- Phase 5 replaces the shell with the final Today/Paths/Vocabulary/Progress IA.
- Catalog aggregation exceeds the 10,000-item release bound or requires a worker.
