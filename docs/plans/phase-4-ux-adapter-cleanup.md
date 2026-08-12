# Phase 4 implementation plan

- [x] Freeze the current seams with failing presentation, navigation-intent, and config-source contracts.
- [x] Replace the desktop-only Export/Clear icons with a responsive Library management menu and preserve clear-dialog focus restoration.
- [x] Add Today/Progress empty-state CTAs through existing navigation and Practice ports.
- [x] Remove mount/data-driven heading focus; issue heading focus only from explicit app or daily-route navigation intents.
- [x] Move Shared Device Store behavior from `vite.config.ts` into a typed development adapter and redirect its existing tests.
- [x] Run focused tests, core/build/bundle gates, Chromium keyboard/a11y/desktop/mobile journeys, and record evidence.
- [x] Evaluate `catalogCache.ts` after the UX/adapter gates and identify the concrete production coordination seam: callers separately queried memberships, hydrated lexemes, and guarded staleness twice.
- [x] Add one atomic hydrated Catalog page read in `catalogIndex.ts`, migrate workspace/composition callers, and preserve the existing query seam only for internal compatibility.
- [x] Cover active-release activation races, incomplete releases, release-bound cursors, caller contracts, and the full core/build/bundle/Catalog E2E gates.
