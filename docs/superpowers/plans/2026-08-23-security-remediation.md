# Security Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all 21 findings from Codex Security scan `11b6aff7-ca90-4866-8106-bd9bdb1e7a94`, preserve every valid legacy shared deck, and keep UI and animation behavior unchanged.

**Architecture:** Apply six reversible waves: establish server budgets and schema bounds; make migrations bounded and conflict-safe; inventory and migrate shared decks before tightening Rules; harden release/catalog provenance; harden browser/import/development boundaries; then perform full assurance verification. Reuse the existing callable, Firestore transaction, release-artifact, extension-job, and Vitest patterns.

**Tech Stack:** TypeScript, React 19, Firebase Functions v2, Firestore/Admin SDK, Firestore Security Rules emulator, Vite 6, Vitest 3, Playwright, GitHub Actions, Chrome/Firefox extension APIs.

---

## Working Rules

- Execute in an isolated worktree because the current branch contains unrelated UI edits.
- Do not change component markup, styles, snapshots, animation timings, or visible success flows.
- Run the focused check after each task and commit only that task's files.
- Do not run an apply, rollback, deletion, Rules cutover, or production deploy without a separate explicit production authorization.
- Before a production shared-deck dry run, obtain the owner's canonical Firebase UID through a protected workflow input; never commit it.

## Finding Coverage

| Task | Findings |
| --- | --- |
| 1 | Per-UID account rotation; rate-limit storage fail-open |
| 2 | Unbounded profile documents and card identities |
| 3 | Canonical card field bounds; gamification nested bounds |
| 4 | Excessive public shared-deck retention |
| 5, 8 | Indefinite legacy shares; public UID disclosure |
| 6 | Unbounded migration scan |
| 7 | Rollback overwriting concurrent updates |
| 9 | Production workflows accepting non-protected refs |
| 10 | Firebase CLI resolution after authentication |
| 11 | Forged catalog reviewer approval |
| 12 | Extension package symlink escape |
| 13 | XLSX resource exhaustion and duplicate materialization |
| 14 | Spreadsheet import crossing account changes |
| 15 | Oversized extension fragment; forged extension result |
| 16 | Unauthenticated loopback API; unbounded leases/events |
| 17 | Gemini key embedded in the development browser bundle |

## Wave 1: Backend Budgets And Data Validation

### Task 1: Add durable aggregate budgets and fail closed

**Files:**
- Create: `functions/src/serviceBudget.ts`
- Create: `functions/test/serviceBudget.test.ts`
- Modify: `functions/src/index.ts`
- Modify: `functions/src/rateLimiter.ts`
- Modify: `functions/test/rateLimiter.test.ts`

- [ ] **Step 1: Write failing aggregate-budget and outage tests**

Add tests proving that two different UIDs consume the same service scope, an exhausted aggregate scope rejects both, and a timeout/quota error never grants an AI allowance:

```ts
it('shares one service budget across different users', async () => {
  await consumeServiceBudget(database, 'gemini', 2, 1_000);
  await consumeServiceBudget(database, 'gemini', 2, 1_000);
  await expect(consumeServiceBudget(database, 'gemini', 2, 1_000))
    .rejects.toBeInstanceOf(RateLimitExceededError);
});

it('fails closed when persistent AI budget storage is unavailable', async () => {
  await expect(consumeRateLimitFailClosed(() => Promise.reject({ code: 8 })))
    .rejects.toMatchObject({ code: 8 });
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `npm --prefix functions test -- rateLimiter.test.ts serviceBudget.test.ts`

Expected: FAIL because `consumeServiceBudget` and `consumeRateLimitFailClosed` do not exist.

- [ ] **Step 3: Implement one transactional aggregate budget primitive**

Use hashed service scope IDs and the existing fixed-window evaluator:

```ts
export async function consumeServiceBudget(
  database: Firestore,
  scope: string,
  maximum: number,
  now = Date.now(),
): Promise<void> {
  await consumePersistentRateLimit(database, '__service__', scope, maximum, now);
}

export async function consumeRateLimitFailClosed(
  consumePersistent: () => Promise<void>,
): Promise<'firestore'> {
  await withRateLimitStorageDeadline(consumePersistent());
  return 'firestore';
}
```

In `consumeBudget`, consume the per-user and service budget before provider calls. Remove the memory fallback from paid AI scopes; retain the existing bounded memory store only in tests or explicitly non-billable paths.

- [ ] **Step 4: Run focused tests**

Run: `npm --prefix functions test -- rateLimiter.test.ts serviceBudget.test.ts aiRequestBudget.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/serviceBudget.ts functions/test/serviceBudget.test.ts functions/src/index.ts functions/src/rateLimiter.ts functions/test/rateLimiter.test.ts
git commit -m "fix: enforce durable backend service budgets"
```

### Task 2: Move allocation-capable card creation behind a callable

**Files:**
- Create: `functions/src/cardPersistence.ts`
- Create: `functions/test/cardPersistence.test.ts`
- Modify: `functions/src/index.ts`
- Modify: `src/lib/cardRepository.ts`
- Modify: `firestore.rules`

- [ ] **Step 1: Write failing transaction tests**

Test one transaction that checks an owner counter, creates the canonical card and reservation, and increments the counter; prove it rejects at the configured cap and remains idempotent for an existing identity.

```ts
await expect(createCardForOwner(database, ownerId, card, {
  maximumCards: 5_000,
  libraryEpoch: 2,
})).resolves.toMatchObject({ created: true });

