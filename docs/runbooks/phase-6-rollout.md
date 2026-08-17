# Phase 6 release and rollback runbook

This runbook is deliberately human-gated. No local command deploys, changes
traffic, publishes draft content, or mutates production data. Workflow
configuration is not evidence that staging, migration, deployment or rollback ran.

## 1. Build, seal and retain one candidate

1. Dispatch `Build release candidate` from `main` with the reviewed full commit
   revision in its required `revision` input. Before protected environment access,
   an unprotected job requires that input to equal the workflow trigger SHA, checks
   out the exact revision with full history, fetches current `origin/main`, verifies
   exact `HEAD` equality and ancestry, and requires a clean tracked/untracked tree.
   The protected build independently repeats those checks before dependency install,
   then uses Node 22 and Java 21, performs clean root/Functions installs, checks
   production release configuration, and runs the complete repository verification
   against one build. It must not rebuild after browser, secret or bundle gates.
   Verified readiness evidence is emitted only when that same input revision exactly
   matches a clean Git HEAD; a missing/mismatched revision or dirty worktree aborts
   before the evidence file is written. The resulting manifest is schema 2;
   fix-bearing Rules workflows reject schema-1 and `"local"` artifacts.
   Source-trust invariant: every production/Rules checkout fetches a fresh
   `origin/main` and verifies exact `HEAD` equality plus ancestry before repository
   scripts, provenance checks, or cloud authentication.
2. The final step seals `dist`, compiled Functions, Firestore Rules/indexes,
   `firebase.json`, readiness evidence, and the reviewed
   `evidence-attestation-trust-root.json`. Retain together:
   - candidate workflow run ID and exact successful run attempt;
   - full 40/64-character revision;
   - candidate SHA-256 from the workflow summary;
   - `artifacts/release-candidate-manifest.json`, readiness JSON, and the exact
     trust-root-bearing candidate artifact.
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

## 2. Compatibility bridge, strict fence, migration and final confirmation

The order is mandatory and uses one schema-2 candidate throughout:

```text
sealed candidate
→ temporary compatibility Rules
→ compatible Hosting and Functions
→ strict mutation fence
→ owner-scoped migration
→ evidence-bound strict Rules confirmation
```

1. Dispatch `Repair production legacy libraries` only as a `dry-run`, with the full
   immutable `revision`, explicit `owner_id`, and matching 12-character SHA-256
   `owner_key`. It runs only from `main`, checks out that exact revision, proves it is an
   ancestor of current `origin/main` before Google authentication, and uses
   `production-rules-cutover`; it cannot accept apply, rollback, or confirmation input.
   Use its aggregate only to confirm the selected owner and library count.
2. Dispatch `Deploy preparatory Firestore compatibility Rules` with the same candidate
   run ID/attempt, revision, candidate digest, sealed `firestore.compatibility.rules`
   digest, and reviewed approval reference. Its unprotected job verifies the exact
   source attempt and candidate provenance before
   the protected environment is entered; the protected job repeats those checks and
   deploys only the sealed compatibility Rules. It must then use short-lived read access
   to resolve the exact named-database Rules Release, hash its active Ruleset source, and
   reject a Release pointer change. Retain
   `firestore-compatibility-evidence-<run-id>-<attempt>` only after that read-back succeeds.
   This one-way bridge permits only owners whose state is still the exact legacy two-field
   shape to continue legacy writes. It never removes or weakens a generation fence that an
   owner already acquired. Patch and XP receipt controls remain identical to canonical
   strict Rules. A patch receipt is accepted only when the same atomic request follows the
   card next-revision contract (missing legacy revision to `1`, otherwise `N` to `N + 1`)
   and records that result; receipt reconciliation also advances the card revision. The
   legacy-state exception cannot authorize a receipt-only write.
