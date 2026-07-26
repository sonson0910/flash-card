# Spec: Source hardening after full review

## Objective

Resolve every actionable P1-P3 item from the 2026-07-22 source review without
losing cards, learning progress, media, or account isolation. Preserve bounded
memory use and the existing card-flip/library UX.

## Stack and commands

- React 19 + TypeScript + Vite
- Firebase Auth, Firestore, Functions and Rules
- IndexedDB/local device fallback
- Verify: `npm run lint`, `npm test -- --run`, `npm --prefix functions test`,
  `npm run test:rules`, `npm run test:e2e`, and production dependency audits.

## Architecture decisions

- Stable word IDs must use only the Firestore Rules allowlist and include a
  deterministic hash so normalization cannot create collisions.
- New cards use full `upsert` operations; changes to existing cards use
  field-level `patch` operations so retry cannot overwrite unrelated fields.
- Pending operations are durably mirrored in IndexedDB. Quota/storage failures
  are surfaced; operations are never silently truncated.
- Async work is scoped to an auth session and card lifetime. A completed image
  request cannot cross accounts or supersede a later delete.
- Legacy lookup remains bounded. Full-library repair belongs to mirror sync or
  an explicit migration, not a per-import query fallback.
- Shared decks are unlisted (`get` allowed, `list` denied) and nested media is
  validated against explicit host allowlists.

## Testing strategy

- RED/GREEN unit tests for IDs, pending merge/persistence/patch flush plans,
  hydration cancellation, legacy lookup planning and IndexedDB pagination.
- Rules tests for phrase/Unicode IDs, denied shared-deck listing, and malicious
  nested media.
- Browser tests for existing-card promotion, delayed media persistence,
  reduced motion and retained card flip behavior where practical.

## Boundaries

- Always: preserve existing user data; validate external values; keep writes
  idempotent; maintain owner isolation; run the narrow test after each slice.
- Ask first: production deployment, destructive data migration, new paid
  services, or deleting legacy backups/history.
- Never: weaken Rules, silently drop pending work, put provider secrets in the
  client bundle, or use full stale snapshots for an existing-card retry.

## Success criteria

- Phrase, apostrophe and Unicode cards write successfully under Rules.
- Late media and offline edits survive reload and sync without overwriting newer
  unrelated cloud fields.
- Delete and account switch win over in-flight hydration.
- Exact reuse opens the existing card immediately without a stale page overwrite.
- Shared decks cannot be listed and cannot trigger arbitrary media requests.
- Default page reads are bounded; bulk uniqueness does not scan the whole cloud
  library for a new word.
- Typecheck, unit, Functions, Rules, E2E, build, secret scan and high-severity
  production audits pass. If an environment prerequisite blocks a suite, report
  it explicitly rather than claiming acceptance.

