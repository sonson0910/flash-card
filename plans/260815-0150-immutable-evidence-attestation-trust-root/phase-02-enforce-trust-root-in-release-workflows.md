---
phase: 2
title: "Enforce the trust root in release workflows"
status: completed
priority: P1
effort: "3h"
dependencies: [1]
---

# Phase 2: Enforce the Trust Root in Release Workflows

## Context Links

- Candidate checkout/build/seal/upload: `.github/workflows/release-candidate.yml:13-94`
- Producer revision verification and attestation verification: `.github/workflows/reservation-migration.yml:71-81`, `.github/workflows/reservation-migration.yml:109-161`
- Rules provenance/candidate acquisition: `.github/workflows/deploy-firestore-rules.yml:73-137`
- Protected Rules verification/deploy: `.github/workflows/deploy-firestore-rules.yml:139-218`
- Workflow contract tests: `scripts/release-workflows.test.mjs:6-142`
- Existing verify-only requirement: `.github/workflows/reservation-migration.yml:158-160`, `.github/workflows/deploy-firestore-rules.yml:201-203`

## Overview

Wire the sealed trust root through candidate retention, reservation-evidence production, and final Rules cutover. Keep `EVIDENCE_ATTESTATION_KMS_KEY_VERSION` as a mutable assertion only: exact reviewed resource, fetched KMS algorithm, and SPKI fingerprint must agree before signature acceptance.

## Key Insights

- Producer currently checks the requested checkout SHA before evidence work (`.github/workflows/reservation-migration.yml:71-81`) but later trusts the protected variable after only regex validation (`.github/workflows/reservation-migration.yml:118-130`).
- Deploy verifies candidate/evidence workflow path, event, conclusion, and head SHA (`.github/workflows/deploy-firestore-rules.yml:73-93`), yet the protected job again selects the public key solely from the mutable variable (`.github/workflows/deploy-firestore-rules.yml:176-203`).
- Current canonical signed payload is `jq -cS '.payload'` and has seven keys, excluding signer identity (`.github/workflows/reservation-migration.yml:142-160`, `.github/workflows/deploy-firestore-rules.yml:189-203`).
- Signature verification already precedes Rules evidence validation in both jobs (`.github/workflows/reservation-migration.yml:158-161`, `.github/workflows/deploy-firestore-rules.yml:201-205`); preserve that ordering and add trust checks before signature verification.
- Candidate workflow uploads only current deploy components and manifest (`.github/workflows/release-candidate.yml:78-94`); the new component file must be retained or downstream schema-2 verification fails.

## Requirements

### Functional

- Add `evidence-attestation-trust-root.json` to candidate artifact upload (`.github/workflows/release-candidate.yml:78-94`). `seal` from Phase 1 remains the sole manifest producer (`.github/workflows/release-candidate.yml:48-53`).
- Both workflows reject non-`refs/heads/main` dispatch refs before checkout; the runbook also requires the protected environment's deployment-branch policy to permit only `main`, preventing an older workflow definition from bypassing the guard.
- Producer loads the trust root from the requested reviewed revision after HEAD equality (`.github/workflows/reservation-migration.yml:75-81`), then verifies variable/KMS metadata/algorithm/key fingerprint immediately after Google auth and before the Admin migrator. A pre-fix revision lacks the required CLI and fails closed.
- Deploy requires `validated/candidate/artifacts/release-candidate-manifest.json` schema 2 directly in workflow shell before invoking the checked-out verifier, then loads the root only from verified `validated/candidate` bytes (`.github/workflows/deploy-firestore-rules.yml:119-126`, `.github/workflows/deploy-firestore-rules.yml:184`). Do not trust a copy from migration evidence.
- Both jobs:
  1. extract exact reviewed KMS resource, allowed algorithm, and fingerprint;
  2. require protected `EVIDENCE_ATTESTATION_KMS_KEY_VERSION` exact equality;
  3. fetch bounded version metadata (`name`, `algorithm`) and the public key for that immutable version;
  4. call Phase 1 CLI to validate config, metadata name/algorithm, and computed SPKI fingerprint;
  5. require attestation payload values equal the reviewed resource/algorithm/fingerprint;
  6. only then verify signature: EC P-256 uses `openssl dgst -sha256 -verify`; RSA PKCS#1 uses the same command with explicit `-sigopt rsa_padding_mode:pkcs1`; reject every other algorithm before migration/deploy.