await expect(createCardForOwner(database, cappedOwnerId, card, {
  maximumCards: 5_000,
  libraryEpoch: 2,
})).rejects.toBeInstanceOf(CardAllocationLimitError);
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm --prefix functions test -- cardPersistence.test.ts`

Expected: FAIL because the persistence module does not exist.

- [ ] **Step 3: Implement the callable-backed allocation contract**

Create one transaction with this result contract:

```ts
export type CreateCardResult = {
  created: boolean;
  card: FirebaseFirestore.DocumentData;
};

export class CardAllocationLimitError extends Error {}
```

The transaction reads `users/{uid}/profile/library_state`, the canonical card, reservation, and `profile/resource_usage`; it then creates both identity documents and increments `cardCount` only when absent. Update `createCardIfAbsent` to call the protected Function when Firebase is configured. Deny direct card/reservation creates in Rules while retaining owner reads and validated updates/deletes.

- [ ] **Step 4: Add Rules emulator coverage in the next task and run Functions tests now**

Run: `npm --prefix functions test -- cardPersistence.test.ts inputValidation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/cardPersistence.ts functions/test/cardPersistence.test.ts functions/src/index.ts src/lib/cardRepository.ts firestore.rules
git commit -m "fix: bound trusted card identity allocation"
```

### Task 3: Lock profile names, card fields, and gamification shapes

> **Architecture amendment (ADR-007):** Firestore Rules cannot validate every
> member of the existing variable-length nested collections. Complete Task 3 in
> four bounded increments: (a) counter bounds and fully validated string-only
> custom decks; (b) callable-backed card review mutations; (c) callable-backed
> gamification transactions; and (d) callable-backed library-facet mutations.
> Keep the current document/read models, preserve valid legacy data, deploy
> functions and client adapters before the final Rules write cutover, and use
> stable operation receipts for retryable mutations.

**Increment status (2026-08-24):** 3A counter/custom-deck bounds, 3B
callable-backed review mutations, and 3C callable-backed gamification
transactions, and 3D callable-backed library-facet cutover are complete.
Task 4 shared-deck storage quotas is complete. Task 5 lossless legacy
shared-deck inventory is in progress.

**Files:**
- Modify: `firestore.rules`
- Modify: `firestore.rules.test.ts`
- Modify: `src/types/card.ts`
- Modify: `src/features/gamification/gamificationStorage.ts`

- [ ] **Step 1: Add failing Rules tests**

Add emulator tests that reject an arbitrary `profile/foo` document, a 101-character canonical list entry, oversized descriptive text, a 2,049th XP operation ID, and oversized history entries. Keep positive tests at every exact boundary.

```ts
await assertFails(setDoc(doc(ownerDb, 'users/alice/profile/arbitrary'), { value: 'x' }));
await assertFails(writeReservedCard(ownerDb, {
  ...validCard,
  synonyms: ['x'.repeat(101)],
}));
await assertFails(setDoc(doc(ownerDb, 'users/alice/profile/stats'), {
  ...validStats,
  appliedXpOperationIds: Array.from({ length: 2_049 }, (_, index) => `op-${index}`),
}));
```

- [ ] **Step 2: Run Rules tests and verify failure**

Run: `npm run test:rules`

Expected: FAIL on the new adversarial cases.

- [ ] **Step 3: Tighten the existing Rules helpers**

Delete the generic profile wildcard write rule. Add explicit matches for actual profile documents. Replace `isValidCanonicalStringList` with `isValidBoundedStringList`, bound every canonical text field to the existing client limits, and validate each review-history/gamification entry's exact keys, types, and string sizes. Keep type constants aligned with those limits.

- [ ] **Step 4: Run Rules and TypeScript checks**

Run: `npm run test:rules && npm run lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules firestore.rules.test.ts src/types/card.ts src/features/gamification/gamificationStorage.ts
git commit -m "fix: enforce bounded Firestore document schemas"
```

### Task 4: Enforce per-owner active shared-deck storage

**Files:**
- Modify: `functions/src/sharedDeckPersistence.ts`
- Modify: `functions/test/sharedDeckPersistence.test.ts`
- Modify: `functions/src/index.ts`
- Modify: `functions/src/inputValidation.ts`
- Modify: `functions/test/inputValidation.test.ts`

- [ ] **Step 1: Add failing quota tests**

Test that create atomically rejects when either active count or aggregate bytes would exceed the owner limit, and that revoke decrements usage once even when retried.

```ts
await expect(createSharedDeckAtomically(database, document, ownership, documents, {
  ownerUid,
  payloadBytes: 700_000,
  maximumActiveShares: 100,
  maximumActiveBytes: 25_000_000,
})).rejects.toBeInstanceOf(SharedDeckQuotaError);
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm --prefix functions test -- sharedDeckPersistence.test.ts inputValidation.test.ts`

Expected: FAIL because quota accounting is absent.

- [ ] **Step 3: Add transactional usage accounting**

Store `activeCount` and `activeBytes` in a server-only owner usage document. Include `payloadBytes` in private ownership metadata. Create and revoke update usage in the same transaction as the public/private deck pair. Lower the request ceiling only if existing fixture sizes prove 750 KB unnecessary; otherwise retain it and rely on the aggregate cap.

- [ ] **Step 4: Run focused tests**

Run: `npm --prefix functions test -- sharedDeckPersistence.test.ts inputValidation.test.ts`

Expected: PASS, including idempotent revoke.

- [ ] **Step 5: Commit**

```bash
git add functions/src/sharedDeckPersistence.ts functions/test/sharedDeckPersistence.test.ts functions/src/index.ts functions/src/inputValidation.ts functions/test/inputValidation.test.ts
git commit -m "fix: cap retained shared deck storage"
```

## Wave 2: Bounded And Conflict-Safe Migrations

### Task 5: Build a lossless legacy shared-deck inventory operator

> **Architecture amendment:** Task 5 is a read-only, unfrozen diagnostic and is
> never apply-eligible. It exposes no mode, confirmation, apply, delete,
> transaction, or batch-write branch. The Firestore identity of a share is its
> document ID: equal payload digests across different IDs are reported as
> equivalent but both links are preserved. Owner-free legacy records may use
> only the protected `OWNER_UID` assertion; conflicting public/private owner or
> timestamp metadata blocks the run. Exact current public records with matching
> schema-1 private metadata are valid upgrade candidates. Legacy expiry is
> deterministically proposed as the persisted scan start plus 30 days; existing
> transitional/current expiry is never extended. Task 8 must freeze both create
> and revoke, discard these unfrozen cursors, rescan from the beginning, verify
> a real backup, and compare source digests before any write.

**Files:**
- Create: `functions/src/legacySharedDeckMigration.ts`
- Create: `functions/test/legacySharedDeckMigration.test.ts`
- Create: `scripts/legacy-shared-deck-operator.ts`
- Create: `.github/workflows/migrate-legacy-shared-decks.yml`
- Modify: `package.json`

- [ ] **Step 1: Write classification and digest tests**

Cover current, transitional, valid legacy, malformed, empty, and exact-duplicate records. Compute the same normalized UTF-8 payload bytes used by Task 4, aggregate each protected owner's active share count/bytes, and flag either quota overflow without deleting or truncating records. Ensure reports contain IDs/digests/counts/byte totals but never card content or UID.

```ts
expect(classifyLegacyShare(validLegacy, ownerUid)).toMatchObject({
  action: 'migrate',
  ownerUid,
  preserveShareId: true,
});
expect(buildInventoryReport(records)).not.toContain(validLegacy.cards[0].word);
```

- [ ] **Step 2: Run the unit test and verify failure**

Run: `npm --prefix functions test -- legacySharedDeckMigration.test.ts`

Expected: FAIL because the classifier does not exist.

- [ ] **Step 3: Implement dry-run-first inventory**

Define an exact internal disposition union that can represent blockers without
serializing raw owner IDs:

```ts
export type LegacyShareDisposition =
  | 'keep-current'
  | 'migrate-owner-free-legacy'
  | 'migrate-transitional'
  | 'upgrade-private-v1'
  | 'quarantine-candidate'
  | 'block';