3. Deploy and observe the same compatible Hosting and Functions candidate through
   `Deploy production artifact`. Supply the exact successful compatibility workflow run ID and
   attempt from step 2. Before either protected runtime environment is entered, the unprotected
   job verifies that exact compatibility workflow source, revision, attempt, required deploy and
   record jobs, provider-verified evidence envelope, candidate identity, and sealed compatibility
   Rules digest. Both protected jobs independently bind that retained envelope to their protected
   Firebase project and Firestore database before authentication. A missing, failed, retried,
   provider-unverified, differently targeted, or differently bound compatibility run blocks
   runtime promotion. The Functions job must then use short-lived OAuth read access to verify the
   live Hosting channel, exact release message, finalized version, public health revision, all six
   active Gen 2 Functions, and every concrete Cloud Run revision receiving observed traffic. Each
   serving revision must carry the complete split revision and candidate labels, and mutable
   Hosting/Cloud Run state must remain identical across the verifier's double-read. Retain the
   exact successful run ID/attempt and its
   `production-deployment-evidence-<run-id>-<attempt>` artifact only after that read-back
   succeeds. Hosting-only or provider-unverified promotion is insufficient for the next step.
4. Before any migration write, dispatch `Deploy strict Firestore mutation fence` with
   the same candidate, the sealed canonical `firestore.rules` digest, and that compatible
   runtime deployment evidence. The workflow verifies the exact successful Hosting,
   Functions, and evidence jobs before protected approval, then deploys only canonical
   strict Rules. Its enforcement evidence is emitted only after a GET-only named-database
   Rules read-back matches that sealed source and confirms the Release pointer stayed
   stable. It intentionally accepts no migration evidence: its purpose is to close the
   legacy write window before the Admin operator mutates data.
5. `Execute and attest reservation migration` is the sole apply/rollback route. During
   an approved write-freeze window, dispatch it from that same revision with the same
   owner ID/key, its selected `mode`, and the matching operation (`apply` + `cutover`, or
   `rollback` + `rollback`). Dry-run remains available without write authorization and
   never emits a Rules confirmation artifact. Apply and rollback both run while strict
   generation enforcement remains active.
6. Before an apply or rollback mutation, archive the encrypted rollback snapshot as an
   immutable generation-qualified GCS object. Configure its small exact descriptor through
   `ROLLBACK_SNAPSHOT_OBJECT_DESCRIPTOR_B64` and protect the allowed bucket/prefix with
   `ROLLBACK_SNAPSHOT_OBJECT_BUCKET` and `ROLLBACK_SNAPSHOT_OBJECT_PREFIX`; never transport
   snapshot bytes through a GitHub secret. Configure fresh, externally signed
   `MIGRATION_AUTHORIZATION_EVIDENCE_B64` and
   `MIGRATION_AUTHORIZATION_ATTESTATION_B64`. The schema-2 authorization binds the exact
   revision, workflow run ID/attempt, owner commitment, production project/database,
   canonical strict Rules digest, migration mode/operation, immutable object
   bucket/name/generation/size/digest, protected rollback key, write freeze, and the
   100-source automatic rollback cap. The workflow must run at the dispatched current-main
   revision, verifies the reviewed trust root and signed canonical
   `{domain,schemaVersion,payload}` envelope, downloads only the signed object generation,
   and verifies its metadata, size, and digest before the Admin operator can write. A
   different run or retry attempt cannot resume the persisted Admin migration without a
   separately designed signed continuation protocol.
7. Only after that gate passes, the bounded operator can select and materialize one
   `createWordCardId(normalizedWord)` primary per identity, merge learning progress,
   tombstone/quarantine losers without deleting rollback evidence, and verify every owner
   has at most one card per normalized identity. Automatic rollback source backups are
   capped at 100; any operation that would exceed the cap is rejected before writes.
   Apply plan idempotency binds the applied epoch/generation and source IDs. It then
   backfills `card_reservations/{lowercase full SHA-256(normalizedWord)}` with exact
   `{ schemaVersion: 1, cardId, normalizedWord }` payloads.
8. After the operator succeeds, the first job publishes its GitHub run ID, mutation-job
   attempt, millisecond-precision UTC completion timestamp, and rollback ciphertext digest
   in the run summary and immutable job outputs. Do not approve the `attest_final_state` job
   yet. An external verifier must inspect the post-mutation production state, create fresh
   `rules-cutover-evidence.json`, and sign a schema-4 final attestation whose canonical
   envelope binds those exact run, mutation attempt, time, mode, owner, target, revision,
   evidence, immutable rollback object, ciphertext, rollback-key, and trust-root values.
   Update `FINAL_RULES_CUTOVER_EVIDENCE_B64` and
   `FINAL_MIGRATION_EVIDENCE_ATTESTATION_B64`, then approve the second protected job. If only
   that second job is retried, it must keep the successful mutation job's original attempt;
   the Rules workflow verifies that the attested attempt contains a successful `migrate` job
   instead of substituting the workflow run's latest retry attempt.
