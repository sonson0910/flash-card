# Phase 6 release and rollback runbook

This runbook is deliberately human-gated. No local command deploys, changes
traffic, publishes draft content, or mutates production data. Workflow
configuration is not evidence that staging, migration, deployment or rollback ran.

## 1. Build, seal and retain one candidate

1. Dispatch `Build release candidate` for the reviewed full commit revision. The
   workflow uses Node 22 and Java 21, performs clean root/Functions installs, checks
   production release configuration, and runs the complete repository verification
   against one build. It must not rebuild after browser, secret or bundle gates.
   Verified readiness evidence is emitted only when that revision exactly matches
   a clean Git HEAD; a missing/mismatched revision or dirty worktree aborts before
   the evidence file is written. Ignore legacy schema-1 or `"local"` artifacts.
2. The final step seals `dist`, compiled Functions, Firestore Rules/indexes,
   `firebase.json` and readiness evidence. Retain together:
   - candidate workflow run ID;
   - full 40/64-character revision;
   - candidate SHA-256 from the workflow summary;
   - `artifacts/release-candidate-manifest.json` and readiness JSON.
3. Never copy a digest between revisions or deploy an unsealed rebuild. GitHub
   artifacts have bounded retention; before expiry, move an approved last-known-good
   candidate to the organization's immutable release archive or block deployment for
   lack of a recoverable artifact.
4. Confirm the content gate still blocks the draft AI-assisted pilot. Publishing
   requires source/rights evidence, independent review and matching digest.
5. Catalog builds additionally require `CATALOG_TRUSTED_REVIEWER_IDS` from a
   protected operator environment. Never accept reviewer authority from candidate
   files or caller-provided flags. Pin an approved content-derived release ID in the
   language registry before any catalog deployment.
6. For shared decks, verify Firestore TTL is enabled on `expiresAt` for both
   `shared_decks` and `shared_deck_owners`. Current shares contain at most 100 cards
   and expire 30 days after creation. Product copy must disclose the current client's
   silent truncation of larger categories.

## 2. Reservation migration gate before any Rules cutover

1. Run the separately authorized Admin migration in dry-run mode. Group cards by the
   exact application `normalizedWord`, report duplicates and invalid/non-canonical
   identities, and retain a revision/epoch/fingerprint rollback snapshot encrypted by
   an external Google Cloud KMS key version. Never upload plaintext owner, document,
   progress, or card state to GitHub Actions; the decrypt authority must remain outside
   GitHub. A local developer session is not authorized to produce this evidence.
2. In an approved write-freeze window, select and materialize one
   `createWordCardId(normalizedWord)` primary per identity, merge learning progress,
   tombstone/quarantine losers without deleting rollback evidence, and verify every
   owner has at most one card per normalized identity.
3. Backfill `card_reservations/{lowercase full SHA-256(normalizedWord)}` with the
   exact `{ schemaVersion: 1, cardId, normalizedWord }` payload. A lazy client backfill
   is insufficient because an adversarial client could win the first claim.
4. Run a final delta verification immediately before cutover and produce a bounded
   `rules-cutover-evidence.json`. It must be bound to the production project/database,
   compatible client revision, exact `firestore.rules` digest, ciphertext digest,
   protected `ROLLBACK_KMS_KEY_VERSION` metadata using `gcp-kms-v1`, and a fresh
   UTC timestamp. It must report zero duplicate/invalid identities,
   zero missing/mismatched reservations, equal canonical/reservation counts, confirmed
   write freeze and confirmed final delta verification.
5. `Deploy production Firestore Rules cutover` accepts only the evidence artifact's
   authorized run ID, exact SHA-256 and approval reference. Its bounded evidence JSON
   may accompany the rollback payload, but that payload may only be
   `rollback-snapshot.enc`; plaintext and the external KMS key are never Actions
   artifacts or secrets. Its
   protected `production-rules-cutover` job stream-hashes that ciphertext, revalidates
   the evidence and deploys only Firestore Rules (never indexes).
   The normal production workflow never includes Rules. The repository intentionally
   does not provide or claim the production Admin migration workflow in this local
   implementation, so this gate remains blocked until that separately authorized tool
   and evidence exist.

## 3. Authorized staging smoke

Deploy the exact sealed candidate to an approved HTTPS staging environment. Then run:

```sh
STAGING_ORIGIN=https://staging.example.test \
EXPECTED_REVISION=<full-immutable-commit-sha> \
CATALOG_MANIFEST_PATH=/catalog/english-core/release-manifest.json npm run phase6:smoke
```

