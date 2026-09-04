# Security Remediation Production Rollout

This runbook prepares the 21-finding security remediation for production. It
does not authorize a deployment, migration, Rules cutover, rollback, or data
deletion. Each protected GitHub environment must receive its own human
approval.

## Release record

Record these values in the protected change ticket, not in this repository:

- full immutable revision (`40` or `64` hexadecimal characters)
- successful `release-candidate.yml` run ID
- sealed candidate SHA-256 and release manifest digest
- approver and approval reference for each protected environment
- start time, operator, verification-window end time, and rollback owner

Never record secrets, card content, or the Firebase owner UID in the ticket,
workflow summary, logs, or downloaded artifacts.

## Preconditions

1. Require green `quality.yml`, `npm run verify`, both independent reviews,
   and the final Codex Security report for the exact immutable revision.
2. Confirm GitHub environments require reviewers and prevent self-approval:
   `production`, `production-hosting`, `production-functions`,
   `production-legacy-library-dry-run`, `production-legacy-library-apply`,
   `production-legacy-library-rollback`,
   `production-shared-deck-inventory`, `production-shared-deck-apply`,
   `production-shared-deck-index-preparation`, `production-shared-deck-supersede`,
   `production-rules-cutover`, and `production-rules-rollback`.
3. Confirm Firebase App Check enforcement is enabled for protected callables.
   Save only the bounded observation/change-ticket reference used by
   `deploy-production.yml`.
4. Confirm Firestore TTL is enabled on `expiresAt` for `shared_decks` and
   `shared_deck_owners`. TTL cleanup is not a substitute for revocation.
   Enabling TTL is a separately approved, idempotent production operation:

   ```bash
   gcloud firestore fields ttls update expiresAt \
     --collection-group=shared_decks \
     --enable-ttl \
     --project="$FIREBASE_PROJECT_ID" \
     --database="$FIRESTORE_DATABASE_ID"
   gcloud firestore fields ttls update expiresAt \
     --collection-group=shared_deck_owners \
     --enable-ttl \
     --project="$FIREBASE_PROJECT_ID" \
     --database="$FIRESTORE_DATABASE_ID"
   ```

   Verify without changing state and retain the JSON output with release evidence:

   ```bash
   gcloud firestore fields ttls list \
     --project="$FIREBASE_PROJECT_ID" \
     --database="$FIRESTORE_DATABASE_ID" \
     --format=json > ttl-policies.json
   for collection in shared_decks shared_deck_owners; do
     jq -e --arg collection "$collection" '
       any(.[]?; ((.name // "") | endswith("/collectionGroups/\($collection)/fields/expiresAt")) and ((.state // "") == "ACTIVE"))
     ' ttl-policies.json > /dev/null
   done
   ```
5. Confirm provider quotas, durable service budgets, alerting, and billing
   limits are active for Gemini and other paid providers. Stop if storage for
   a paid-provider budget is unavailable; the backend must fail closed.
6. Confirm a restorable Firestore backup exists and record its backup manifest
   digest, project/database identifiers, timestamp, and retention window.
   Test restore access without restoring over production.
7. Configure each legacy-library environment with migration-only Firestore
   credentials; never expose Hosting deployment credentials to this workflow.
   Apply and rollback require separate reviewers and secrets even though the
   workflow secret name is the same.

## Owner UID input

The migration owner UID is supplied only through the protected workflow secret
or environment input used by `migrate-legacy-shared-decks.yml`. Obtain the
canonical UID from Firebase Authentication through the approved operator
procedure, have a second operator verify it, and never paste it into source,
chat, artifacts, logs, or the change ticket. Record only the workflow's hashed
owner key.

## Staged rollout

### 1. Seal the candidate

Run `release-candidate.yml` for the full revision. Verify that the checked-out
SHA, manifest revision, candidate SHA-256, project ID, database ID, and every
component digest agree. Any mismatch invalidates the candidate.

### 2. Deploy compatible code before restrictive Rules

Run `deploy-production.yml` with the sealed revision/run/digest. Deploy the
compatible client and Functions before removing any existing Rules write path.
Functions promotion requires a separate `production-functions` approval and a
bounded App Check observation reference. Verify health, authentication,
callable authorization, error rate, p95 latency, provider quota use, and App
Check rejection metrics before proceeding.

### 3. Inventory and dry-run shared decks

Run `migrate-legacy-shared-decks.yml` in `inventory` mode. Preserve the report
artifact and its SHA-256. Review only redacted counters and digests:

- scanned public/private records and bounded-page completion
- valid, legacy/schema-1, invalid, quarantined, duplicate, and missing-pair counts
- active-share count/bytes against owner quota
- sealed inventory/root/chunk digests and hashed owner key
- every valid deck mapped to the protected owner scope

Stop if the scan is incomplete, quota is exceeded, the backup is unsealed, a
valid deck lacks an owner, or any digest/counter is unstable between identical
inventory runs. Invalid records remain recoverable; do not delete them.

If the report requires index preparation, run `prepare-indexes` under its
separate approval, then bind `indexes_run_id` and `indexes_report_sha256` to the
later apply. Never use `supersede` without a separate incident/change approval
and the exact sealed ineligible-inventory and root digests.

### 4. Apply migration

Authorize `apply` only after the inventory, backup manifest, index report (when
required), revision, owner key, and all digests have been independently checked.
The apply report must prove:

- share IDs are unchanged
- public/private card digests match the sealed inventory
- owner/usage ledgers match the sealed counters
- zero valid legacy/schema-1 records remain
- quarantine is unchanged and recoverable

Any mismatch stops the rollout before Rules cutover. Do not retry with changed
inputs; produce a new inventory and approval.

### 5. Cut over Firestore Rules

Run `deploy-firestore-rules.yml` with `operation=cutover`, the exact candidate
run/digest, approval reference, and successful migration run/report SHA-256.
The workflow must verify the protected revision and require zero valid legacy
or schema-1 records. Smoke-test owner isolation, signed-out access, callable
writes, shared-deck reads/revocation, and cross-account denial.

### 6. Verification window

Keep the release under active observation for at least 24 hours. Hold or roll
back on any data-integrity mismatch, new authorization bypass, App Check
regression, provider-budget failure, error rate above twice baseline, p95
latency more than 50% above baseline, or new client errors above 0.1% of
sessions. Keep quarantine and backups through the full window. Deletion needs a
separate authorization after the window.

## Rollback

1. Stop new approvals and disable affected provider traffic or release surface
   through existing controls when safe.
2. For Rules, run `deploy-firestore-rules.yml` with `operation=rollback` using
   the protected compatible revision and sealed candidate artifact.
3. Roll back hosting/Functions only to a revision compatible with the current
   data and Rules. Do not bypass protected revision checks.
4. A migration rollback must compare the live record and sealed digest before
   every write. Never overwrite a live digest mismatch or discard concurrent
   user changes; stop and quarantine the conflict for manual recovery.
5. Verify health, authentication, owner isolation, share availability, error
   rate, latency, App Check, provider quotas, and log delivery after rollback.

Rollback does not authorize deletion. Backups, migration manifests, quarantine,
and redacted evidence remain retained until a separate closure approval.
