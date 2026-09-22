# Phase 3 restart reconciliation

Status: DONE_WITH_CONCERNS

Changed: authoritative ID lookup and review conflict restoration; persisted review XP marker and idempotent settlement bridge; permanent protected-callable review failures now retire and restore instead of remaining queued; focused behavioral tests.

Validation: focused Vitest suite passed (5 files, 149 tests), including owner-switch and settlement-failure retries; `npm run lint` and `git diff --check` passed.

Risk: XP settlement is deduplicated by the existing persistent gamification operation ID; cloud stats are refreshed from the authority instead of locally replayed.