The operator rejects redirects, a non-2xx application document, revision mismatch,
unhealthy metadata, missing CSP/nosniff/referrer headers, a failed manifest probe and
a release manifest whose `Cache-Control` lacks `no-cache`, `no-store` or
`must-revalidate`. Mutable manifest pointers must never be `immutable`; reserve
`public, max-age=31536000, immutable` for hashed content assets.

Manually verify App Check, sign-in/out, Firestore owner isolation, AI failure fallback
and image failure fallback. Record aggregate evidence without tokens, emails, UIDs,
words, translations or free-form errors. A local fake transport is not staging proof.

## 4. Staged production promotion

Configure required reviewers for `production-hosting`, `production-functions` and
`production-rules-cutover`. Store the dedicated least-privilege deployment service
account JSON in each deployment environment. Configure both protected
`FIREBASE_PROJECT_ID` and `FIRESTORE_DATABASE_ID` in all three environments, and
configure the non-secret protected `ROLLBACK_KMS_KEY_VERSION` resource name in
`production-rules-cutover`. The candidate-build environment alone supplies the
public `VITE_FIREBASE_APP_CHECK_SITE_KEY`.

1. Dispatch `Deploy production artifact` with the retained candidate run ID, revision
   and candidate SHA-256, leaving `promote_functions=false`. The workflow verifies the
   source workflow's path/conclusion/head SHA, downloads that exact artifact, rehashes
   every sealed component, removes rebuild hooks from a derived deployment config and
   deploys only Hosting after `production-hosting` approval.
2. Run production smoke against the deployed revision. Observe App Check token metrics
   and protected-call success long enough for the authorized operator to rule out stale
   clients. Do not treat a successful artifact download as deployment evidence.
3. If the observation is accepted, dispatch the same candidate with
   `promote_functions=true` and a bounded `app_check_observation_ref`. Hosting remains
   the first idempotent stage; Functions then waits for separate
   `production-functions` approval and deploys only the sealed compiled Functions.
   `ENFORCE_APP_CHECK` defaults to true. Never deploy Functions enforcement before the
   compatible Hosting client is observed.
4. Do not select or infer an all-target deploy. Firestore Rules use only the evidence-
   bound workflow in section 2.

## 5. Canary decision (advisory only)

Collect a fresh JSON object with exactly these seven numeric fields:
`sampleSize`, `errorRate`, `p95Ms`, `ageMs`, `syncLossRate`, `quotaUsageRate` and
`costRate`. Unknown/non-numeric/negative fields or a fractional sample size are invalid;
missing fields hold and can never promote. Run:

```sh
npm run phase6:canary -- ./canary-evidence.json
```

- `promote`: sample ≥100, age ≤5 minutes, error rate ≤1%, p95 ≤2 seconds,
  zero sync loss, quota ≤90% and cost rate ≤100%.
- `hold`: required evidence is missing, stale or undersized.
- `rollback`: a reliability, sync, quota or cost threshold is breached.

The result never changes traffic. A human with deployment authority makes the decision.

## 6. Target-specific rollback

Before each promotion, record the last-known-good candidate run ID, revision, digest,
Hosting release evidence, Functions compatibility decision and current Rules digest.
If that exact candidate is no longer retrievable, stop; rebuilding the same revision is
not an artifact rollback.

1. **Hosting:** stop promotion, dispatch `Deploy production artifact` with the retained
   last-known-good candidate and `promote_functions=false`, then verify `/health.json`,
   security headers and critical browser flows against the restored revision.
2. **Functions:** only if the last-known-good Functions are compatible with current data
   and Rules, dispatch that same candidate with `promote_functions=true`, attach the
   incident/compatibility reference, obtain the separate Functions approval, and verify
   Auth/App Check/error/latency metrics. Otherwise hold and mitigate forward.
3. **Firestore Rules:** never use the normal deployment workflow. An authorized Admin
   rehearsal must produce fresh `operation: rollback`, `status: rollback-ready` evidence
   bound to the target Rules digest and retained encrypted snapshot. Run the separate Rules
   workflow with that evidence and protected approval.
4. **Migrated data:** do not delete v2 source records. Decrypt only inside the authorized
   private operator environment; never expose the key or plaintext through Actions. Apply
   snapshot rollback only when
   owner, document ID, fingerprint, revision and epoch preconditions still match.
   Preserve newer/current documents and quarantine conflicts for manual review.
5. Re-run smoke, record the incident correlation ID and aggregate thresholds, and keep
   private learning content out of logs and tickets.
