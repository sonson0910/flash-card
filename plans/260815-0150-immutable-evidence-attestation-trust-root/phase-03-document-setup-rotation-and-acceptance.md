---
phase: 3
title: "Document setup, rotation, and acceptance"
status: completed
priority: P1
effort: "1.5h"
dependencies: [2]
---

# Phase 3: Document Setup, Rotation, and Acceptance

## Context Links

- Candidate retention instructions: `docs/runbooks/phase-6-rollout.md:7-25`
- Current external attestation description: `docs/runbooks/phase-6-rollout.md:37-76`
- Current protected environment setup: `docs/runbooks/phase-6-rollout.md:98-111`
- Existing rollback rules: `docs/runbooks/phase-6-rollout.md:148-172`
- Release evidence decision boundary: `docs/architecture/adr-005-release-evidence-and-guarded-rollout.md:23-44`
- Repository production boundaries: `README.md:154-171`

## Overview

Update the rollout runbook so operators can configure and rotate the reviewed trust root without exposing private material or assuming local production access. Define the intentional schema cutover and acceptance commands. No workflow dispatch, auth, signing, migration, or deploy in this phase.

## Key Insights

- Current runbook tells operators to configure mutable `EVIDENCE_ATTESTATION_KMS_KEY_VERSION` but does not require a reviewed fingerprint or revision match (`docs/runbooks/phase-6-rollout.md:100-110`).
- Current attestation documentation binds evidence fields but not signer identity (`docs/runbooks/phase-6-rollout.md:59-76`).
- Existing rollback instructions require exact retained artifacts and fresh Rules evidence (`docs/runbooks/phase-6-rollout.md:148-172`); schema-1 artifacts must not be grandfathered after this fix.
- ADR-005 requires immutable evidence and human-gated action, not local production access (`docs/architecture/adr-005-release-evidence-and-guarded-rollout.md:23-44`).

## Requirements

### Functional Documentation

Document this operator sequence:

1. Outside GitHub Actions, authorized operator selects the exact immutable asymmetric KMS CryptoKeyVersion. No value is inferred by local code.
2. In an authorized read-only context, describe the exact version to capture immutable `name` + `algorithm`, export its public key, canonicalize to DER SubjectPublicKeyInfo, and compute lowercase SHA-256. Accept only the implementation's explicit SHA-256 signing allowlist; document commands without real values:

```sh
gcloud kms keys versions describe <version-id> \
  --project=<project> --location=<location> --keyring=<keyring> --key=<key> \
  --format='json(name,algorithm)'
gcloud kms keys versions get-public-key "$KEY_VERSION" --output-file=attestation-public-key.pem
openssl pkey -pubin -in attestation-public-key.pem -outform DER | sha256sum
```

3. Open a reviewed change replacing all `UNCONFIGURED` values in `evidence-attestation-trust-root.json`. Reviewers compare exact resource, allowlisted algorithm, fingerprint, key ownership/purpose, and verify-only IAM evidence.
4. Configure protected `EVIDENCE_ATTESTATION_KMS_KEY_VERSION` to the exact reviewed resource. It is an assertion/convenience, not the root of trust.
5. Before release, an authorized operator uses IAM Policy Troubleshooter for each effective Actions principal, exact CryptoKeyVersion, and `cloudkms.cryptoKeyVersions.useToSign`; inherited organization/folder/project/group/custom-role grants must resolve to not granted. Retain immutable approval evidence with principal, resource, permission, policy revision, result, and timestamp. Static YAML search is not IAM proof.
6. Keep reservation migration limited to existing production data/migration authority plus public-key read; keep Rules cutover limited to existing Rules-deploy authority plus public-key read. External signer authority remains outside Actions (`docs/runbooks/phase-6-rollout.md:100-111`).
7. Configure `production-rules-cutover` deployment branches to allow only `main` and reject tags; record the cutover commit. The workflow main-ref assertion, direct Rules schema-2 guard, and producer CLI preflight block pre-cutover refs/revisions.
8. Build a new release-candidate manifest schema 2 from that revision; retain candidate run/revision/digest/trust-root-bearing artifact.
9. External signer independently reads the same reviewed revision, verifies resource + algorithm + DER SPKI fingerprint, builds the exact schema-2 payload, and signs canonical `jq -cS` bytes. Document verifier mapping: EC P-256/SHA-256 uses EC verify; RSA PKCS#1/SHA-256 uses explicit PKCS#1 padding; unsupported algorithms hold.
10. Dispatch reservation evidence and Rules deploy only after protected variable equals reviewed value. Any metadata/algorithm/key mismatch, unavailable key, non-main workflow ref, or schema-1 Rules candidate means hold; never substitute a fallback key.