```

The workflow accepts only an immutable revision. `OWNER_UID` comes from a
protected environment secret and is represented only by a domain-separated
SHA-256 owner key. Page both public and private collections by document ID in
bounded chunks and digest-chain the cursor transitions. The redacted report
contains only hashed share/owner keys, counts, reason codes, byte totals, quota
status, and the chain head. A restricted local sealed inventory may contain raw
IDs/cursors and exact source/payload digests, written once with mode `0600`; it
is integrity evidence, not a backup. No card content or raw UID may appear in
stdout or uploaded artifacts.

- [ ] **Step 4: Run unit, lint, and workflow contract checks**

Run: `npm --prefix functions test -- legacySharedDeckMigration.test.ts && npm --prefix functions run lint && npx vitest run scripts/release-workflows.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/legacySharedDeckMigration.ts functions/test/legacySharedDeckMigration.test.ts scripts/legacy-shared-deck-operator.ts .github/workflows/migrate-legacy-shared-decks.yml package.json
git commit -m "feat: add lossless shared deck migration inventory"
```

### Task 6: Page library migration at the storage boundary

**Files:**
- Modify: `functions/src/legacyLibraryMigration.ts`
- Modify: `functions/src/legacyLibraryMigrationFirestore.ts`
- Modify: `functions/test/legacyLibraryMigration.test.ts`
- Modify: `functions/test/legacyLibraryMigrationFirestore.integration.test.ts`

- [ ] **Step 1: Write failing pagination tests**

Prove one call reads at most the requested page, returns a cursor, loads only page reservations, and refuses a page over the byte ceiling.

```ts
const result = await runLegacyLibraryMigration(store, ownerId, {
  jobId: 'query-v3', batchSize: 50, dryRun: true, cursor: null,
});
expect(store.readPage).toHaveBeenCalledWith(ownerId, { limit: 50, cursor: null });
expect(result.nextCursor).toBe('card-050');
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm --prefix functions test -- legacyLibraryMigration.test.ts legacyLibraryMigrationFirestore.integration.test.ts`

Expected: FAIL because the store still exposes whole-library `read`.

- [ ] **Step 3: Replace whole-library reads with stable pages**

Change the store contract to:

```ts
readPage(ownerId: string, options: {
  limit: number;
  cursor: string | null;
}): Promise<LegacyLibraryPage>;
```

Order cards by document ID, use `startAfter(cursor)` and `limit(batchSize)`, fetch reservations only for normalized words in the page, persist the cursor and owner-scoped lease in `profile/query_migration`, and cap serialized source bytes before planning.

- [ ] **Step 4: Run migration tests**

Run: `npm --prefix functions test -- legacyLibraryMigration.test.ts legacyLibraryMigrationFirestore.integration.test.ts legacyLibraryMigrationOwnerScope.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/legacyLibraryMigration.ts functions/src/legacyLibraryMigrationFirestore.ts functions/test/legacyLibraryMigration.test.ts functions/test/legacyLibraryMigrationFirestore.integration.test.ts
git commit -m "fix: page legacy migration work"
```

### Task 7: Make apply and rollback compare-and-set safe

**Files:**
- Modify: `functions/src/legacyLibraryMigrationFirestore.ts`
- Modify: `functions/test/legacyLibraryMigrationFirestore.integration.test.ts`
- Modify: `functions/src/legacyLibraryMigrationOperator.ts`
- Modify: `.github/workflows/repair-legacy-libraries.yml`

- [ ] **Step 1: Add failing concurrent-update tests**

Test edits immediately before apply and rollback. Both operations must stop without changing the live document.

```ts
await cardRef.update({ translation: 'newer user edit', revision: 9 });
await expect(rollbackLegacyLibraryMigration(database, OWNER_ID, 'query-v3'))
  .rejects.toThrow('live source no longer matches');
