# Phase 4 UX and Adapter Cleanup Acceptance

Date: 2026-08-12
Base revision: `9e0b256bb2ecac06c1da6efd27697aedb65da5f9`
State: local working tree, uncommitted

## Outcome

Phase 4 is accepted locally with one documented Firefox runner exception.
Library maintenance is now available through one responsive `Manage library`
menu; Today and Progress empty states expose concrete next actions; heading
focus follows explicit navigation intent instead of mount, owner or data
changes; and the development-only Shared Device Store is owned by a typed
adapter outside Vite configuration. Installed Catalog paging now returns
membership and lexeme content through one release-consistent read instead of
requiring the workspace to coordinate query and hydration.

| Acceptance item | Result |
| --- | --- |
| Library Export/Clear management | Responsive menu with menu semantics, keyboard traversal, Escape/click-outside close, and stable clear-dialog focus return |
| Today onboarding | `Add vocabulary` and `Explore learning paths` |
| Progress onboarding | `Start your first review` when vocabulary exists; otherwise `Add vocabulary` |
| Programmatic focus | App navigation, browser history and explicit daily-route transitions only; no mount/load/owner/feedback autofocus |
| Keyboard focus indicator | Custom controls retain `focus-visible` outlines |
| `vite.config.ts` | Reduced from 1,044 to 54 newline-counted lines |
| Shared Device Store | Trust checks, locking, SSE, merge/reconciliation and endpoint registration live in `dev/sharedDeviceStoreAdapter.ts` |
| Explicit `any` in config/adapter | None |
| Installed Catalog read path | `readCatalogCachePage` owns active/complete release validation, indexed query and lexeme hydration in one readonly transaction |
| Catalog caller coordination | `CatalogWorkspace` and app composition expose one `readPage` request and one stale-result boundary |
| `catalogCache.ts` | Evaluated but not split mechanically; the concrete seam was implemented in `catalogIndex.ts` |

The Shared Device Store is a deep development adapter: its Vite-facing
interface is one plugin factory while its filesystem, ownership and
reconciliation implementation stays local to the module. ADR-003 Catalog versus
Library ownership, ADR-004 Daily Learning coordination and ADR-006 owner/card
invariants remain unchanged. Catalog install still follows begin, stage and
activate; no cache schema or delivery contract changed.

## Verification evidence

- Final focused verification: 7 files, 121 tests passed. This includes the
  Library menu, navigation intent, Today/Progress presentation, Shared Device
  Store security and reconciliation, and architecture analyzer.
- Final Catalog verification: 10 files, 104 tests passed. This includes the
  cache, delivery, index, summary, workspace service/orchestration/presenter,
  app composition/runtime, and architecture analyzer.
- The Catalog index regression runs page reading concurrently with release
  activation and accepts only a wholly old or wholly new release page; mixed
  membership/lexeme content is rejected.
- Final `npm run lint`: passed.
- Final bundle gate: initial JavaScript 279,576 B gzip; total JavaScript 599,001
  B gzip; 47 chunks within budget.
- Final `git diff --check`: passed.
- Final full `npm run verify:core` on this working tree with Java 21:
  - application: 178 files and 1,442 tests passed;
  - Functions: 45 tests passed and TypeScript build passed;
  - Firestore Rules: 47 tests passed.
- Production build passed.
- Chromium Catalog workspace acceptance: 2 tests passed.
- Chromium focused keyboard, accessibility and desktop/mobile layout acceptance:
  23 tests passed.
- WebKit shell and motion acceptance: 16 tests passed.
- Shared Device Store security/reconciliation acceptance: 82 tests passed.

Expected `PERMISSION_DENIED` messages from negative Firestore Rules cases were
present while the Rules suite and emulator exited successfully.

## Firefox local exception

The local Playwright Firefox Nightly process repeatedly stalled before the first
test while consuming approximately 99% CPU, including with `--workers=1`. The
runner was stopped after the same environment failure reproduced. There was no
Firefox assertion or product failure to diagnose, but Firefox cannot be reported
green from this machine; CI or another clean Linux Firefox runner must provide
that evidence.

## Five-axis review

- Correctness: menu actions preserve the existing export and confirmed-clear
  flows; CTA actions reuse current navigation and Practice ports; an atomic
  Catalog read prevents release mixing; focused and full suites pass.
- Readability: `vite.config.ts` is declarative again, while the development
  adapter owns its operational details behind one plugin factory; Catalog
  lexeme-key encoding has one canonical cache helper.
- Architecture: Catalog remains separate from Library; workspace callers no
  longer coordinate active-release query and hydration; no Rules, schema,
  migration or learning write path changed; the dependency graph remains acyclic.
- Security: local trust validation and owner-conflict checks moved intact and
  remain covered by 82 security/reconciliation tests.
- Performance: page and scan bounds remain enforced, hydration is limited to
  the selected page, no dependency was added, and the bundle remains inside its
  budget.

No required review findings remain. No commit, push, deployment, Rules change,
schema migration or dependency change was performed.