### Rotation and Revocation

- Rotation requires: new immutable key version + allowlisted algorithm + public key → new fingerprint → reviewed commit → new candidate → new external attestation → protected variable/IAM evidence alignment → new approvals.
- Do not rotate by changing only GitHub variable/secret.
- Keep old public-key versions retrievable only as long as policy requires historic verification. An old candidate cannot use a new root.
- If a key is compromised, hold producer/deploy workflows, revoke/disable signer authority outside Actions, land a reviewed new root, rebuild candidate/evidence, and do not grandfather schema-1 or old-root evidence.

### Compatibility

- Release-candidate manifest schema 1: rejected by fix-bearing Rules workflows after Phase 2; rebuild from a configured revision.
- Migration attestation schema 1: rejected by fix-bearing producer/Rules workflows after Phase 2; external signer regenerates schema 2.
- Pre-fix Hosting/Functions workflow revisions may retain their old schema-1 verifier and are explicitly outside this Rules-attestation fix; Hosting/Functions/Rules content and application data schemas remain unchanged.
- Existing production runtime remains untouched until a separately approved workflow runs.
- Placeholder configuration is a deliberate release hold, not a local test failure: unit fixtures use synthetic configured roots; real candidate/evidence workflows fail closed.

## Related Code Files

| Action | Absolute path | Change |
| --- | --- | --- |
| Modify | `/mnt/Projects/elly_code/flash-card/docs/runbooks/phase-6-rollout.md` | Trust model, setup, canonical payload, rotation, cutover, rollback |

## Implementation Steps

1. Section 1: state candidate manifest schema 2 includes the trust-root component; schema-1 candidates are not accepted by the fix-bearing Rules path, while pre-fix Hosting/Functions behavior is outside this cutover (`docs/runbooks/phase-6-rollout.md:7-25`).
2. Section 2: extend attestation payload with exact attestation KMS resource, allowlisted algorithm, and DER SPKI SHA-256; state envelope schema 2 and canonical signing bytes (`docs/runbooks/phase-6-rollout.md:59-76`).
3. Section 4: replace environment-variable-as-authority language with reviewed resource/algorithm/fingerprint setup and exact runtime equality; include `UNCONFIGURED` fail-closed behavior, main-only environment policy, direct schema/CLI cutover guards, distinct migration/Rules permissions, and release-blocking Policy Troubleshooter evidence (`docs/runbooks/phase-6-rollout.md:98-111`).
4. Add key rotation/revocation subsection near protected setup. Separate public identifiers from private signing authority.
5. Section 6: state rollback to pre-fix content requires a new reviewed revision/candidate/evidence chain carrying the configured trust root; do not reuse schema-1 attestations (`docs/runbooks/phase-6-rollout.md:148-172`).
6. Run acceptance commands below. Record blocked external validation honestly; do not authenticate to make it pass.

## Verification and Test Matrix