9. The final job re-checks revision ancestry and the reviewed trust root, re-downloads the
   same immutable object generation used by the authorization, verifies metadata, size,
   digest, and external signature, and requires evidence `verifiedAt` to be strictly later
   than migration completion. The bounded evidence must report zero duplicate/invalid
   identities, zero missing/mismatched reservations, equal canonical/reservation counts,
   confirmed write freeze, and confirmed final delta verification. Only then does the
   workflow emit
   `reservation-migration-evidence-<revision>-<workflow-run-id>-<final-evidence-run-attempt>`
   with the final evidence, immutable object descriptor, and schema-4 attestation. Retain
   both the mutation-job attempt carried inside the attestation and the distinct workflow
   attempt that produced this artifact; the Rules consumer verifies both. Ciphertext bytes,
   plaintext, and
   KMS private material are never Actions artifacts or secrets.
10. `Deploy production Firestore Rules cutover` is the final evidence-bound confirmation,
    not the first strict cutover. It accepts only that successful migration workflow run,
    exact final-evidence SHA-256, matching full owner commitment, approval reference, and
    the exact compatible runtime deployment run ID/attempt. Before protected approval it
    verifies that `deploy_hosting`, `deploy_functions`, and `record_deployment` all
    succeeded and that the retained deployment envelope binds the same candidate. Its
    protected job re-verifies every candidate, target, trust-root, KMS, signature,
    migration, completion-time, and rollback-object binding before redeploying only the
    sealed canonical strict Rules (never indexes). The job succeeds only after a GET-only
    read-back resolves the exact named-database Release, retrieves its immutable Ruleset,
    hashes the single UTF-8 source file to the sealed candidate digest, and confirms the
    Release did not switch during verification. For `operation: rollback`, this confirms
    a completed data rollback while keeping strict enforcement; it does not restore the
    temporary compatibility bridge.

## 3. Authorized staging smoke

Deploy the exact sealed candidate to an approved HTTPS staging environment. Then run:

```sh
STAGING_ORIGIN=https://staging.example.test \
EXPECTED_REVISION=<full-immutable-commit-sha> \
CATALOG_MANIFEST_PATH=/catalog/english-core/release-manifest.json npm run phase6:smoke
```

To retain a bounded machine-readable envelope without changing the decision printed to
stdout, also set `RELEASE_REVISION`, `CANDIDATE_SHA256`, and a privacy-safe non-URL
`EVIDENCE_SOURCE_REF`, then append `-- --evidence-output <local-path>`. The schema-1
file contains only candidate bindings, aggregate status/probe counts, allowlisted reason
codes, and the deterministic result; it does not retain the staging origin or headers.

The operator requires a canonical credential-free HTTPS origin with no path, query, or
fragment. It rejects redirects, a non-2xx or non-HTML application document, revision
mismatch, non-JSON, malformed, oversized, encoded, or unhealthy bounded health metadata,
missing CSP/nosniff/referrer headers, a missing, oversized, encoded, non-JSON or
schema-invalid catalog manifest, and a release manifest whose `Cache-Control` lacks
`no-cache`, `no-store` or `must-revalidate`. Every response stream is cancelled or fully
consumed under one request timeout. An SPA fallback must never satisfy the manifest probe.
Mutable manifest pointers must never be `immutable`; reserve
`public, max-age=31536000, immutable` for hashed content assets.

Manually verify App Check, sign-in/out, Firestore owner isolation, AI failure fallback
and image failure fallback. Record aggregate evidence without tokens, emails, UIDs,
words, translations or free-form errors. A local fake transport is not staging proof.

## 4. Staged production promotion

Configure required reviewers for `production-hosting`, `production-functions` and
`production-rules-cutover`. Store the dedicated least-privilege deployment service
account JSON in each deployment environment. Configure both protected
`FIREBASE_PROJECT_ID` and `FIRESTORE_DATABASE_ID` in all three environments, plus the exact
protected `FIREBASE_HOSTING_SITE_ID` in `production-functions` for post-deploy runtime
read-back. The candidate-build environment alone supplies the public
`VITE_FIREBASE_APP_CHECK_SITE_KEY`.