expect((await cardRef.get()).data()?.translation).toBe('newer user edit');
```

- [ ] **Step 2: Run the integration test and verify failure**

Run: `npm run test:rules`

Expected: FAIL because backup records do not bind all source/output digests.

- [ ] **Step 3: Store and compare canonical digests**

At backup store `sourceDigest`; at apply transactionally compare it and store `appliedDigest`; at rollback restore only when the live document equals `appliedDigest`. Surface conflicts as redacted counts. Update the operator confirmation from query-v2 to query-v3 and require the immutable revision used by the dry run.

- [ ] **Step 4: Run migration and workflow tests**

Run: `npm run test:rules && npx vitest run scripts/release-workflows.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/legacyLibraryMigrationFirestore.ts functions/test/legacyLibraryMigrationFirestore.integration.test.ts functions/src/legacyLibraryMigrationOperator.ts .github/workflows/repair-legacy-libraries.yml
git commit -m "fix: prevent stale migration rollback"
```

## Wave 3: Shared-Deck Migration And Rules Cutover

### Task 8: Apply the private-owner schema and remove legacy public branches

**Files:**
- Modify: `functions/src/legacySharedDeckMigration.ts`
- Modify: `functions/test/legacySharedDeckMigration.test.ts`
- Modify: `firestore.rules`
- Modify: `firestore.rules.test.ts`
- Modify: `.github/workflows/migrate-legacy-shared-decks.yml`

- [ ] **Step 1: Add failing migration and Rules tests**

Prove apply preserves public share IDs and card digests, writes owner UID only to `shared_deck_owners`, assigns bounded expiry, and quarantines invalid/duplicate records. Prove it also creates an exact versioned `profile/shared_deck_usage` ledger whose IDs, expiries, payload bytes, active count, and active bytes match the sealed inventory. Over-cap owners remain preserved and block cutover for explicit remediation. Prove Rules deny legacy/schema-1 public records and allow only live schema-2 documents.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm --prefix functions test -- legacySharedDeckMigration.test.ts && npm run test:rules`

