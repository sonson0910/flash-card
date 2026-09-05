# Phase 6 release and rollback runbook

This runbook is deliberately human-gated. No local command deploys, changes
traffic, publishes draft content, or mutates production data. Workflow
configuration is not evidence that staging, migration, deployment or rollback ran.
This documentation change is preparation only: it has not dispatched a workflow,
deployed to staging or production, performed a rollback, or produced external
release evidence. Those actions and their evidence remain pending.

## Release gates and evidence status

For a candidate build, promotion, or acceptance of staging/production learning
smoke, fail closed unless all of these externally protected prerequisites are
available and verified:

- the exact Listen media pack is both `reviewed` and `published`, with its
  publication/rights evidence and matching digest;
- an approved real staging identity is available: an authorized test account; the
  journey must resolve or create its real phrase/card identity at runtime, never a
  fixture, placeholder or synthetic ID;
- an approved HTTPS staging origin and its protected environment are available.

If any prerequisite is absent, stale or unverifiable, stop the candidate,
promotion or learning-smoke path. Do not dispatch those release workflows and do
not record a smoke or promotion pass. This gate does not block an incident-triggered
emergency rollback: rollback may proceed only through the protected rollback
workflow to a retained sealed SW-compatible LKG (or a pre-verified, pre-sealed
recovery candidate) with its own tuple. Missing journey evidence remains `pending`
and can never become a release pass; it must not prevent restoring a known-good
candidate. Local fixtures, fake transports and workflow configuration never satisfy
these gates.

For every candidate and retained last-known-good (LKG), retain one exact
immutable tuple; never mix fields from different runs:

```text
workflowRunId=<successful release-candidate run ID>
revision=<full lowercase 40- or 64-character commit SHA>
candidateSha256=<64 lowercase SHA-256 from the workflow summary/manifest>
manifest=artifacts/release-candidate-manifest.json
readiness=artifacts/phase6-readiness.json (same revision, releaseEligible=true)
```

The manifest and readiness files are the exact sealed files retained with that
tuple. The LKG has its own independent tuple and must remain retrievable before
promotion; a copied digest, mutable URL or rebuilt equivalent is not an LKG.

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
3. Never copy a digest between revisions or deploy an unsealed rebuild. The current
   `release-candidate.yml` retains the source Actions artifact for 14 days, and
   `deploy-production.yml` retrieves only that source artifact by `candidate_run_id`.
   Before each promotion, a separate protected **READ-ONLY** retrieval/verification
   mechanism must be reviewed and tested to validate source-run provenance, download
   the artifact by `candidate_run_id`, run the existing
   `scripts/release-artifact.mjs verify` contract, and emit bounded evidence without
   access to deployment jobs or credentials. That mechanism is not present in this
   repository. Until it succeeds for the entire planned rollback window, **BLOCK
   promotion**. Never dispatch `deploy-production.yml` merely to test rollback
   retrieval: it has production deployment jobs and credentials. An immutable archive
   copy is backup evidence only until a separate protected archive-ingestion path exists
   and is independently reviewed and tested; it is not consumable by the current
   workflow. Never manually extract or deploy an archive copy. The retained source LKG
   must include a valid `/sw.js`; compatibility is checked before it is accepted for
   rollback.
4. Confirm the content gate still blocks the draft AI-assisted pilot. Publishing
   requires source/rights evidence, independent review and matching digest. The
   same gate applies to the Listen pack: without reviewed/published media and its
   matching publication/rights digest, hold and do not run the real-pack smoke.
5. Catalog review follows a protected validate → digest → approval flow. Run the
   catalog validator with the trusted rights registry
   (`validate --input <manifest> --rights <registry>`) and
   record its exact `approvalDigest`. A separately
   protected operator environment must then provide all three values:

   ```text
   CATALOG_REVIEWER_ID=<exact reviewer identity>
   CATALOG_APPROVED_DIGEST=<64 lowercase hex approvalDigest>
   CATALOG_REVIEWED_AT=<canonical UTC ISO-8601 timestamp>
   ```

   The build accepts only the exact combined protected `approvalDigest` from
   that rights-aware validation (binding the validated source and referenced
   trusted asset rights), the singular protected reviewer identity, and an
   approval timestamp no more than 24 hours old (with only a small bounded future
   skew). Never accept reviewer authority from
   candidate files, `CATALOG_TRUSTED_REVIEWER_IDS`, or caller-provided flags.
   Local build output is never publication or release evidence; only the
   separately protected operator/promotion boundary may accept the approved
   digest and authorize publication. Pin an approved content-derived release ID
   in the language registry before any catalog deployment. Environment branch
   and reviewer policy remains an external protected control; verify it through
   the Task18 runbook rather than simulating it in a local build.