Grant the production runtime principal only the additional read-back roles it needs:
`roles/firebasehosting.viewer`, `roles/cloudfunctions.viewer`, and `roles/run.viewer`. Grant
the Rules-cutover principal `roles/firebaserules.viewer`. These are in addition to existing
narrow deployment permissions; do not substitute project Editor/Owner. The verifier receives
a short-lived access token from `google-github-actions/auth`, performs only bounded GETs, and
must not print the token or raw provider responses. Missing site ID, API availability, or
viewer IAM keeps the release on HOLD.

### Evidence-attestation trust-root setup

1. Outside GitHub Actions, an authorized operator selects one exact immutable asymmetric
   KMS CryptoKeyVersion; no local code selects or infers it. In an authorized read-only
   context, capture immutable metadata and public identity without exporting private material:

   ```sh
   gcloud kms keys versions describe <version-id> \
     --project=<project> --location=<location> --keyring=<keyring> --key=<key> \
     --format='json(name,algorithm)'
   gcloud kms keys versions get-public-key "$KEY_VERSION" --output-file=attestation-public-key.pem
   openssl pkey -pubin -in attestation-public-key.pem -outform DER | sha256sum
   ```

   Accept only `EC_SIGN_P256_SHA256` or `RSA_SIGN_PKCS1_{2048,3072,4096}_SHA256` and
   use the lowercase SHA-256 of DER SubjectPublicKeyInfo, never a PEM-text digest.
2. Submit a reviewed change replacing all three `UNCONFIGURED` values in
   `evidence-attestation-trust-root.json` with the exact resource, allowed algorithm,
   and fingerprint. `UNCONFIGURED` deliberately blocks candidate sealing, reservation
   evidence, and Rules deployment; unit tests use synthetic configured roots only. Until
   reviewed operator setup replaces it, release status is HOLD, not failed implementation.
3. Set protected non-secret `EVIDENCE_ATTESTATION_KMS_KEY_VERSION` to the same exact
   reviewed resource. It is an assertion/convenience, never signer authority: workflows
   fetch `name`/`algorithm` and the public key for the reviewed immutable version, compare
   all values and canonical fingerprint to the sealed root, then compare the signed payload.
   A mismatch, unavailable key, alternate valid key, or unsupported algorithm is a hold;
   never select a fallback key.
4. Configure separate external attestation inputs: schema-2
   `MIGRATION_AUTHORIZATION_ATTESTATION_B64` before a write, and schema-3
   `FINAL_MIGRATION_EVIDENCE_ATTESTATION_B64` only after the migration run publishes its
   completion boundary. The external signer independently verifies the reviewed root and
   signs canonical `{domain,schemaVersion,payload}` bytes; `signatureBase64` remains
   outside the signed object. EC P-256/SHA-256 verifies with
   `openssl dgst -sha256 -verify`; RSA PKCS#1/SHA-256 adds
   `-sigopt rsa_padding_mode:pkcs1`. GitHub Actions must remain verify-only: no signing
   command, signer secret, or signing IAM.
5. Configure a protected immutable GCS rollback archive and least-privilege read access for
   the reservation-migration and Rules-cutover principals. Set the exact bucket and allowed
   prefix in `ROLLBACK_SNAPSHOT_OBJECT_BUCKET` and `ROLLBACK_SNAPSHOT_OBJECT_PREFIX`. The
   externally prepared schema-1 descriptor must contain only `provider: gcs`, bucket, object
   name, immutable generation, byte length, and lowercase ciphertext SHA-256. Encode only
   that descriptor in `ROLLBACK_SNAPSHOT_OBJECT_DESCRIPTOR_B64`; object bytes remain in GCS.
   Object retention/versioning policy and the descriptor generation must make replacement or
   deletion impossible throughout the rollback window.
6. Configure the `production-rules-cutover` deployment-branch policy for `main` only and
   reject tags. The workflow separately asserts `refs/heads/main` and proves the exact
   checkout is an ancestor of current `origin/main`; this policy prevents an older workflow
   definition from bypassing the candidate schema, final-attestation, and root guards.
