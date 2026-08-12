# Phase 3 Composition Root Acceptance

Date: 2026-08-12
Base revision: `9e0b256bb2ecac06c1da6efd27697aedb65da5f9`
State: local working tree, uncommitted

## Outcome

Phase 3 is accepted locally. `App.tsx` now owns shell refs, overlay/navigation
composition, view selection and rendering. Owner/Library lifecycle and cloud
publications live in `useAppLibraryRuntime`; Learning/Intake/Practice, media,
custom decks and the Library screen contract live in
`useAppLearningCoordination`.

| Gate | Result |
| --- | --- |
| `src/App.tsx` | 237 newline-counted lines; limit 450 |
| `useAppLibraryRuntime.ts` | 275 lines; limit 300 |
| `useAppLearningCoordination.ts` | 343 lines; limit 350 |
| Former 600-line App gate | 363 lines / 60.5% headroom |
| Production dependency graph | 0 cycles, 0 boundary violations |
| Catalog/Today/Progress ownership | Remains in `AppViewStage`; no Library import |

The stable Practice publication bridge preserves the existing Library-to-
Practice publication path without introducing an initialization or import
cycle. The active-owner category-facet guard remains characterized in its new
owner module.

## Verification evidence

- Contract-first RED: the new composition contract failed at 599 parsed lines,
  missing coordinator modules and the 450-line analyzer violation.
- Focused coordinator/owner/race verification: 14 files, 79 tests passed.
- Final `npm run verify:core` with Java 21:
  - application: 177 files, 1,434 tests passed;
  - Functions: 7 files, 45 tests passed and TypeScript build passed;
  - Firestore Rules: 47 tests passed.
- Production build: 1,941 modules transformed successfully.
- Bundle gate: initial JavaScript 278,815 B gzip; total JavaScript 598,276 B
  gzip; 47 chunks within budget.
- Chromium shell/Library/Practice journeys: 22 tests passed.
- Final destructive-clear/focus smoke after the last boundary cleanup: 1 test
  passed.
- `git diff --check`: passed.

Expected `PERMISSION_DENIED` messages emitted by negative Firestore Rules tests
were present; the Rules runner and emulator exited successfully with code 0.

## Five-axis review

- Correctness: owner isolation, verified epoch flow, revision/tombstone and
  acknowledgement-last behavior remain behind the existing feature ports; all
  owner/race and full suites pass.
- Readability: App now exposes the shell composition directly; each extracted
  hook has a single ownership theme and an executable size cap.
- Architecture: no cycles or infrastructure-import violations; ADR-003 Catalog
  separation and ADR-004 shared Daily Learning consumption remain intact.
- Security: no schema, Rules, auth, secret or external-data boundary changed.
- Performance: no new I/O or unbounded work; production bundle remains within
  the established budget.

No required review findings remain. No deployment, commit or push was performed.