6. For shared decks, verify Firestore TTL is enabled on `expiresAt` for both
   `shared_decks` and `shared_deck_owners`. Current shares contain at most 100 cards
   and expire 30 days after creation. Product copy must disclose the current client's
   silent truncation of larger categories.

## 2. Firestore Rules deployment gate

The one-time reservation migration is complete and its deployment workflow has been
retired. Rules promotion now accepts only a sealed release candidate produced by the
`Build release candidate` workflow. Provide that run ID, full revision, candidate
SHA-256, operation and approval reference. The workflow verifies the source run,
revision and artifact digest before approval, then verifies the protected project and
database binding again before deploying only Firestore Rules (never indexes).

For rollback, select a retained last-known-good release candidate and use `operation:
rollback`. Do not rebuild the revision or upload database snapshots to Actions. Data
repair is a separate incident procedure and must not be coupled to a Rules deployment.

## 3. Candidate-bound staging deploy and smoke — BLOCKED

**Current status: BLOCKED.** The repository has no candidate-bound protected staging
deploy mechanism. `deploy-production.yml` targets the protected production
environments only; do not point it at staging. A manual Firebase/Hosting deploy is
not an acceptable substitute.

Unblock this section only when a protected staging mechanism exists and has been
reviewed/tested to:

1. accept the candidate tuple and `candidate_run_id`, download the artifact from that
   exact successful `release-candidate.yml` run, and never use a mutable/latest build;
2. verify the successful source run's workflow path, conclusion and head SHA, plus
   the sealed `release-candidate-manifest.json` fields (`workflowRunId` equal to
   `candidate_run_id`, full `revision`, and `candidateSha256`), every component
   digest and readiness using the existing `scripts/release-artifact.mjs verify`
   contract, and the protected staging project/database target;
3. deploy those sealed bytes without rebuild or build/predeploy hooks; and
4. emit an immutable deployment receipt binding the candidate run ID, revision,
   candidate SHA-256, manifest/readiness, protected target and HTTPS origin.

Until that mechanism and receipt exist, do not run or accept the smoke below, do not
promote a candidate, and do not record staging evidence. The browser/manual evidence
must bind to the immutable deployment receipt as well as the candidate tuple; an
origin-only or manually deployed result is not evidence.

When the protected staging path is available, run the automated probe against the
receipt's HTTPS origin:

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

`npm run phase6:smoke` is only an automated HTTPS/network probe. It checks the
application document, `/health.json` revision and status, required page security
headers, and the selected release-manifest status/cache policy. It does not inspect
`/sw.js`, install or update a worker, close/reopen a browser, download a real pack,
or run the Listen journey. A passing JSON result is necessary but never sufficient
staging evidence.

The following browser/manual HTTPS checklist is also required on the same approved
receipt origin, using the real authorized identity, exact candidate tuple and receipt:

1. Request `GET /sw.js` without following redirects. Require HTTP `200`, a JavaScript
   MIME (`application/javascript`, with an optional charset), and
   `Cache-Control` containing all three directives: `no-cache`, `no-store` and
   `must-revalidate`.
2. Request `GET /health.json` and verify HTTP `200` JSON with `revision` equal to the
   tuple's full revision. Parse the embedded descriptor in the served `/sw.js` and
   record its `revision` and `fingerprint`; verify the revision and sealed `sw.js`
   bytes match the candidate tuple/receipt. Inspect the active-marker response at
   `/__sonflash_app_shell_active__` and the versioned cache name
   `sonflash-app-shell-v1-<fingerprint>`; do not treat a network descriptor as proof
   that its worker is active, and do not accept an HTML-only match.
3. Before the B update, record the currently controlled A descriptor revision and
   fingerprint, its active `sonflash-app-shell-v1-<fingerprint>` cache, and the
   marker response that names that cache. After the receipt's B deployment, validate
   the network B `/sw.js` body and embedded descriptor against B's sealed manifest and
   receipt, but do not call B active yet. Then exercise the browser's native update:
   B must wait while the active study tab remains on A without a forced reload; only
   after all clients close and reopen normally may B become active. Verify the active
   cache name and marker now point to B's fingerprint and the active descriptor
   revision is B's `revision`.