Expected: FAIL while legacy Rules branches remain readable.

- [ ] **Step 3: Implement idempotent apply and gated cutover**

Enable workflow `apply` only with `APPLY_SHARED_DECK_V2`, matching a fresh frozen inventory digest, owner UID, and independently verified real backup manifest. Freeze both shared-deck create and revoke across the final inventory/apply window, discard Task 5 cursors, and rescan both collections from the beginning. Write schema-2 public data without UID, private owner metadata, expiry, payload bytes, and the verified per-owner usage ledger atomically per bounded batch. Remove `isValidLegacyPublicSharedDeck` and `isValidTransitionalCallableSharedDeck`, and enable the quota-enforcing callable, only after the apply verification report shows zero valid legacy records remaining and every active schema-2 share has exactly one matching ledger entry. Abort cutover on any source-digest change, missing/malformed/mismatched or over-cap owner state; never delete valid data to force the cutover.

- [ ] **Step 4: Run all share and Rules tests**

Run: `npm --prefix functions test -- sharedDeckPersistence.test.ts legacySharedDeckMigration.test.ts && npm run test:rules`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/legacySharedDeckMigration.ts functions/test/legacySharedDeckMigration.test.ts firestore.rules firestore.rules.test.ts .github/workflows/migrate-legacy-shared-decks.yml
git commit -m "fix: complete revocable shared deck migration"
```

### Checkpoint A: Before any production data operation

- [ ] Run `npm run verify:core` successfully.
- [ ] Independently review Tasks 1–8 for data loss and authorization regressions.
- [ ] Keep the Task 4 quota callable undeployed until Task 5 inventory and Task 8 apply have seeded and verified every active owner's `profile/shared_deck_usage` ledger.
- [ ] Confirm Firebase UID, TTL policy, App Check enforcement, provider quotas, backup retention, and rollback evidence outside the repository.
- [ ] Run only the protected shared-deck `dry-run`; compare total IDs, valid IDs, quarantined IDs, card counts, and digests.
- [ ] Obtain separate explicit authorization before apply, Rules cutover, quarantine deletion, or production rollback.

## Wave 4: Release And Catalog Provenance

### Task 9: Require protected immutable workflow revisions

**Files:**
- Modify: `.github/workflows/release-candidate.yml`
- Modify: `.github/workflows/deploy-production.yml`
- Modify: `.github/workflows/deploy-firestore-rules.yml`
- Modify: `.github/workflows/repair-legacy-libraries.yml`
- Modify: `scripts/release-workflows.test.mjs`

- [ ] **Step 1: Add failing workflow contract tests**

Assert every credentialed workflow checks that the requested/head SHA is reachable from the protected default branch and that checkout occurs at that exact SHA.

```js
expect(workflow).toContain('git merge-base --is-ancestor "$REVISION" "origin/$DEFAULT_BRANCH"');
expect(workflow).toContain('test "$GITHUB_SHA" = "$REVISION"');
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run scripts/release-workflows.test.mjs`

Expected: FAIL because ref reachability is not checked consistently.

- [ ] **Step 3: Add the uncredentialed provenance gate**

Fetch only the protected default branch, verify the immutable SHA is its ancestor, compare workflow path/head SHA, then pass a sealed artifact into protected jobs. Repair jobs must accept a full approved SHA and execute the compiled operator from the sealed candidate, not from an arbitrary dispatch ref.

- [ ] **Step 4: Run workflow tests**

Run: `npx vitest run scripts/release-workflows.test.mjs scripts/release-artifact.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release-candidate.yml .github/workflows/deploy-production.yml .github/workflows/deploy-firestore-rules.yml .github/workflows/repair-legacy-libraries.yml scripts/release-workflows.test.mjs
git commit -m "fix: restrict production workflows to protected revisions"
```

### Task 10: Install and verify Firebase CLI before authentication

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.github/workflows/deploy-production.yml`
- Modify: `.github/workflows/deploy-firestore-rules.yml`
- Modify: `scripts/release-workflows.test.mjs`

- [ ] **Step 1: Add failing ordering tests**

Assert `npm ci --ignore-scripts`, local Firebase version verification, and local binary resolution all occur before `google-github-actions/auth`; reject `npx --yes firebase-tools` in protected jobs.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run scripts/release-workflows.test.mjs`

Expected: FAIL on current authenticated `npx` calls.

- [ ] **Step 3: Pin the CLI and move installation before authentication**

Add exact `firebase-tools` to development dependencies, include it in the sealed candidate, run `npm ci --ignore-scripts --no-audit --no-fund`, verify `./node_modules/.bin/firebase --version` equals the pinned version, then authenticate and invoke that local path.

- [ ] **Step 4: Run workflow and lockfile checks**

Run: `npm ci --ignore-scripts --no-audit --no-fund && npx vitest run scripts/release-workflows.test.mjs && npm run verify:secrets`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .github/workflows/deploy-production.yml .github/workflows/deploy-firestore-rules.yml scripts/release-workflows.test.mjs
git commit -m "fix: preinstall trusted Firebase deployment CLI"
```

