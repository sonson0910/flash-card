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

   The build accepts only the exact full source digest, the singular protected
   reviewer identity, and an approval timestamp no more than 24 hours old (with
   only a small bounded future skew). Never accept reviewer authority from
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
`FIREBASE_PROJECT_ID` and `FIRESTORE_DATABASE_ID` in all three environments. The
candidate-build environment alone supplies the
public `VITE_FIREBASE_APP_CHECK_SITE_KEY`.

1. Decide target order from the recorded compatibility review. If Hosting calls a new,
   backward-compatible Function, dispatch `Deploy production artifact` with
   `promote_functions=true` so the protected Functions job completes before Hosting.
   Otherwise leave it false for a Hosting-only compatibility stage. The workflow
   verifies the source workflow's path/conclusion/head SHA, downloads that exact
   artifact, rehashes every sealed component and removes rebuild hooks from a derived
   deployment config before either protected deployment.
2. Run production smoke against the deployed revision. Observe App Check token metrics
   and protected-call success long enough for the authorized operator to rule out stale
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
If that exact candidate is no longer retrievable, stop; rebuilding the same revision is
not an artifact rollback.

1. **Hosting:** stop promotion, dispatch `Deploy production artifact` with the retained
   last-known-good candidate and `promote_functions=false`, then verify `/health.json`,
   security headers and critical browser flows against the restored revision.
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
5. Re-run smoke, record the incident correlation ID and aggregate thresholds, and keep
   private learning content out of logs and tickets.