4. Perform an offline cold reopen in that same browser profile after all clients
   close. Today/Library and already cached data must load; do not substitute a
   cache-only assertion for a real network-off/cold-start check.
5. Download one real pack from the reviewed/published Listen manifest over HTTPS,
   verify the UI reports completion only after the real clip bytes pass integrity,
   and play the downloaded clip after going offline. A fixture pack or fake
   transport is not evidence.
6. Run `Listen → answer → Save → Communicate` with the authorized account. Let the
   app resolve or create the real phrase/card identity during the journey, then
   verify the saved card remains that identity and the communication action follows
   the intended online/authenticated path. A fixture or synthetic ID, or absent
   published media, is a hard stop, not a skipped check.

Manually also verify App Check, sign-in/out, Firestore owner isolation, AI failure
fallback and image failure fallback. Record each automated and browser/manual result
as `pending`, `passed` or `failed`, bound to the same tuple, origin and timestamp.
Record aggregate evidence only; never include tokens, emails, UIDs, words,
translations or free-form errors. `e2e/offline-update.spec.ts` is a local fixture
preflight for worker lifecycle and cache retention, not staging or production proof.

## 4. Staged production promotion

Promotion is **BLOCKED** while section 3 lacks its reviewed candidate-bound staging
mechanism and immutable deployment receipt. This is a promotion gate, not a bar to
an incident-triggered rollback to a verified sealed recovery tuple.

Configure required reviewers for `production-hosting`, `production-functions` and
`production-rules-cutover`. Store the dedicated least-privilege deployment service
account JSON in each deployment environment. Configure both protected
`FIREBASE_PROJECT_ID` and `FIRESTORE_DATABASE_ID` in all three environments. The
candidate-build environment alone supplies the
public `VITE_FIREBASE_APP_CHECK_SITE_KEY`.

1. Decide target order from the recorded compatibility review. If Hosting calls a new,
   backward-compatible Function, dispatch `Deploy production artifact` with
   `promote_functions=true` so the protected Functions job completes before Hosting.
   Otherwise leave it false for a Hosting-only compatibility stage. The workflow
   verifies the source workflow's path/conclusion/head SHA, downloads that exact
   artifact, rehashes every sealed component and removes rebuild hooks from a derived
   deployment config before either protected deployment. Every input must come from
   one candidate tuple; do not rebuild after verification, staging observation or
   promotion, even when the revision is unchanged.
2. Run production smoke against the deployed revision with `EXPECTED_REVISION` bound
   to that same tuple's `revision` (the operator script retains the
   `STAGING_ORIGIN` variable name for this bounded probe). Require `/health.json`,
   the app-shell revision, `/sw.js` checks and the critical browser journey to match
   before calling the promotion successful. Observe App Check token metrics and
   protected-call success long enough for the authorized operator to rule out stale
   clients. Do not treat a successful artifact download as deployment evidence.
3. If a Hosting-first compatibility stage was required and the observation is accepted,
   dispatch the same candidate with `promote_functions=true` and a bounded
   `app_check_observation_ref`. Functions waits for separate `production-functions`
   approval and deploys only the sealed compiled Functions; the already-compatible
   Hosting artifact is then promoted idempotently. `ENFORCE_APP_CHECK` defaults to
   true. Never deploy incompatible Functions enforcement before its Hosting client.
4. Do not select or infer an all-target deploy. Firestore Rules use only the protected
   candidate-bound workflow in section 2.

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
For promotion, the source-artifact retrieval check must use the separately reviewed/tested
protected READ-ONLY mechanism described in section 1; it is not available in this
repository, so promotion remains **BLOCKED**. Do not dispatch `deploy-production.yml` to
test it. During an incident, an actual rollback may proceed only to an already
READ-ONLY-verified sealed tuple/receipt or a pre-verified, pre-sealed recovery candidate
through the protected rollback workflow; if no such artifact is available, hold and
mitigate forward. Rebuilding the same revision is not an artifact rollback. An archive
copy is not a substitute until a separate protected ingestion path is reviewed and
tested.

The retained LKG is rollback-eligible only if its sealed artifact can serve a valid
`/sw.js` endpoint (HTTP `200`, JavaScript MIME and `no-cache,no-store,must-revalidate`)
for clients that already control a worker. If the LKG predates service-worker support
or otherwise fails this check, stop and select a pre-verified, pre-sealed recovery
candidate with a valid worker. Never hot-patch `sw.js`, replace one file outside the
sealed candidate, or deploy a pre-worker revision alone to a controlled client.

### Controlled-client A→B→R rollback rehearsal