### Task 11: Bind catalog approval to reviewed content

**Files:**
- Modify: `src/features/catalogPipeline/catalogContracts.ts`
- Modify: `src/features/catalogPipeline/catalogBuilder.ts`
- Modify: `scripts/catalog-operator.ts`
- Modify: `scripts/catalog-operator.test.ts`

- [ ] **Step 1: Add failing provenance tests**

Test that candidate-provided reviewer ID/status cannot authorize publication without a protected digest-bound assertion.

```ts
await expect(buildCatalogFiles(manifestPath, output, {
  reviewerId: 'approved-reviewer',
  approvedDigest: '0'.repeat(64),
  reviewedAt: now,
})).rejects.toThrow(/digest/i);
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run scripts/catalog-operator.test.ts scripts/release-artifact.test.mjs`

Expected: FAIL on digest binding.

- [ ] **Step 3: Enforce protected approval**

Compute the canonical candidate digest before checking approval. Require protected operator authority `{ reviewerId, approvedDigest, reviewedAt }` and reject mismatched or stale assertions.

- [ ] **Step 4: Run catalog checks**

Run: `npm run catalog:verify && npx vitest run scripts/catalog-operator.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalogPipeline/catalogContracts.ts src/features/catalogPipeline/catalogBuilder.ts scripts/catalog-operator.ts scripts/catalog-operator.test.ts
git commit -m "fix: bind trusted catalog approval"
```

### Task 12: Reject symlinks in extension release packages

**Files:**
- Modify: `scripts/browser-extension-package.mjs`
- Modify: `extensions/lingoflash/tests/package.node.mjs`

- [ ] **Step 1: Add a failing symlink test**

Create a temporary symlink beneath the extension root whose target is a regular file outside that root. Assert `collectExtensionFiles` rejects it before reading.

```js
await assert.rejects(
  () => collectExtensionFiles(extensionRoot, manifestReferencingSymlink),
  /symbolic link/i,
);
```

- [ ] **Step 2: Run the package test and verify failure**

Run: `node --test extensions/lingoflash/tests/package.node.mjs`

Expected: FAIL because `stat` follows the symlink.

- [ ] **Step 3: Enforce `lstat` and real-path containment**

Use `lstat` to reject symbolic links, resolve both root and candidate through `realpath`, and require the candidate path to start with the root path plus the platform separator before reading.

- [ ] **Step 4: Run the extension release check**

Run: `npm run extension:check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/browser-extension-package.mjs extensions/lingoflash/tests/package.node.mjs
git commit -m "fix: reject extension package symlinks"
```

## Wave 5: Browser, Extension, And Development Boundaries

### Task 13: Use one bounded spreadsheet parser

**Files:**
- Create: `src/features/importExport/spreadsheetWorkbook.ts`
- Create: `src/features/importExport/spreadsheetWorkbook.test.ts`
- Modify: `src/features/importExport/useSpreadsheetImport.ts`
- Modify: `src/features/intake/spreadsheetFileRequest.ts`
- Modify: `src/features/importExport/spreadsheetModel.ts`

- [ ] **Step 1: Add safe adversarial parser tests**

Use synthetic workbook metadata, not a memory-exhaustion payload. Reject excessive archive entries, declared expanded bytes, sheet rows/columns/cells, and duplicate worksheet conversion. Accept current CSV/XLSX fixtures.

```ts
expect(() => validateWorkbookLimits({
  archiveEntries: 5_001,
  expandedBytes: 1,
  rows: 1,
  columns: 1,
})).toThrow('too many archive entries');
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run src/features/importExport/spreadsheetWorkbook.test.ts src/features/importExport/spreadsheetImportService.test.ts`

Expected: FAIL because both adapters parse independently and lack pre-materialization limits.

- [ ] **Step 3: Centralize bounded loading**

Export one `loadSpreadsheetWorkbook(file)` used by both paths. Validate supported format and parser metadata before conversion, set parser row ceilings where supported, perform a single `sheet_to_json(..., { header: 1 })`, and derive structured rows from that bounded matrix. If the locked parser cannot guarantee expansion limits, run parsing in a Web Worker with termination on time/memory-oriented metadata ceilings.

- [ ] **Step 4: Run import tests and build**

Run: `npx vitest run src/features/importExport && npm run build`

Expected: PASS with no visual output change.

- [ ] **Step 5: Commit**

```bash
git add src/features/importExport/spreadsheetWorkbook.ts src/features/importExport/spreadsheetWorkbook.test.ts src/features/importExport/useSpreadsheetImport.ts src/features/intake/spreadsheetFileRequest.ts src/features/importExport/spreadsheetModel.ts
git commit -m "fix: bound spreadsheet parsing"
```