| Level | Command/check | Pass condition |
| --- | --- | --- |
| Syntax | `node --check scripts/release-artifact.mjs` | Exit 0 |
| Type check | `npm run lint` | Exit 0 |
| Focused unit/contract | `npx vitest run scripts/release-artifact.test.mjs scripts/release-workflows.test.mjs` | All tests pass, including valid-resource substitution |
| Root Vitest regression | `npx vitest run` | Exit 0; no ignored failures |
| Repository gate | `npm run verify:core` | Root, Functions, and Firestore Rules checks exit 0 |
| Workflow static contract | Search both workflows for `asymmetric-sign` | Zero matches |
| Workflow static contract | Search mutable algorithm/fingerprint inputs (vars/dispatch/secret equivalents) | Zero authority paths |
| Caller inventory | Re-run search for `release-artifact.mjs verify` | Exactly five existing workflow verify calls remain |
| Trust-root inventory | Search `EVIDENCE_ATTESTATION_KMS_KEY_VERSION` | Only variable assertion/comparison/fetch paths; never sole trust source |
| Workflow cutover contract | Search main-ref/direct schema/producer CLI preflight | Non-main blocked; Rules rejects schema 1; pre-fix producer fails before migration |
| Operational policy audit | Environment policy + IAM Policy Troubleshooter | Main only/no tags; exact principal/key `useToSign` permission is not granted, with retained evidence |
| Operational E2E | Authorized future schema-2 candidate/evidence workflow | Deferred/human-gated; not claimed locally |

## Todo List

- [x] Document reviewed trust-root setup
- [x] Document allowed algorithm, canonical fingerprint, and signed payload
- [x] Document Policy Troubleshooter proof, schema/CLI cutover guards, and main-only environment policy
- [x] Document Rules-scoped schema-1 incompatibility and regeneration
- [x] Document key rotation, revocation, and rollback hold
- [x] Run syntax/focused/full tests without auth/deploy
- [x] Re-grep all callers and trust references

## Success Criteria

- [ ] Runbook distinguishes immutable trust root from mutable operational variable.
- [ ] Operator can review exact resource + supported algorithm + SPKI fingerprint without exposing private key material.
- [ ] Canonical signed payload, algorithm, and trailing-LF rule are explicit enough for an external signer to reproduce.
- [ ] Rotation cannot be interpreted as “change GitHub variable only.”
- [ ] Local commands, including `verify:core`, pass; retained main-only policy and exact Policy Troubleshooter not-granted evidence are release blockers; authorized E2E remains unclaimed locally.
- [ ] No unresolved placeholder is mistaken for production readiness.

## Risk Assessment

| Risk | Likelihood × Impact | Mitigation |
| --- | --- | --- |
| Operator fingerprints PEM text instead of key identity | Medium × High | Define DER SPKI algorithm and review checklist |
| Operator selects incompatible KMS algorithm | Medium × High | Review fetched immutable metadata against exact SHA-256 signing allowlist |
| Rotation strands rollback candidates | Medium × High | Revision-scoped roots; new reviewed rollback revision/candidate/evidence chain |
| Static YAML check mistaken for IAM proof | Medium × High | Release-blocking Policy Troubleshooter evidence across inherited grants |
| Placeholder interpreted as optional | Medium × Medium | State candidate/evidence workflows intentionally fail closed |
| Repository gate fails from unrelated dirty work or missing Java tooling | Medium × Medium | Report exact failure/blocker; do not weaken tests, authenticate, or overwrite user changes |

## Security Considerations

- The trust-root JSON contains no secret. Reviewability of resource, algorithm, and fingerprint is the security property.
- External signer must verify the same revision/root/algorithm before signing; signing a caller-provided payload without that comparison remains unsafe.
- “No signing command” is static evidence only; effective IAM must independently prove `cloudkms.cryptoKeyVersions.useToSign` is not granted.
- A fingerprint mismatch is not recoverable by “try another key.” Stop and investigate config, key rotation, or artifact provenance.
- Protected approvals remain necessary but are no longer sufficient to redefine signer identity.

## Rollback Plan

Documentation can be reverted independently only before workflow rollout. After rollout, docs must match active schema 2. If implementation rollback is mandated, first hold dispatches, archive schema-2 artifacts as incompatible with schema-1 workflows, and revert Phase 2 then Phase 1. Never use documentation rollback to authorize a fallback key.

## Next Steps

Implementation handoff only after whole-plan consistency review. Production operator supplies real key resource/algorithm/fingerprint through a separate reviewed configuration change; no local agent action.

## Validation Status

- `node --check scripts/release-artifact.mjs`, focused release tests, root Vitest, lint, YAML parsing, caller inventory, and signer-authority search passed.
- `npm run verify:core` was not run because Java is unavailable locally; Firestore Rules runtime validation remains blocked and must run in a Java 21 environment.

## Unresolved Questions

None.
