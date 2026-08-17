# Spec: Legacy library Admin migration

## Objective

Repair one explicitly selected owner's legacy card library so every valid card has a
canonical schema-v2 identity and reservation without losing learning state. The Admin
path is bounded, owner-scoped, write-capable only after protected workflow approval, and
reversible only while its generation and document preconditions remain true.

## Authoritative implementation

| Concern | Implementation |
| --- | --- |
| State machine and public result | `functions/src/legacyLibraryMigration.ts` |
| Firestore page reads, progress CAS, backup, apply, completion and rollback | `functions/src/legacyLibraryMigrationFirestore.ts` |
| Authenticated/App Check callable | `functions/src/index.ts` (`migrateLegacyLibrary`) |
| Browser bounded loop | `src/features/librarySession/legacyLibraryMigrationService.ts` |
| Explicit-owner Admin operator | `functions/src/legacyLibraryMigrationOperator.ts` and `.github/workflows/repair-legacy-libraries.yml` |
| Owner write fence | `src/lib/cardRepository.ts`, strict `firestore.rules`, and temporary `firestore.compatibility.rules` |

The callable continues to return only
`{ migrated, merged, scanned, complete, remaining, invalid }`. Phase and generation
fields are persisted migration state, not caller-controlled input or public result fields.

## Bounded page/apply/verify/complete state machine

Progress is version 3 and is stored at `users/{ownerId}/profile/query_migration`:

```text
apply (cursor + scanned count)
  └─ clean end of source pages → verify (cursor = null, scanned = 0)
verify (always starts at document-ID beginning)
  ├─ pending/invalid identity → apply (cursor = null, scanned = 0) or fail closed
  ├─ clean page with more documents → verify (next cursor)
  └─ clean end-of-file → complete
complete (completedMutationGeneration)
```

A v3 progress document contains `migrationVersion`, `jobId`, `phase`, `complete`,
`expectedEpoch`, `expectedMutationGeneration`, apply cursor/count, and verification
cursor/count. Active transitions compare the stored phase/cursor token and both owner
coordinates before writing progress.

### Page

`readPage` reads the owner state and progress, queries cards ordered by document ID with
`limit(batchSize + 1)`, and loads only page-scale canonical-card and reservation
lookups. The effective card batch is bounded to 1–100, so the probe is at most 101
cards. It rereads owner state before returning the page; an epoch or
`mutationGeneration` change raises a retryable `LegacyLibraryGenerationChangedError`.

When a normal v3 resume sees a different epoch or generation, the adapter atomically
resets both cursors and counts to the first apply page, updates the backup root's
expected epoch/generation, and invalidates automatic rollback for that root. It never
resumes a stale cursor; an explicitly stale page caller fails the same generation check. A valid v3 `complete` marker is returned as already
complete; later compatible client mutations do not require a rescan because the enforced
Rules protocol prevents them from recreating legacy card shape.

### Apply

For an apply page, the adapter first creates a first-write-wins server backup, then
applies canonical identity plans and tombstones in Admin transactions. Automatic
rollback source backups are capped at 100; any operation that would exceed the cap is
rejected before writes. Each backup, card plan, and progress transition checks the
expected epoch, expected generation, and stored phase/cursor token. Plan idempotency
binds `appliedLibraryEpoch`, `appliedMutationGeneration`, and source IDs. Admin
migration writes do not advance the ordinary owner `mutationGeneration`.

When the source page is exhausted, the transition is only `phase: verify`; apply can
never write `complete: true`. The browser callable performs one full, write-free
preflight for the matching owner epoch and mutation generation. It accepts at most
3,000 source cards; a read-only probe of card 3,001 fails closed before preflight
evidence, backups, cards, or progress are written and directs the owner to the protected
operator migration. A valid preflight is persisted and reused only when its source count
is within that browser limit. Each invocation advances at most two 100-card migration
pages and never crosses the apply-to-verify checkpoint in the same call. At the 3,000-card
boundary, 15 apply calls and 15 verification calls consume the 30-call browser budget.
The protected operator retains its own 10,000-source-card write-free preflight and
budgets at most 200 execution pages: up to 100 for apply and 100 for the required clean
from-start verification scan.

### Verify

Verification rereads from document-ID start, not from the apply cursor. A page is clean
only when all selected identities are canonical, reserved, and valid. A pending plan
restarts apply from the beginning. Invalid cards fail closed for apply; dry-run reports
invalid counts without writes. Verification continues through clean pages and only a
clean end-of-file can call `markComplete`.

### Complete

`markComplete` uses a final Firestore transaction that compares epoch, generation, and
the current verification token, then writes `phase: complete`, `complete: true`, and
`completedMutationGeneration`. This final bounded probe is required even when the last
apply page contained no additional source documents.

## Owner `mutationGeneration` write fence

The owner state document is `users/{ownerId}/profile/library_state` with the shape:

```ts
{ schemaVersion: 2, libraryEpoch: number, mutationGeneration: number }
```

Missing or invalid `mutationGeneration` is read as `0` for compatibility. Repository
transactions read the state and atomically write the card-side change together with
`mutationGeneration: previous + 1`:

- `createCardIfAbsent` increments when it creates a card, upgrades a legacy card, or
  creates its missing identity reservation.
- `applyCardPatchIfCurrent` increments for an actual patch, legacy upgrade, or new
  reservation claim.
- `deleteCardWithTombstone` increments when it creates a real tombstone/delete.
- `incrementLibraryEpoch` advances both `libraryEpoch` and `mutationGeneration` once
  for a destructive reset.

