# Phase 6 release and rollback runbook

This runbook is deliberately human-gated. No local command deploys, changes
traffic, publishes draft content, or mutates production data.

## 1. Build and retain evidence

1. Use Node 22 and Java 21, then run `npm ci` and `npm ci --prefix functions`.
2. Run `npm run verify`. A successful run creates
   `artifacts/phase6-readiness.json` for the immutable revision.
3. Retain the build, Playwright output and readiness JSON together. Never reuse
   evidence for another revision.
4. Confirm the content gate still blocks the draft AI-assisted pilot. Publishing
   requires source/rights evidence, independent review and matching digest.

## 2. Staging smoke (requires explicit authorization)

Deploy the exact retained artifact through the approved platform workflow. Then:

```sh
STAGING_ORIGIN=https://staging.example.test \
EXPECTED_REVISION=<immutable-commit-sha> \
CATALOG_MANIFEST_PATH=/catalog/manifest.json npm run phase6:smoke
```

The operator rejects non-HTTPS origins, redirects, revision mismatch, unhealthy
metadata, missing CSP/nosniff/referrer headers and non-immutable cache policy.
Manually verify App Check, sign-in/out, Firestore read/write isolation, AI failure
fallback and image failure fallback; record evidence without tokens, emails, UIDs,
words, translations or free-form errors.

## 3. Canary decision (never automatic)

Collect a fresh aggregate JSON sample with `sampleSize`, `errorRate`, `p95Ms`,
`ageMs`, `syncLossRate`, `quotaUsageRate` and `costRate`. Run:

```sh
npm run phase6:canary -- ./canary-evidence.json
```

- `promote`: all required evidence exists, sample ≥100, age ≤5 minutes, error
  rate ≤1%, p95 ≤2 seconds, zero sync loss, quota ≤90%, cost rate ≤100%.
- `hold`: evidence is missing, stale or undersized.
- `rollback`: any reliability, sync, quota or cost threshold is breached.

The result is advisory. A human with deployment authority performs promotion.

## 4. Rollback

1. Stop promotion and route traffic to the last known-good immutable artifact.
2. Do not delete v2 source records. Run migration rollback only from the retained
   rehearsal snapshot and only when owner, document ID, fingerprint, revision and
   epoch preconditions still match.
3. Preserve current/newer documents; quarantine conflicts for manual review.
4. Re-run smoke against the restored revision and record the incident correlation
   ID, aggregate thresholds and decision. Do not place private learning content in
   logs or tickets.
