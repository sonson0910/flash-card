# ADR-007: Server-validate complex Firestore writes

## Status

Accepted

## Date

2026-08-24

## Context

Firestore Security Rules have no loops or universal collection predicate. The
application legitimately stores up to 100 card review entries, 730 XP-history
entries, and 256 library-facet counters in single documents. Checking a fixed
number of entries leaves later values unvalidated, while lowering the limits
would reject valid data and change existing learning behavior.

The current clients replace these collections transactionally. Review writes
also update scheduling fields and support queued retry; gamification reconciles
operation sequences atomically; facet updates may contain several category
deltas. Per-entry Rules protocols therefore cannot preserve the existing
atomicity and retry contracts.

## Decision

Keep the existing Firestore document and read models. Route mutations of card
review state, gamification state/history, and library facets through Firebase
callables that require authentication and App Check. Each callable validates
the complete resulting document, applies the existing transaction semantics,
and records a server-only operation receipt where retry could otherwise apply a
mutation twice. After client adapters are in place, Rules deny the corresponding
direct complex writes while retaining owner reads.

Keep custom deck writes on the client because the complete bounded string list
can be validated in Rules with a delimiter-safe joined representation. Inventory
existing deck names before narrowing the accepted character set.

All monotonic protocol counters are bounded by `Number.MAX_SAFE_INTEGER`, and
incrementing code rejects the ceiling instead of producing an unsafe value.

## Alternatives considered

### Validate a fixed number of entries in Rules

Rejected because entries after that fixed prefix remain attacker-controlled.

### Reduce every collection to four entries

Rejected because it breaks valid review history, custom decks, XP history, and
facet data.

### Move each entry to a subcollection

Rejected for this remediation because it requires dual-read migration, changes
subscriptions and aggregation, and adds many reads and writes. It remains an
option if document-size or query requirements later change.

### Client-generated signatures

Rejected because a client-held key cannot establish trusted payload validation.
App Check authenticates the app/device, not the correctness of arbitrary data.

## Consequences

- Existing stored schemas and owner read paths remain unchanged.
- Functions and client adapters must deploy before the Rules cutover.
- Old clients lose direct write access after cutover; queued operations remain
  retryable through stable operation identifiers.
- Valid legacy documents are retained. Malformed legacy values require explicit
  inventory and remediation; they are never silently dropped or normalized.
- Rollback restores the prior Rules while leaving the unchanged stored schemas
  readable.
