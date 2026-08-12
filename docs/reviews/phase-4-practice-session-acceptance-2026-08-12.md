# Phase 4 Practice Session acceptance - 2026-08-12

Status: locally accepted; no deployment, migration or external rollout performed

## Decision

Phase 4 and the local Phase 0-4 deepening batch are complete. Study, quiz,
spelling and story now share one framework-free Practice Session lifecycle for
owner generation, preparation exclusion, active-mode authority and review
idempotency. React remains responsible for visible state, DOM keyboard behavior
and delayed audio cleanup.

No Critical or Required finding remains in the final correctness, readability,
architecture, security or performance review.

## Contract evidence

- Owner A -> B -> A advances a monotonic generation and rejects late preparation
  and review settlement.
- One cross-mode preparation lock prevents concurrent pool/protected-service work.
- Exactly one mode has interaction authority; switching mode revokes the old one.
- Pending reviews cannot be submitted twice, saved reviews remain claimed and a
  failed persistence attempt becomes retryable.
- Clearing story invalidates its preparation scope before the protected story
  adapter is invoked.
- Source contracts keep lifecycle state out of parallel React refs and keep the
  lifecycle free of React, Firebase, IndexedDB and browser storage.

## Local verification

| Gate | Result |
| --- | --- |
| Practice-focused Vitest | Passed: 59/59 across lifecycle, games, owner race, workspace, model, views and accessibility. |
| Architecture analyzer | Passed: 12/12. |
| `npm run verify:core` with Java 21 | Passed: 176 app files and 1,431/1,431 tests; Functions 45/45; Firestore Rules 47/47. Expected negative-path stderr was retained. |
| Production build | Passed: Vite transformed 1,939 modules and wrote immutable build metadata. |
| Bundle budget | Passed: 47 JS chunks; initial JS 278,136 bytes gzip; total JS 597,565 bytes gzip. |
| Practice Chromium journeys | Passed: 15/15 across study, quiz, spelling, story, focus, responsive layout and accessibility. |
| `git diff --check` | Passed. |

## Five-axis review

| Axis | Conclusion |
| --- | --- |
| Correctness | Monotonic owner generations, preparation scopes, active-mode checks and persistence-last review settlement close stale-session and duplicate-action races. |
| Readability | Lifecycle vocabulary is explicit and executable; obsolete per-hook guard stores and the old review-claim helper were removed. |
| Architecture | The framework-free lifecycle sits between React adapters and injected pool/learning/XP/story ports; analyzer reports no boundary or cycle regression. |
| Security | No new data path, credential, schema or permission surface exists. A canceled/stale story does not reach the protected adapter after pool loading. |
| Performance | Practice pools remain bounded to 50, quiz/spelling queues remain bounded, review sets are session-bounded and single-flight prevents duplicate expensive preparation. |

## Scope statement

This acceptance covers locally controllable implementation and verification only.
It does not authorize or claim a Firestore/IndexedDB schema change, Rules change,
migration, dependency update, catalog publication, staging run, production deploy,
traffic change or rollback exercise. The pre-existing untracked `docs/design/`
directory was not modified.