### Task 14: Abort imports when the active owner changes

**Files:**
- Modify: `src/features/intake/useCardIntake.ts`
- Modify: `src/features/intake/useCardIntake.test.ts`
- Modify: `src/features/importExport/spreadsheetImportService.ts`
- Modify: `src/features/importExport/spreadsheetImportService.test.ts`

- [ ] **Step 1: Add failing account-switch tests**

Start an import under owner A, replace the binding with owner B before persistence resolves, and prove no B mutation or stale completion occurs.

```ts
const importPromise = owner.actions.importSpreadsheet(request);
owner.replace(optionsFor('owner-b'));
deferredWorkbook.resolve(workbook);
await importPromise;
expect(ownerBPort.persistStructured).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run src/features/intake/useCardIntake.test.ts src/features/importExport/spreadsheetImportService.test.ts`

Expected: FAIL because the request lacks an owner lifecycle guard.

- [ ] **Step 3: Add a lifecycle assertion before every mutation phase**

Capture `ownerKey` and a generation token when import begins. Pass `assertActive()` into the service and invoke it after load, before reads, before each persistent mutation, and before completion feedback. Replacing/disposal invalidates the token.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run src/features/intake/useCardIntake.test.ts src/features/importExport/spreadsheetImportService.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/intake/useCardIntake.ts src/features/intake/useCardIntake.test.ts src/features/importExport/spreadsheetImportService.ts src/features/importExport/spreadsheetImportService.test.ts
git commit -m "fix: bind spreadsheet imports to owner lifecycle"
```

### Task 15: Bind extension messages to bounded one-time jobs

**Files:**
- Modify: `extensions/lingoflash/app-bridge.js`
- Modify: `extensions/lingoflash/background-core.js`
- Modify: `extensions/lingoflash/shared.js`
- Modify: `extensions/lingoflash/tests/app-bridge.node.mjs`
- Modify: `extensions/lingoflash/tests/background.node.mjs`

- [ ] **Step 1: Add failing size, replay, and origin tests**

Reject encoded fragments over the maximum before `atob`, reject results with the wrong nonce/origin/tab/frame, and ignore a second result after a successful claim.

```js
assert.equal(decodeImportFragment('A'.repeat(MAX_ENCODED_IMPORT_LENGTH + 1)), null);
await assert.rejects(() => appResult({ ...result, nonce: 'wrong' }, trustedSender));
assert.deepEqual(await appResult(validResult, trustedSender), { ignored: true });
```

- [ ] **Step 2: Run extension tests and verify failure**

Run: `node --test extensions/lingoflash/tests/app-bridge.node.mjs extensions/lingoflash/tests/background.node.mjs`

Expected: FAIL on encoded size or nonce/frame binding.

- [ ] **Step 3: Add pre-decode bounds and one-time nonce binding**

Put shared constants in `shared.js`. Generate a nonce with `crypto.getRandomValues`, persist it with source tab, worker tab, expected app origin, creation time, and unclaimed state. Include it in the import intent and require an exact match before claiming a result. Remove nonce-bearing storage during cleanup.

- [ ] **Step 4: Run the full extension check**

Run: `npm run extension:check`

Expected: PASS with unchanged popup and inline-bubble rendering tests.

- [ ] **Step 5: Commit**

```bash
git add extensions/lingoflash/app-bridge.js extensions/lingoflash/background-core.js extensions/lingoflash/shared.js extensions/lingoflash/tests/app-bridge.node.mjs extensions/lingoflash/tests/background.node.mjs
git commit -m "fix: authenticate extension import jobs"
```

### Task 16: Authenticate and cap the loopback device API

**Files:**
- Modify: `dev/sharedDeviceStoreAdapter.ts`
- Modify: `devEndpointSecurity.test.ts`
- Modify: `deviceBackupReconciliation.test.ts`
- Modify: `vite.config.ts`

- [ ] **Step 1: Add failing token and resource-cap tests**

Require a session token for reads, writes, and event streams. Add cases for oversized bodies, maximum active event streams, maximum lease entries, and idle cleanup.

```ts
expect(isTrustedLocalDeviceRequest(request(headers), sessionToken)).toBe(false);
expect(isTrustedLocalDeviceRequest(request({
  ...headers,
  'x-lingoflash-device-token': sessionToken,
}), sessionToken)).toBe(true);
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run devEndpointSecurity.test.ts deviceBackupReconciliation.test.ts`

Expected: FAIL because same-origin headers alone authorize access.

- [ ] **Step 3: Add a per-process token and hard caps**

Generate 32 random bytes when the plugin starts, expose the token only to the dev client through Vite's in-process transform, compare with `timingSafeEqual`, cap body bytes before JSON parsing, cap active event responses and lease maps, and delete expired entries on every access and a bounded interval. Keep loopback binding and origin checks.

- [ ] **Step 4: Run focused tests and lint**

Run: `npx vitest run devEndpointSecurity.test.ts deviceBackupReconciliation.test.ts && npm run lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dev/sharedDeviceStoreAdapter.ts devEndpointSecurity.test.ts deviceBackupReconciliation.test.ts vite.config.ts
git commit -m "fix: authenticate local device sync"
```

### Task 17: Remove direct development Gemini credentials

**Files:**
- Modify: `vite.config.ts`
- Modify: `src/lib/gemini.ts`
- Modify: `src/lib/gemini.test.ts`
- Modify: `scripts/verify-build-secrets.test.mjs`

- [ ] **Step 1: Add failing no-browser-secret tests**

Assert the Vite config never defines `process.env.GEMINI_API_KEY`, the client module uses the protected callable in development, and generated bundles contain no configured sentinel secret.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx vitest run src/lib/gemini.test.ts scripts/verify-build-secrets.test.mjs`

