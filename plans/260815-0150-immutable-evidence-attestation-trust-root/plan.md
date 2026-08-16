---
title: "Seal the evidence attestation trust root"
description: "Pin external KMS attestation identity to reviewed release revisions and reject mutable-key substitution."
status: partial
priority: P1
effort: 7.5h
branch: main
tags: [security, infra, release, kms]
blockedBy: []
blocks: []
created: 2026-08-15
---

# Seal the Evidence Attestation Trust Root

## Overview

Current producer and Rules-deploy jobs accept a syntactically valid `EVIDENCE_ATTESTATION_KMS_KEY_VERSION` from a mutable protected variable, fetch that key, then verify a payload that does not name the attestation key or fingerprint (`.github/workflows/reservation-migration.yml:109-161`, `.github/workflows/deploy-firestore-rules.yml:162-204`). An actor able to replace the variable and matching attestation can therefore move the trust root without a reviewed revision.

Smallest coherent fix: one reviewed root-level JSON trust-root file, sealed into release-candidate manifest schema 2, plus one reusable verifier in the existing artifact script. Keep the variable only as an assertion; require exact sealed resource, fetched immutable KMS signing algorithm, and canonical SPKI SHA-256. Main-only execution plus direct schema-2 checks blocks pre-cutover workflow refs/candidates. GitHub remains verify-only.

## Trust Model

- Trusted: reviewed immutable Git commit, protected main workflow provenance, candidate digest, sealed trust-root bytes, external signer private-key authority, retained effective-IAM denial evidence.
- Untrusted/mutable: GitHub variables, attestation/ciphertext/evidence secrets, workflow inputs, downloaded artifacts until verified.
- Constraint: GitHub remains verify-only, no signing; no production access/config assumptions; production key values are intentionally unknown in this local environment. All five `inputs.revision` checkout jobs in production/Rules workflows verify exact `HEAD` equality and ancestry in a fresh `origin/main` before scripts, provenance, or cloud authentication.
- Security invariant: changing a GitHub variable/secret alone cannot change accepted signing authority; trust-root rotation requires a reviewed revision, new schema-2 candidate, matching external attestation, and protected approval.
- Fail closed in fix-bearing producer/Rules workflows: placeholder, schema-1 candidate/attestation, non-main ref, KMS name/algorithm/key mismatch, malformed key, payload/signature failure, or unavailable metadata/key blocks publication/Rules deploy; missing IAM denial evidence blocks operator approval. `UNCONFIGURED` remains intentional until reviewed operator setup, so release is HOLD, not failed implementation.

## Data Flow

1. Reviewed revision contains `evidence-attestation-trust-root.json` with exact KMS version + supported signing algorithm + lowercase SHA-256 of DER SPKI.
2. Candidate seal validates non-placeholder config, includes its digest in manifest schema 2, then emits candidate SHA-256.
3. Producer checks out the requested reviewed revision; before migration its fixed workflow compares variable, fetched KMS metadata, and public-key fingerprint, and the signed payload repeats all three trust fields.
4. Rules deploy directly requires schema 2 before the checked-out verifier, repeats metadata/key/payload checks against candidate bytes, then validates evidence and deploys Rules only.

## Scope

- In: adopt the current uncommitted external-attestation chain as baseline; trust-root config/schema; candidate sealing; producer/Rules-deploy verification; substitution tests; operator setup/rotation docs.
- Out: production key selection, secret updates, auth, workflow dispatch, signing, deployment, migration execution, Hosting/Functions control-plane hardening, unrelated release refactors.

## Phases

| Phase | Name | Status | Effort | Depends on |
| --- | --- | --- | --- | --- |
| 1 | [Seal and validate the reviewed trust root](./phase-01-seal-and-validate-reviewed-trust-root.md) | Completed | 3h | — |
| 2 | [Enforce the trust root in release workflows](./phase-02-enforce-trust-root-in-release-workflows.md) | Completed | 3h | Phase 1 |
| 3 | [Document setup, rotation, and acceptance](./phase-03-document-setup-rotation-and-acceptance.md) | Completed; `verify:core` blocked locally (Java unavailable) | 1.5h | Phase 2 |

## Dependency Graph

`Current uncommitted external-attestation baseline (absorbed) → Phase 1 → Phase 2 → Phase 3`. Sequential only: Phase 2 adopts/preserves the current untracked producer and modified cutover contract, then consumes the new parser/CLI; docs describe the final contract.

## File Ownership

| Phase | Exclusive write ownership |
| --- | --- |
| 1 | `evidence-attestation-trust-root.json`; `scripts/release-artifact.mjs`; `scripts/release-artifact.test.mjs` |
| 2 | `.github/workflows/release-candidate.yml`; `.github/workflows/reservation-migration.yml`; `.github/workflows/deploy-firestore-rules.yml`; `scripts/release-workflows.test.mjs` |
| 3 | `docs/runbooks/phase-6-rollout.md` |

## Compatibility and Rollback

Fix-bearing Rules workflows reject pre-fix candidate manifest schema 1 and attestation schema 1; rebuild candidate and regenerate external attestation from a configured reviewed revision. Existing Hosting/Functions workflows may still execute a pre-fix revision's old verifier and are explicitly out of this Rules-attestation scope. No data/user/API migration. Roll back only in reverse order and hold all Rules dispatches first; reverting the whole fix reopens task #15.

## Success Criteria

- Arbitrary valid-looking KMS resource/algorithm/key substitution is rejected; non-main workflow refs and schema-1 Rules candidates cannot bypass the cutover.
- Placeholder/missing root cannot seal or verify a candidate and cannot pass producer/deploy checks.
- Signed payload binds revision, evidence, ciphertext, rollback key, owner commitment, attestation key version, supported KMS algorithm, and attestation public-key fingerprint.
- Workflow source contains no signing command/permission; retained Policy Troubleshooter evidence proves each Actions principal lacks `cloudkms.cryptoKeyVersions.useToSign` on the exact key.
- All five `inputs.revision` production/Rules checkout jobs prove exact HEAD and fresh `origin/main` ancestry before scripts, provenance, or auth.
- Focused artifact/workflow tests, root Vitest regression, and repository checks pass; Java-backed Rules/emulator acceptance remains BLOCKED / NOT_RUN; no deploy/auth/production action runs.

## Current validation evidence

Root lint PASS; release workflow checks 6/6; focused catalog/date checks 264/264;
root Vitest 1,503/1,503 across 180 files; root build PASS; Functions lint/build PASS;
Functions tests 79 passed, 7 skipped; YAML checks 4/4; all sequential explicit
`.claude` Node tests 728/728; git diff check PASS. Java-backed Rules/emulator
validation is BLOCKED / NOT_RUN because Java/Javac is unavailable. The trust root
remains intentionally `UNCONFIGURED` pending reviewed operator setup, so release is
HOLD, not failed implementation.

## Unresolved Questions

- When will authorized operator setup replace the intentional `UNCONFIGURED` trust root?
- When will Java/Javac be available for Rules/emulator acceptance?
