# ADR-006: Use transactional control documents for card identity and share ownership

Date: 2026-08-10

Status: Accepted for local implementation; production validation pending

## Context

Two write paths had related integrity problems:

1. manual entry, spreadsheet import, shared-deck adoption and offline replay could
   race after a read-before-write duplicate check and create more than one card for
   the same normalized word;
2. a shared deck must be retrievable through an unlisted link, but putting its
   author UID in that public document discloses private identity metadata and makes
   safe revocation depend on mutable public data.

The application must also preserve library epochs, revisions and tombstones,
retain safe owner-authorized revocation for legacy shares, and keep all client
writes behind the existing Firestore owner boundary. Legacy public payloads are
not served by the strict schema-2 load boundary. Shared links are intentionally
bounded and temporary rather than a permanent publishing system.

## Decision drivers

- Concurrent creation must converge on one repository-managed card identity.
- A card create and its identity claim must commit together or not at all.
- A public share must not expose its owner's UID.
- Share creation and revocation must not leave an orphaned public or ownership
  document.
- Stale library generations and newer deletion tombstones must continue to win.
- Limits, expiry and legacy compatibility must be explicit and testable.

## Options considered

| Option | Benefits | Costs |
| --- | --- | --- |
| Query for a matching word, then write a random card ID | Smallest change | Race window remains; every intake path can diverge |
| Deterministic card ID plus a hash-addressed immutable reservation in one transaction | Converges repository flows; composes with epochs and tombstones; Rules can recompute the reservation address | Permanent control documents; existing cards require a coordinated dedupe/backfill cutover |
| Move every card creation to an Admin callable | Strong server authority | Larger API/offline migration, quota and availability change |
| Keep `authorUid` in the public shared deck | Simple revocation lookup | Leaks identity through every share link |
| Store public deck and private ownership separately without a transaction | Keeps public payload private | Partial failures can orphan either document |
| Store public deck and private ownership under one ID in one transaction | Private authority, atomic lifecycle and simple lookup | Requires two TTL policies and a legacy fallback |

## Decision

### Card identity reservation

Repository-managed creation normalizes a word with NFKC, trimming, lowercase and
collapsed whitespace. It derives a stable Firestore-safe card ID and a versioned
reservation:

```text
users/{uid}/card_reservations/{lowercase-sha256(normalizedWord)}
  schemaVersion: 1
  cardId: string
  normalizedWord: string
```

The reservation document ID is the full 64-character lowercase SHA-256 digest.
Firestore Rules recompute that digest with `hashing.sha256(...).toHexString().lower()`.
The card document ID remains backward compatible: simple safe words retain their
legacy ID, while phrase/Unicode IDs keep only the first 24 digest characters after
the readable slug.

`createCardIfAbsent` reads the library epoch, reservation, tombstone and canonical
card inside one Firestore transaction. It rejects stale/future epochs, a mismatched
reservation and a newer same-generation tombstone. Otherwise it atomically claims
the missing reservation and creates the card, or returns the existing canonical
card. A legacy canonical card may receive a missing reservation only when its word
identity matches. A legacy-to-v2 update claims or verifies the hash-addressed
reservation in the same transaction; an existing normalized identity cannot be
changed by a later patch.

Reservations are user-scoped, point-readable by their owner, non-listable,
immutable and not deleted with a card. Rules accept a claim only when its matching
card exists after the same atomic write, so clients cannot create orphan control
documents. Keeping the claim lets a later recreation reuse the same identity while
revision/epoch/tombstone rules decide whether that recreation is current.

### One-way generation-fence rollout

One reviewed schema-2 candidate seals both Rules artifacts. Canonical
`firestore.rules` is always strict: current-generation card mutations must atomically
advance the owner's `mutationGeneration` by exactly one. The separate
`firestore.compatibility.rules` is temporary and permits a legacy write only while the
owner state remains the exact unfenced two-field shape. A compatible current mutation
can establish generation one; neither artifact permits a fenced owner to remove or
lower the generation.

The protected production order is compatibility Rules, compatible Hosting and
Functions, strict canonical Rules, bounded owner migration, then an externally attested
final-state check that redeploys canonical strict Rules as confirmation. The compatibility
step is accepted only after GET-only named-database Rules read-back matches the sealed
source and a bounded run/attempt-qualified evidence artifact is retained. The strict-fence
workflow applies the same provider read-back before its enforcement evidence can be
recorded. It intentionally precedes migration and verifies the exact compatible runtime
deployment. Migration rollback also runs under strict Rules and never decrements the
generation. Therefore the compatibility artifact is not a rollback target for a fenced
owner, and a generation-unaware runtime cannot safely be restored for that owner.

### Private shared-deck ownership

Current shares use the same generated ID in two top-level collections:

```text
shared_decks/{shareId}        # callable-served unlisted payload, no owner UID
shared_deck_owners/{shareId}  # server-only owner UID
```

An authenticated, App Check-protected callable validates and rate-limits the
request, then creates both documents in one Admin Firestore transaction. A share
contains at most 100 cards, is additionally bounded to 750,000 encoded bytes, and
gets an `expiresAt` timestamp 30 days after creation. The callable returns that
timestamp with the share ID.