- Bump external attestation envelope `schemaVersion` expectation from 1 to 2; keep exact envelope keys `payload`, `schemaVersion`, and `signatureBase64`. Exact canonical payload keys become:

```json
[
  "ciphertextSha256",
  "databaseId",
  "evidenceAttestationKmsAlgorithm",
  "evidenceAttestationKmsKeyVersion",
  "evidenceAttestationPublicKeySpkiSha256",
  "evidenceSha256",
  "ownerCommitment",
  "projectId",
  "revision",
  "rollbackKmsKeyVersion"
]
```

- The external signer signs exactly UTF-8 bytes emitted by `jq -cS '.payload'`, including the single trailing LF written to the payload file. GitHub never reconstructs a second payload shape.
- Preserve all existing evidence bindings and validation order (`.github/workflows/reservation-migration.yml:147-161`, `.github/workflows/deploy-firestore-rules.yml:194-205`).

### Non-functional

- `set -euo pipefail` in every modified multi-command verification step.
- No `gcloud kms asymmetric-sign`, signing credential, `id-token: write`, or signer secret added. Reservation migration retains only existing production data/migration authority plus public-key read; Rules cutover retains only existing Rules-deploy authority plus public-key read (`.github/workflows/reservation-migration.yml:95-97`, `.github/workflows/deploy-firestore-rules.yml:158-160`). Phase 3 must prove effective asymmetric-sign permission is not granted.
- No production values in workflow YAML/tests.
- Absorb and preserve the current uncommitted attestation precursor. `.github/workflows/deploy-firestore-rules.yml`, `scripts/release-workflows.test.mjs`, and the runbook already contain relevant precursor edits; `.github/workflows/reservation-migration.yml` is untracked and must be adopted as a created file. Never reset/checkout these files.

## Architecture and Data Flow

```text
Protected variable (untrusted assertion)
       │ exact equality
       ▼
Reviewed resource/algorithm ── gcloud describe/get-public-key ── metadata + PEM
       │                                                            │
       └──────── shared verifier: name/algorithm/SPKI match ─────────┘
                               │
                               ▼
External attestation payload fields == reviewed resource/algorithm/fingerprint
                               │
                               ▼
Signature verification → evidence/ciphertext/rollback/rules verification → artifact/deploy
```

### Producer Trace

`workflow_dispatch inputs` → require main workflow ref + validate owner/revision (`.github/workflows/reservation-migration.yml:48-69`) → checkout exact reviewed revision + HEAD check (`.github/workflows/reservation-migration.yml:71-81`) → Google auth + reviewed root/KMS metadata/algorithm/key preflight (`.github/workflows/reservation-migration.yml:95-97`) → Admin migration (`.github/workflows/reservation-migration.yml:87-107`) → decode untrusted evidence/attestation (`.github/workflows/reservation-migration.yml:109-146`) → compare signed signer identity/algorithm → verify signature → validate Rules evidence (`.github/workflows/reservation-migration.yml:147-161`) → upload bounded artifact (`.github/workflows/reservation-migration.yml:164-172`).

### Deploy Trace

`workflow_dispatch approval/candidate/evidence inputs` → require main workflow ref + validate/provenance (`.github/workflows/deploy-firestore-rules.yml:54-93`) → checkout requested revision + download artifacts (`.github/workflows/deploy-firestore-rules.yml:95-117`) → workflow-owned manifest schema-2 check → candidate verify (`.github/workflows/deploy-firestore-rules.yml:119-126`) → protected approval/job (`.github/workflows/deploy-firestore-rules.yml:139-160`) → schema-2/target reverify + trust-root/metadata/algorithm/key/payload/signature checks → Rules evidence verify + promoted config (`.github/workflows/deploy-firestore-rules.yml:162-205`) → Rules-only deploy (`.github/workflows/deploy-firestore-rules.yml:214-218`).

## Related Code Files