7. Before approval, run IAM Policy Troubleshooter for every effective reservation-migration
   and Rules-cutover Actions principal, the exact CryptoKeyVersion, and
   `cloudkms.cryptoKeyVersions.useToSign`. Retain immutable evidence of principal,
   resource, permission, policy revision, result, and timestamp. Inherited organization,
   folder, project, group, and custom-role grants must resolve to not granted; YAML review
   alone is not IAM proof.
8. Build a new schema-2 candidate from the configured reviewed revision and retain its run,
   revision, digest, and trust-root-bearing artifact. Schema-1 candidates and final
   attestations older than schema 3 are incompatible with the fix-bearing Rules path and
   must be rebuilt or regenerated.

### Key rotation, revocation, and rollback hold

Rotation requires a new immutable key version, allowed algorithm, DER-SPKI fingerprint,
reviewed root commit, schema-2 candidate, fresh schema-2 authorization and schema-3 final
attestations, aligned protected variable/IAM proof, and new approval. Never rotate by
changing a GitHub variable or secret
alone. On compromise, hold both evidence/Rules workflows, revoke or disable signer authority
outside Actions, land a reviewed new root, and rebuild the candidate/evidence chain. Retain
old public versions only for historic verification as policy requires; an old candidate cannot
adopt a new root.

1. Dispatch `Deploy preparatory Firestore compatibility Rules` for the retained candidate
   as described in section 2. Retain its successful run and reviewed approval reference.
   Do not deploy a compatible client first while the previous schema-locked Rules can still
   deny its generation-participating transactions.
2. Dispatch `Deploy production artifact` with the retained candidate run ID, revision
   and candidate SHA-256, leaving `promote_functions=false`. Before validation or either
   protected deployment job runs repository scripts or cloud authentication, it proves
   each exact checkout is an ancestor of current `origin/main`. It then verifies the source
   workflow's path/conclusion/head SHA, downloads that exact artifact, rehashes every sealed
   component, removes rebuild hooks from a derived deployment config, and deploys only
   Hosting after `production-hosting` approval.
3. Run production smoke against the deployed revision. Observe App Check token metrics
   and protected-call success long enough for the authorized operator to rule out stale
   clients. Do not treat a successful artifact download as deployment evidence.
4. If the observation is accepted, dispatch the same candidate with
   `promote_functions=true` and a bounded `app_check_observation_ref`. Hosting remains
   the first idempotent stage; Functions then waits for separate
   `production-functions` approval and deploys only the sealed compiled Functions.
   `ENFORCE_APP_CHECK` defaults to true. Never deploy Functions enforcement before the
   compatible Hosting client is observed. After deployment, the workflow reconstructs the
   full immutable identifiers from split provider labels (Cloud labels are limited to 63
   characters), verifies observed Cloud Run `trafficStatuses` totals exactly 100%, and rejects
   reconciliation, failed terminal state, latest-only/unresolved traffic, mismatched labels,
   missing expected Functions, or state that changes during verification. After both protected
   jobs and provider read-back succeed, retain the exact workflow run ID and attempt plus its
   `production-deployment-evidence-<run-id>-<attempt>` artifact; the final job emits it only
   when Hosting and Functions used the same candidate and protected target.
5. Supply that exact deployment run ID/attempt to `Deploy strict Firestore mutation
   fence`. It rejects skipped Functions promotion, a different workflow/revision/candidate,
   failed jobs, or a target that does not match the Rules environment. After protected
   approval, it deploys only the sealed canonical strict Rules. Do not begin apply or
   rollback migration while the temporary compatibility bridge is active.
6. Run the owner migration and final evidence flow in section 2. Supply the same deployment
   run ID/attempt and resulting migration evidence to `Deploy production Firestore Rules
   cutover`; that workflow confirms the post-migration state by redeploying the same strict
   Rules. Do not select or infer an all-target deploy: the normal production workflow never
   deploys Firestore Rules.

## 5. Canary decision (advisory only)

Collect a fresh JSON object with exactly these seven numeric fields:
`sampleSize`, `errorRate`, `p95Ms`, `ageMs`, `syncLossRate`, `quotaUsageRate` and
`costRate`. Unknown/non-numeric/negative fields or a fractional sample size are invalid;
missing fields hold and can never promote. Run:

```sh
npm run phase6:canary -- ./canary-evidence.json
```

Optional retained evidence additionally requires `RELEASE_REVISION`,
`CANDIDATE_SHA256`, `EVIDENCE_SOURCE_REF`, `CANARY_WINDOW_STARTED_AT`, and
`CANARY_WINDOW_ENDED_AT`; append `--evidence-output <local-path>` after the input file.
The operator rejects unknown metrics, malformed UTC windows, URLs/free-form source
references, unknown fields, oversized evidence, and non-immutable candidate bindings.

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
3. **Migrated data:** freeze writes and keep canonical strict Rules active. Do not delete
   v2 source records. Automatic rollback is capped at 100 source backups and rejects
   above-cap snapshots before writes. Decrypt only inside the authorized private operator
   environment; never expose the key or plaintext through Actions. One Firestore transaction
   must recheck owner state, backup root, source/card guards, and exact post-apply tombstone
   data before restoring cards, reservations, tombstones, progress and facets. Apply
   snapshot rollback only when owner, document ID, fingerprint, revision and
   epoch/generation preconditions still match. A generation restart updates the root
   epoch/generation and invalidates automatic rollback. Preserve newer/current documents
   and quarantine conflicts for manual review. Never lower Rules before this transaction;
   doing so would reopen the legacy write race during recovery.
4. **Firestore Rules confirmation:** after the data rollback, an external verifier must
   produce fresh `operation: rollback`, `status: rollback-ready` evidence bound to the
   canonical strict Rules digest and exact retained immutable rollback object generation.
   Run `Deploy production Firestore Rules cutover` only with a reviewed configured trust
   root, schema-2 candidate, fresh schema-2 pre-mutation rollback authorization, and fresh
   schema-3 post-rollback final attestation bound to the exact workflow run ID/attempt and
   completion timestamp. The workflow redeploys strict Rules; it does not deploy
   `firestore.compatibility.rules`. Never reuse schema-1, prior-run, or old-root evidence.
5. **Runtime compatibility:** do not roll Hosting or Functions back to a
   generation-unaware release for an owner that has been fenced. The temporary compatibility
   Rules only preserve exact unfenced two-field owner state; they cannot remove
   `mutationGeneration` or restore legacy writes for a fenced owner. Keep the compatible
   runtime and fix forward. Any broader legacy-runtime rollback requires a separate reviewed
   compatibility decision for still-unfenced owners and must not claim to unfence migrated
   owners.
6. Re-run smoke, record the incident correlation ID and aggregate thresholds, and keep
   private learning content out of logs and tickets.

## 7. Current validation status

As of 2026-08-16:

- PASS: `npm run verify:core`, including root TypeScript/Vitest, Functions lint/tests/build,
  and Java-backed Firestore Rules/emulator validation.
- PASS: separately executed production build, bundle and secret checks, dependency audits,
  Playwright (146 passed, 4 skipped), focused staging smoke/rollout evidence tests (87/87),
  `npm run test:phase6` (82/82), release contracts (70/70), and `git diff --check`.
- PASS: the reviewed trust root pins the exact enabled asymmetric KMS version, algorithm,
  and DER-SPKI fingerprint. The Actions deployer can read that version and public key but
  cannot sign evidence. The dedicated rollback KMS key and protected versioned GCS archive
  exist, and Actions has read/list-only object access.
- HOLD: the checkout is dirty and the configured trust-root file is not yet part of a clean,
  reviewed `main` revision. Verified release evidence therefore fails closed.
- HOLD: retained release-candidate run `31684115010` for HEAD
  `5a2e90dfbced5657110042973bfed199ff589745` has a schema-1 manifest and no sealed
  trust-root binding. It is incompatible with the fix-bearing Rules path; build a fresh
  schema-2 candidate only after the coherent changes land on clean reviewed `main`.
- PASS: Firestore TTL is active for both `shared_decks.expiresAt` and
  `shared_deck_owners.expiresAt`; this static control is not run-bound release evidence.
- HOLD: no real immutable rollback object descriptor, staging observation, migration
  authorization/final attestation, deployment evidence, or canary evidence exists yet.
  Missing external evidence must never be represented as a pass.
