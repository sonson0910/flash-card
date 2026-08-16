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
- Release-candidate dispatches accept one full immutable revision only. An
  unprotected source-validation job requires the current `main` trigger revision,
  exact full-history checkout, current `origin/main` ancestry, and a clean tree
  before a protected build can access environment configuration. The protected
  build independently repeats those checks and seals only that same revision,
  workflow run ID, and run attempt. Every consumer verifies and downloads the
  attempt-qualified artifact rather than accepting another retry of the same run.
- Compatible Hosting and Functions promotion requires the exact successful preparatory
  compatibility-Rules run and attempt. Before protected runtime access, machine checks require
  the exact workflow source and revision, successful deploy and record jobs, provider-verified
  evidence, matching candidate identity, protected Firebase project/database, and sealed
  compatibility Rules digest. A different retry attempt or shared approval is not sufficient.
- Firestore Rules cutover additionally requires the exact successful production
  deployment run and attempt plus the exact reservation-migration workflow attempt that
  produced the retained final-evidence artifact. The attested mutation-job attempt remains
  a separate binding and cannot be replaced by a later final-evidence retry. Machine checks
  require successful Hosting, Functions,
  and deployment-provenance jobs, then bind their retained envelope to the same
  revision, candidate run/digest, Firebase project, and Firestore database before
  protected Rules authentication.
- Shared-deck documents are not client-readable or writable. Public unlisted links
  load through the unauthenticated but App Check-enforced `loadSharedDeck` callable;
  trusted Functions validate the stored public projection before returning canonical
  `{ category, cards }` data. Create and revoke remain authenticated,
  App Check-protected Admin transactions with private ownership metadata.
- Shared-deck input and stored payloads retain the 100-card, 30-day, encoded-size,
  exact-schema, bounded-string/list, and explicit media-host limits.

### Shared-deck callable boundary

`shared_decks/{shareId}` and `shared_deck_owners/{shareId}` are server-managed
collections. Firestore Rules deny all client reads, queries, and writes. The client
loads an unlisted link by calling `loadSharedDeck`; the callable does not require a
Firebase Auth user, but Firebase App Check is enforced.

Before returning data, Functions require the stored document to have exactly
`category`, `cards`, `createdAt`, `expiresAt`, and `schemaVersion`; require schema 2,
Firestore `Timestamp` values, and an unexpired `expiresAt`; and pass the bounded
canonical payload parser. That parser enforces the 100-card and encoded-size limits,
the exact public-card field allowlist, trimmed bounded strings, bounded string lists,
and HTTPS media URLs restricted to the configured image/audio hosts. The result is
only the canonical `{ category, cards }` projection; ownership metadata never crosses
this boundary. Before parsing a public load request or reading Firestore, each Functions
process atomically consumes a salted-HMAC source budget and a process-global budget.
Invalid or unavailable network sources share one bounded fallback bucket; raw sources
and derived buckets are never stored or logged. This process-local control is defense in
depth behind App Check, not a durable cross-instance quota. Create and revoke continue
to use authenticated, App Check-protected Admin transactions, with private ownership
authoritative for revocation.

Functions operational logs use exact allowlisted event schemas and stable error classes.
They reject arbitrary fields and never include account/share identifiers, network sources,
request bodies, card/deck content, URLs, Firestore paths, tokens, free-form messages,
stacks, or raw error text. Logging failure is always behavior-neutral.

## Testing strategy

- RED/GREEN unit tests for IDs, pending merge/persistence/patch flush plans,
  hydration cancellation, legacy lookup planning and IndexedDB pagination.
- Rules tests for phrase/Unicode IDs and denial of every direct shared-deck read,
  list, and write.
- Functions and client adapter tests for App Check callable loading, canonical
  payload validation, private ownership, bounded cards, list/string values, and
  trusted media hosts.
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
- Shared-deck documents cannot be read, listed, or written directly by clients;
  public links load only through the App Check-enforced callable and cannot trigger
  arbitrary media requests.
- Default page reads are bounded; bulk uniqueness does not scan the whole cloud
  library for a new word.
- Typecheck, unit, Functions, Rules, E2E, build, secret scan and high-severity
  production audits pass. If an environment prerequisite blocks a suite, report
  it explicitly rather than claiming acceptance.