| Action | Absolute path | Change |
| --- | --- | --- |
| Modify | `/mnt/Projects/elly_code/flash-card/.github/workflows/release-candidate.yml` | Retain sealed trust-root file |
| Create/adopt | `/mnt/Projects/elly_code/flash-card/.github/workflows/reservation-migration.yml` | Preserve producer baseline; enforce ref/resource/algorithm/key/payload before migration |
| Modify | `/mnt/Projects/elly_code/flash-card/.github/workflows/deploy-firestore-rules.yml` | Direct schema guard; repeat resource/algorithm/key/payload enforcement |
| Modify | `/mnt/Projects/elly_code/flash-card/scripts/release-workflows.test.mjs` | Workflow contract and substitution regressions |
| No change | `/mnt/Projects/elly_code/flash-card/.github/workflows/deploy-production.yml` | Pre-fix Hosting/Functions revisions retain old verifier behavior; explicitly out of Rules-attestation scope |

## Implementation Steps

1. Candidate workflow: add trust-root JSON to upload list. Preserve one-build/no-rebuild contract (`.github/workflows/release-candidate.yml:31-53`, `.github/workflows/release-candidate.yml:78-94`).
2. Producer and deploy: fail before checkout unless `github.ref` is exactly `refs/heads/main`; require the protected `production-rules-cutover` environment deployment-branch policy to allow only `main` and reject tags in Phase 3.
3. Producer: after exact checkout/HEAD and auth, parse the reviewed full resource into project/location/keyring/key/version, require variable equality, run bounded `gcloud kms keys versions describe <version> --project/--location/--keyring/--key --format=json(name,algorithm)`, fetch PEM, and invoke `release-artifact.mjs verify-attestation-trust-root --root . ...` before the Admin migrator. Pre-fix revisions fail because the command/root contract is absent.
4. Producer: require envelope schema 2 and exact ten payload keys; compare signed `evidenceAttestationKmsKeyVersion`, `evidenceAttestationKmsAlgorithm`, and `evidenceAttestationPublicKeySpkiSha256` before `openssl`. Use an explicit algorithm case: EC P-256 SHA-256 default EC verify; RSA PKCS#1 SHA-256 with `rsa_padding_mode:pkcs1`; no default branch.
5. Deploy: after artifact download, use `jq -e '.schemaVersion == 2'` on the candidate manifest before both checked-out-script verifier calls; retain those calls before approval and in the protected job (`.github/workflows/deploy-firestore-rules.yml:119-126`, `.github/workflows/deploy-firestore-rules.yml:162-184`). Read the trust root only after candidate component verification.
6. Deploy: read reviewed fields only from `validated/candidate/evidence-attestation-trust-root.json`; repeat exact variable/metadata/key/payload checks and the identical explicit EC/RSA verification case before evidence validation. No unsupported/default algorithm or environment-only fallback.
7. Update `scripts/release-workflows.test.mjs` current assertions that lock in environment-only trust (`scripts/release-workflows.test.mjs:45-74`, `scripts/release-workflows.test.mjs:76-111`):
   - candidate uploads trust root;
   - both workflows reject non-main refs; deploy directly rejects schema 1 before checked-out verifier calls;
   - both reference the same root file and compare variable, fetched metadata name/algorithm, and SPKI fingerprint;
   - both invoke the verifier with correct root/metadata/public-key paths;
   - producer trust preflight occurs before Admin migration;
   - both expect attestation schema 2 and exact three new payload keys;
   - exact algorithm case/parameters are mirrored; trust checks occur before `openssl`, then evidence verification;
   - neither workflow contains `asymmetric-sign` or accepts algorithm/fingerprint from vars/secrets/inputs;
   - arbitrary valid-looking resource substitution is rejected by exact equality plus Phase 1 behavioral tests.
8. Preserve existing workflow assertions for provenance, project/database, rollback key, ciphertext/evidence digests, owner commitment, Rules-only deploy, and no local signing (`scripts/release-workflows.test.mjs:45-135`).

## Test Matrix