Revocation reads both documents before writing. Private ownership metadata is
authoritative for current shares; `authorUid` in a legacy public document is used
only when private metadata is absent. The transaction deletes every document that
exists, rejects a different requester, and treats an already-absent pair as an
idempotent no-op.

Firestore Rules deny every direct client read, query, create, update, and delete
for public shares, and deny all reads and writes to ownership metadata. Public
unlisted links are loaded only by the unauthenticated but App Check-enforced
`loadSharedDeck` callable. Before returning a canonical `{ category, cards }`
projection, trusted Functions require the exact stored top-level schema, schema 2,
Firestore `Timestamp` values, an unexpired `expiresAt`, the 100-card and encoded-size
bounds, the canonical payload shape, the exact public-card field allowlist, bounded
strings/lists, and HTTPS media URLs on the configured host allowlists. Rules do not
validate nested shared-card fields because direct access is closed.

Firestore TTL must be enabled on `expiresAt` for both collection groups. TTL is
cleanup only; the callable expiry check remains mandatory even if asynchronous TTL
delete has not run yet.

## Consequences

### Positive

- Every application intake path can use one create-if-absent transaction and
  converge despite concurrent or replayed requests.
- Card identity, epoch, revision and deletion barriers are evaluated together.
- Public share payloads no longer reveal an owner UID.
- Share create/revoke cannot leave a one-sided current pair under normal Firestore
  transaction semantics.
- Links have a documented storage/cost boundary: 100 cards and 30 days.

### Costs and limitations

- Card reservations are permanent per-user control records and therefore add one
  small document per normalized identity.
- The current client sends only the first 100 cards of a larger category; there is
  no documented UI warning for that truncation. Product copy must not claim that a
  larger category was shared in full until the UI explicitly reports the cap.
- Existing random-ID/duplicate cards cannot be lazily backfilled safely by direct
  client Firestore writes. After the compatible runtime is deployed and strict Rules
  close the legacy write window, an authorized Admin migration must dry-run and group
  identities, merge progress into one canonical card, preserve a rollback
  snapshot/tombstones, verify one card per identity, and only then write each full-digest
  reservation with the canonical card ID. The repository provides an Auth/App Check
  callable for owner-scoped repair and protected dry-run/apply/rollback operators.
  Apply/rollback require one hashed owner key selected from dry-run; production execution
  and the final strict-Rules confirmation remain separate operational evidence.
- The hash-addressed Rules contract has source and client-unit proof, including
  long UTF-8/multi-block inputs and malicious alternate IDs, but production
  acceptance still requires the Java-backed emulator suite. Static source matching
  is not a Rules compiler/runtime result.
- Stored legacy share documents may retain their old `authorUid` shape until they
  expire or are revoked. Only the server-side revocation fallback reads that field;
  the strict load callable does not serve legacy payloads, and new shares never store it.
- Operators must configure TTL for both collections. TTL is cleanup, not the access
  control; the callable expiry comparison remains mandatory.

## Verification and operational evidence

- Card identity and transaction: [`cardIdentity.ts`](../../src/lib/cardIdentity.ts),
  [`cardRepository.ts`](../../src/lib/cardRepository.ts), and
  [`cardRepositoryUniqueness.test.ts`](../../src/lib/cardRepositoryUniqueness.test.ts).
- Card access and rollout boundary: strict [`firestore.rules`](../../firestore.rules),
  temporary [`firestore.compatibility.rules`](../../firestore.compatibility.rules),
  [`deploy-firestore-compatibility.yml`](../../.github/workflows/deploy-firestore-compatibility.yml),
  [`deploy-firestore-enforcement.yml`](../../.github/workflows/deploy-firestore-enforcement.yml),
  [`firestoreRulesSource.test.ts`](../../firestoreRulesSource.test.ts), and the Java-backed
  [`firestore.rules.test.ts`](../../firestore.rules.test.ts).
- Share validation and lifecycle: [`inputValidation.ts`](../../functions/src/inputValidation.ts),
  [`sharedDeckPersistence.ts`](../../functions/src/sharedDeckPersistence.ts),
  [`index.ts`](../../functions/src/index.ts), and
  [`sharedDeckPersistence.test.ts`](../../functions/test/sharedDeckPersistence.test.ts).
- Operator requirements: [`README.md`](../../README.md) and
  [`phase-6-rollout.md`](../runbooks/phase-6-rollout.md).
- Current acceptance boundary:
  [`comprehensive-upgrade-closure-2026-08-10.md`](../reviews/comprehensive-upgrade-closure-2026-08-10.md).

## Related decisions

- [ADR-001](adr-001-additive-schema-v3.md) establishes additive schema,
  compatibility and rollback rather than destructive replacement.
- [ADR-005](adr-005-release-evidence-and-guarded-rollout.md) requires local,
  staging and production evidence to remain distinct.

## Revisit triggers

- A server-authoritative card-create callable is introduced.
- The canonical identity algorithm or normalization profile changes.
- Reservations need retention/compaction without allowing identity reuse races.
- Shares need more than 100 cards, more than 30 days, named recipients or listing.
- Legacy schema-1 shares have expired and the `authorUid` fallback can be removed.