Expected: FAIL while Vite embeds the development key.

- [ ] **Step 3: Delete the browser credential path**

Remove the Vite `define` entry and direct `GoogleGenAI` client construction. Route development vocabulary operations through the existing `generateVocabulary` callable; use the emulator through Firebase configuration when local backend development is required.

- [ ] **Step 4: Run secret, unit, and build checks**

Run: `npx vitest run src/lib/gemini.test.ts scripts/verify-build-secrets.test.mjs && npm run build && npm run verify:secrets`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts src/lib/gemini.ts src/lib/gemini.test.ts scripts/verify-build-secrets.test.mjs
git commit -m "fix: keep Gemini credentials server-side"
```

## Wave 6: Assurance Verification And Delivery

### Task 18: Verify, review, rescan, and prepare the production runbook

**Files:**
- Create: `docs/runbooks/security-remediation-rollout.md`
- Modify: `docs/superpowers/plans/2026-08-23-security-remediation.md`

- [ ] **Step 1: Run focused subsystem gates**

Run:

```bash
npm --prefix functions test
npm run test:rules
npm run extension:check
npm run catalog:verify
npx vitest run devEndpointSecurity.test.ts deviceBackupReconciliation.test.ts src/features/importExport src/features/intake/useCardIntake.test.ts scripts/release-workflows.test.mjs
```

Expected: every command exits 0.

- [ ] **Step 2: Run the full repository gate**

Run: `npm run verify`

Expected: lint, unit, Functions, Rules, build, secrets, bundle, Playwright, audits, and evidence all pass.

- [ ] **Step 3: Confirm UI and motion preservation**

Run: `npx playwright test e2e/flashcard-remediation.spec.ts e2e/motion-remediation.spec.ts e2e/accessibility.spec.ts --project=chromium`

Expected: PASS with no intentional screenshot, layout, accessibility, or animation delta.

- [ ] **Step 4: Perform mandatory independent reviews**

After implementation and verification, dispatch one read-only correctness reviewer and one separate security reviewer. Fix every substantiated finding, rerun affected checks, and send fixes back to the same reviewers for re-review.

- [ ] **Step 5: Repeat Codex Security deep scan**

Run the repository-wide deep scan against the final revision. Expected: no validated remaining instance of the 21 tracked findings. Treat new substantiated findings as incomplete work.

- [ ] **Step 6: Write the production rollout runbook**

Document immutable revision, artifact digest, backup manifest, owner UID input procedure, dry-run counters/digests, App Check and TTL checks, provider quotas, GitHub environment protections, apply approval, Rules cutover, verification window, quarantine handling, and rollback conditions. Do not include secrets, card content, or the owner's UID.

- [ ] **Step 7: Inspect the final diff**

Run: `git diff --check && git status --short && git diff --stat 49c90d3...HEAD`

Expected: no whitespace errors; only planned security, test, workflow, and runbook files differ from the implementation base.

- [ ] **Step 8: Commit the verified runbook and plan completion marks**

```bash
git add docs/runbooks/security-remediation-rollout.md docs/superpowers/plans/2026-08-23-security-remediation.md
git commit -m "docs: record verified security rollout"
```

## Production Checkpoints

1. Functions and compatible client deploy before any Rules restriction that removes an existing write path.
2. Shared-deck backup and dry run must show every valid deck assigned to the protected owner UID.
3. Shared-deck apply must preserve share IDs and card digests; otherwise stop before Rules cutover.
4. Rules cutover occurs only after zero valid legacy/schema-1 records remain.
5. Quarantined records remain recoverable through the verification window; deletion needs separate authorization.
6. Rollback never overwrites a live digest mismatch and never bypasses protected revision checks.

## Completion Evidence

- Focused test output for each task.
- Successful `npm run verify` output.
- Correctness reviewer approval and security-reviewer approval.
- Final Codex Security report and artifact paths.
- Redacted migration inventory, backup manifest digest, apply verification, and Rules cutover evidence.
- Confirmation that existing UI, accessibility, and motion checks remain unchanged.