| Layer | Scenario | Expected |
| --- | --- | --- |
| Contract | Non-main workflow ref or schema-1 Rules candidate | Reject before protected verifier/deploy |
| Contract | Deploy omits direct schema-2 check before checked-out verifier | Test fails |
| Contract | Candidate upload omits trust root | Test fails |
| Contract | Producer or deploy reads only protected variable | Test fails |
| Contract | Alternate valid KMS resource lacks exact-equality check | Test fails |
| Contract | KMS metadata name/algorithm or fingerprint verifier missing | Test fails |
| Contract | Payload omits key version/algorithm/fingerprint | Test fails |
| Contract | Missing EC/RSA explicit case or unsupported-algorithm rejection | Test fails |
| Contract | Signature happens before trust checks | Test fails |
| Contract | Any `asymmetric-sign` appears in GitHub workflow | Test fails |
| Integration | Existing five candidate `verify` invocations | Remain present; no new arguments |

## Todo List

- [x] Upload the sealed trust-root component
- [x] Reject non-main workflow refs and schema-1 Rules candidates
- [x] Reject pre-fix producer/verifier contracts before protected side effects
- [x] Enforce reviewed resource/algorithm/fingerprint before producer migration
- [x] Enforce reviewed resource/algorithm/fingerprint in protected deploy
- [x] Bump attestation envelope/payload contract to schema 2
- [x] Preserve verify-before-evidence-before-deploy ordering
- [x] Update workflow contract tests
- [x] Run focused Vitest files

## Success Criteria

- [ ] Replacing only `EVIDENCE_ATTESTATION_KMS_KEY_VERSION` with another regex-valid resource exits before signature verification.
- [ ] Replacing variable + metadata + attestation + public key still exits because reviewed resource/algorithm/fingerprint differ.
- [ ] Producer and deploy use the same reviewed fields, exact KMS metadata algorithm, and canonical fingerprint definition; main-only policy/direct schema checks block pre-fix paths.
- [ ] Attestation payload authenticates its exact key version, supported signing algorithm, and public-key fingerprint.
- [ ] Workflow source adds no signing command, credential, `id-token: write`, or signing permission request; operator acceptance separately confirms neither Actions principal has asymmetric-sign IAM.
- [ ] Rules deployment remains after all trust/signature/evidence checks and remains `--only firestore:rules` (`.github/workflows/deploy-firestore-rules.yml:214-218`).

## Risk Assessment

| Risk | Likelihood × Impact | Mitigation |
| --- | --- | --- |
| Shell quoting/order accidentally verifies wrong bytes | Medium × High | Keep existing `jq -cS` file flow; exact order tests; `set -euo pipefail` |
| Producer and deploy drift into two trust contracts | Medium × High | Same root schema + shared CLI + mirrored contract assertions |
| Reviewed KMS algorithm mismatches OpenSSL mode | Medium × High | Exact metadata comparison + SHA-256 signing allowlist + incompatible-algorithm tests |
| Mutable variable changed during rotation | Medium × Medium | Exact revision root controls; mismatch holds until operator aligns variable |
| Public key unavailable/disabled | Low × High | Fail closed; no fallback key; operational hold documented |
| Old workflow/target revision bypasses cutover | Medium × High | Main-only environment/ref assertion + direct schema-2 check; missing fixed producer CLI fails before migration |
| Existing dirty workflow work overwritten | Medium × High | Adopt current precursor in place; inspect diff before/after; no reset/checkout |

## Security Considerations

- Signed key metadata alone is insufficient; attacker-selected key could sign metadata naming itself. Acceptance requires comparison to reviewed sealed values before signature verification.
- Algorithm must come from fetched immutable KMS metadata and fingerprint from fetched key bytes; neither may come from attestation or GitHub config.
- Retaining the variable is operational convenience only. Removing it later is optional and out of scope; current fix makes substitution non-authoritative.
- GitHub principals may read public keys and deploy after approval but must not obtain asymmetric-sign permission.

## Rollback Plan

Hold both `reservation-migration.yml` and `deploy-firestore-rules.yml` dispatches before rollback. Revert Phase 2 workflow/test changes together; do not run schema-2 evidence through schema-1 workflows. Then, only if explicitly accepting reopened task #15, revert Phase 1. Existing generated schema-2 candidate/evidence artifacts must not be relabeled or downgraded.

## Next Steps

Phase 3 documents the exact operator provisioning, canonical payload, rotation, compatibility cutover, and validation gates. Do not proceed until Phase 1 + Phase 2 focused tests pass.