Run this rehearsal only after the candidate-bound staging receipt exists, on a browser
profile that already controls release A:

1. Before B is deployed, record A's embedded descriptor revision/fingerprint from the
   served `/sw.js`, the active cache name `sonflash-app-shell-v1-<fingerprint>`, and
   the `/__sonflash_app_shell_active__` marker response naming that cache. Also record
   aggregate before-state markers for the pending queue, IndexedDB/card data and
   downloaded offline media packs. Do not expose private content in the record.
2. After B's immutable staging receipt exists and before the worker update, validate
   the network B `/sw.js` body and embedded descriptor against B's sealed manifest and
   receipt. Do not call B active yet. Use the native worker update; B must wait while
   the active study tab remains on A without a forced reload.
3. Close all clients and reopen normally to activate B. Verify the active cache name
   and marker now point to B's fingerprint and the active descriptor revision is B's
   `revision`. Name the rollback target `R` and bind it to its independent tuple.
   Deploy R through the protected rollback path,
   validate the network R `/sw.js` body and embedded descriptor against R's sealed
   manifest/receipt before updating, and confirm R waits while B remains active.
4. Close all clients and reopen normally. Verify R's active cache name and marker,
   `/health.json` and embedded app-shell descriptor all bind to `R.revision`, and
   `/sw.js` remains valid. If R is A this is A→B→A; otherwise call it A→B→R and
   verify R, not A.
5. Compare the after-state markers. IndexedDB/card data and offline media packs must
   remain accessible with no data loss or deletion. Pending operations may remain
   pending or settle successfully; record the aggregate outcome, and never let them
   disappear through clearing or an untracked failure.

Never unregister the service worker, clear site data, delete IndexedDB, discard the
pending queue, or delete learner/card/media-pack storage to make this rehearsal pass.
Only the versioned shell namespace may be replaced by the normal worker lifecycle.

1. **Hosting:** stop promotion, dispatch `Deploy production artifact` with the retained
   last-known-good candidate and `promote_functions=false`, then verify `/health.json`,
   the valid `/sw.js` headers, app-shell revision, security headers and critical
   browser flows against the restored tuple revision.
2. **Functions:** only if the last-known-good Functions are compatible with current data
   and Rules, dispatch that same candidate with `promote_functions=true`, attach the
   incident/compatibility reference, obtain the separate Functions approval, and verify
   Auth/App Check/error/latency metrics. Otherwise hold and mitigate forward.
3. **Firestore Rules:** never use the normal deployment workflow. Dispatch the separate
   Rules workflow with `operation: rollback`, the retained last-known-good candidate run
   ID, revision and digest, then obtain protected approval.
4. **Data:** a Rules rollback does not mutate Firestore documents. Preserve current
   documents and handle any data repair as a separately authorized incident operation
   with fresh backups and explicit preconditions.
5. Re-run the automated probe and browser/manual checklist with `EXPECTED_REVISION`
   bound to the rollback tuple, record the incident correlation ID and aggregate
   thresholds, and keep private learning content out of logs and tickets.

## 7. Execution status and remaining dependencies

**Status: BLOCKED.** This edit documents the release procedure only. No staging deploy,
promotion, production smoke, rollback action or A→B→R rollback rehearsal was executed;
all external evidence is therefore still `PENDING`. Release remains blocked by these
platform gaps:

- no reviewed/tested protected candidate-bound staging mechanism currently exists to
  download by `candidate_run_id`, verify provenance/manifest/revision/run/digest and
  protected target, deploy without rebuild, and emit the immutable receipt required by
  section 3;
- no reviewed/tested protected READ-ONLY retrieval/verification mechanism exists to
  validate source-run provenance, download by `candidate_run_id`, run the existing
  release-artifact verifier, emit bounded evidence, and remain unable to reach
  deployment jobs or credentials. The current `deploy-production.yml` path is not a
  dry mode and must never be dispatched just to test rollback retrieval;
- the current rollback path consumes only the 14-day source Actions artifact, so
  retrievability for the full planned rollback window is not established. No separate
  protected archive-ingestion path exists; an archive copy is backup evidence only and
  cannot be manually extracted or deployed.

Before release, obtain T15 acceptance, reviewed/published Listen media and
publication/rights evidence, an approved real identity, an approved HTTPS staging
origin, a successful sealed candidate tuple, a source-retrievable compatible LKG or
pre-verified/pre-sealed recovery candidate, the immutable staging receipt, and the
protected workflow approvals and credentials.