Idempotent retries, no-op patches, duplicate-delete retries, and revision/epoch
conflicts do not increment. The increment is not placed in pending-operation payloads;
the repository derives the current value inside its transaction. Old-generation cleanup
is generation-exempt because the epoch barrier already excludes obsolete documents.

The final Rules contract requires current-generation card create/update/delete and the
matching owner state update in one atomic request. `getAfter(library_state)` must equal
the prior valid generation plus exactly one: reused, skipped, decremented, or omitted
updates fail. A durable patch receipt additionally requires an existing card that follows
the same next-revision contract in the request: a missing legacy revision becomes `1`, or
an integer revision `N` becomes `N + 1`; that result must equal the receipt's
`appliedRevision`. Reconciliation advances the card revision when it materializes a
missing receipt. Strict and compatibility Rules use the same receipt contract; preserving
an exact unfenced owner state cannot authorize a receipt-only write.
`profile/query_migration` is owner-readable but client create/update/delete is denied, so
clients cannot forge cursors or completion.

## v3 completion and rollback guards

- Migration version 2 progress, including an old `complete: true`, is treated as
  incomplete and must run apply plus from-start verification.
- Rollback requires a v3 backup root with `completedMutationGeneration` and an exact
  current owner epoch/generation match. Automatic rollback is capped at 100 source
  backups and rejects above-cap snapshots before writes. Every restored primary must
  still have the recorded applied revision; every post-apply tombstone must exist with
  the exact recorded data; recreated removed source IDs refuse automatic rollback.
- One Firestore transaction rechecks all live guards (owner state, backup root, source
  backups, migrated cards, and post-apply tombstones), restores cards/reservations/
  tombstones/progress/facets, and records rollback. It never decrements owner
  `mutationGeneration`.
- Apply, progress, completion, and rollback all fail closed on generation changes.

## Legacy-client cutover and rollback order

Use one reviewed schema-2 candidate that seals two distinct Rules artifacts and the
compatible runtime. The executable order is:

1. **Temporary compatibility bridge:** deploy sealed `firestore.compatibility.rules`
   through `deploy-firestore-compatibility.yml`. It accepts legacy writes only while the
   owner state remains the exact unfenced two-field shape. A current client mutation can
   atomically establish generation one; after that transition the bridge requires the
   same strict `+1` participation and rejects state downgrade.
2. **Compatible client/Functions:** deploy the same candidate's Hosting and Functions,
   then observe retries, permission errors, App Check, sync loss, and stale-client signals.
   Retain the exact successful deployment run ID/attempt and evidence artifact.
3. **Strict mutation fence:** deploy sealed canonical `firestore.rules` through
   `deploy-firestore-enforcement.yml`, bound to that successful compatible runtime
   deployment. It requires exact atomic `+1` participation and keeps `query_migration`
   server-only. Legacy clients may still read, but generation-unaware writes fail closed.
4. **Migration and confirmation:** only after strict enforcement, run owner-scoped
   dry-run/apply for an explicit owner. After external final-state verification,
   `deploy-firestore-rules.yml` revalidates the migration evidence and redeploys the same
   canonical strict Rules as an evidence-bound confirmation.

Rollback is also one-way. Freeze writes, keep strict Rules active, run the bounded data
rollback, verify the resulting state, then use `deploy-firestore-rules.yml` with
`operation: rollback` to confirm the rollback while retaining strict enforcement. The
compatibility artifact is not an unfencing mechanism: it cannot remove an existing
`mutationGeneration`, and migration rollback never decrements that value. Do not roll an
affected owner back to a generation-unaware client; retain the compatible runtime and fix
forward. Reset affected v3 progress only under a separately authorized recovery and never
reuse a stale completion marker.

## Operator and safety boundaries

- The callable derives owner identity from Auth and requires App Check; its request only
  supplies bounded `batchSize` and `dryRun` values.
- The workflow operator requires one explicit owner ID, a matching 12-character
  SHA-256 owner key, and `APPLY_QUERY_V2` or `ROLLBACK_QUERY_V2` confirmation for
  mutating modes. It does not discover owners or export card data.
- Dry-run is write-free. Apply creates server-only backups and reports aggregate counts.
  Source cards are not physically deleted without their rollback evidence.

## Acceptance and known environment gap

As of 2026-08-16, `npm run verify:core` passes, including Java-backed Firestore
Rules/emulator validation, root TypeScript/Vitest, and Functions lint/tests/build. The
production build, bundle and secret checks, dependency audits, Playwright suite, focused
readiness tests, release contracts, and `git diff --check` also pass.

The reviewed attestation trust root now pins the exact enabled KMS version, algorithm,
and DER-SPKI fingerprint; the Actions deployer can verify but cannot sign. Release status
remains HOLD because the configured root is not yet part of a clean reviewed `main`
revision, the checkout is dirty, and no real immutable rollback object or run-bound
migration/staging/deployment/canary evidence exists. Firestore TTL is active for both
`shared_decks.expiresAt` and `shared_deck_owners.expiresAt`; do not count that static
control as run-bound release approval. Do not count missing external evidence or skipped
tests as approval evidence.

## Verification commands

```sh
npm --prefix functions test -- legacyLibraryMigration
npm --prefix functions run lint
# Requires Java 21 and starts the Firestore Emulator:
npm run test:rules
# Full release verification, also requires Java 21:
npm run verify
```
