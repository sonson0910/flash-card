# Implementation Plan: Phase 4 Practice Session Deepening

Date: 2026-08-12

## Overview

Complete the local architecture-deepening sequence by moving cross-mode Practice
Session lifecycle rules out of React refs and into one framework-free module.
Close the phase and the full Phase 0-4 batch with the complete local release
gates.

## Architecture decisions

- One lifecycle instance survives renders and is replaced only when the hook is
  remounted.
- Owner switches advance a monotonic generation and synchronously revoke old
  preparation, active-mode and review authority.
- Study, quiz, spelling and story share one preparation lock and one active mode.
- The lifecycle owns review claim/saved/retry state; visible saving/error state
  remains in React.
- DOM keyboard handling and delayed audio cleanup remain presentation concerns.
- No schema, migration, Rules, dependency or production change is allowed.

## Task list

### Slice 4.0 - Contract skeleton

- [x] Add a failing lifecycle contract.
- [x] Lock owner A -> B -> A invalidation and stable public method identities.
- [x] Lock cross-mode single-flight and active-mode authority.

### Slice 4.1 - Review authority

- [x] Move pending/saved review claims into the lifecycle.
- [x] Preserve acknowledgement-after-persistence and retry after failure.
- [x] Suppress stale-owner review publication.

### Slice 4.2 - Shared preparation and activation

- [x] Route study, quiz, spelling and story preparation through one lifecycle.
- [x] Remove parallel preparation and active-session refs from the hooks.
- [x] Keep existing timeout, error copy, bounded pool and story selection behavior.

### Slice 4.3 - React adapter cleanup

- [x] Keep visible state, keyboard/DOM behavior and audio timers in React.
- [x] Preserve synchronous empty-state scoping during owner switches.
- [x] Add a source boundary contract that rejects duplicate lifecycle stores.

### Slice 4.4 - Final acceptance

- [x] Run focused practice and architecture tests.
- [x] Run core verification, production build, bundle budget and diff check.
- [x] Review correctness, readability, architecture, security and performance.

Acceptance evidence is retained in
[`phase-4-practice-session-acceptance-2026-08-12.md`](../reviews/phase-4-practice-session-acceptance-2026-08-12.md).

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Owner A work becomes valid after A -> B -> A | Critical | Monotonic generation contract |
| Two modes publish from concurrent preparation | High | Cross-mode single-flight and one active-mode authority |
| Review is awarded or marked saved twice | High | Pending/saved claims with persistence-last settlement |
| Owner switch briefly exposes old practice data | High | Generation-scoped snapshots before effect cleanup |
| Refactor leaks DOM or vendor concerns into domain | Medium | Framework-free source boundary contract |

## Dependencies

Slices are sequential: 4.0 -> 4.1 -> 4.2 -> 4.3 -> 4.4. The phase depends only
on the already completed Phase 0-3 worktree and does not authorize external
rollout work.
