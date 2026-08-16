---
phase: 1
title: "Seal and validate the reviewed trust root"
status: completed
priority: P1
effort: "3h"
dependencies: []
---

# Phase 1: Seal and Validate the Reviewed Trust Root

## Context Links

- Candidate component inventory and digesting: `scripts/release-artifact.mjs:10-21`, `scripts/release-artifact.mjs:240-270`
- Candidate seal/verify contracts: `scripts/release-artifact.mjs:281-338`
- CLI entrypoints: `scripts/release-artifact.mjs:383-420`
- Current unit fixtures/cases: `scripts/release-artifact.test.mjs:25-239`
- Candidate producer upload: `.github/workflows/release-candidate.yml:48-94`

## Overview

Add one revision-controlled trust-root JSON, validate it centrally, fingerprint fetched public keys canonically, and seal the file into release-candidate manifest schema 2. No production value guessed; committed initial values remain explicit placeholders that block release paths until an authorized reviewed revision configures them.

## Key Insights

- Current candidate digest covers only manifest schema/revision/run/timestamp/components (`scripts/release-artifact.mjs:262-270`); no attestation trust material exists in the nine-component inventory (`scripts/release-artifact.mjs:10-21`).
- `sealReleaseArtifact` emits schema 1 and `verifyReleaseArtifact` accepts only schema 1 (`scripts/release-artifact.mjs:281-295`, `scripts/release-artifact.mjs:304-314`). A schema bump gives explicit fail-closed compatibility instead of silently changing schema-1 meaning.
- Five workflow `verify` callers exist: production validation/Hosting/Functions (`.github/workflows/deploy-production.yml:98-99`, `.github/workflows/deploy-production.yml:128-145`, `.github/workflows/deploy-production.yml:177-194`) and Rules pre/post approval (`.github/workflows/deploy-firestore-rules.yml:119-126`, `.github/workflows/deploy-firestore-rules.yml:162-184`). A caller inherits schema 2 only when its checked-out revision contains this verifier; Phase 2 must independently enforce the fixed Rules path, while pre-fix Hosting/Functions compatibility remains out of scope.
- Only `scripts/release-artifact.test.mjs` imports the exported artifact functions (`scripts/release-artifact.test.mjs:5-9`).

## Requirements

### Functional

- Create root-level `[NEW] evidence-attestation-trust-root.json` with exact keys:

```json
{
  "schemaVersion": 1,
  "evidenceAttestationKmsKeyVersion": "UNCONFIGURED",
  "evidenceAttestationKmsAlgorithm": "UNCONFIGURED",
  "evidenceAttestationPublicKeySpkiSha256": "UNCONFIGURED"
}
```

- Configured KMS value must match the existing full immutable CryptoKeyVersion resource shape currently enforced in workflows (`.github/workflows/reservation-migration.yml:124-130`, `.github/workflows/deploy-firestore-rules.yml:176-183`).
- Configured algorithm must be exactly one verifier-supported SHA-256 signing algorithm: `EC_SIGN_P256_SHA256` or `RSA_SIGN_PKCS1_{2048,3072,4096}_SHA256`; reject RSA-PSS, SHA-384/512, and decrypt algorithms rather than guessing OpenSSL parameters.
- Configured fingerprint must be exactly 64 lowercase hex characters and mean SHA-256 over DER-encoded SubjectPublicKeyInfo, not PEM text.
- Reject missing files, symlinks, oversized/invalid JSON, extra/missing keys, unsupported schema, placeholders, malformed KMS version, unsupported algorithm, and malformed fingerprint.
- Add `[NEW] verifyEvidenceAttestationTrustRoot(...)` export and `[NEW] verify-attestation-trust-root` CLI branch in `scripts/release-artifact.mjs`; accept candidate root, configured KMS version, ≤16 KiB regular non-symlink metadata JSON with exact keys `name` + `algorithm`, and fetched PEM path. Require metadata/root/config equality and computed fingerprint equality.
- Add exact component `[NEW] evidenceAttestationTrustRoot: { path: 'evidence-attestation-trust-root.json', type: 'file' }` to `COMPONENT_PATHS`, so directory/file digests and `candidateSha256` bind its bytes through existing digest flow (`scripts/release-artifact.mjs:10-21`, `scripts/release-artifact.mjs:240-270`).
- Emit/require release candidate manifest schema 2 in the fixed artifact script. Keep the current six top-level keys; only `schemaVersion` and the required component inventory change. Reject schema 1 whenever this verifier runs; Phase 2 adds the workflow-level guard needed because pre-fix revisions carry their own schema-1 verifier.

### Non-functional

- Use Node built-ins only: first require a ≤16 KiB regular non-symlink PEM with exact `BEGIN/END PUBLIC KEY` labels and no private-key label, then `createPublicKey(...).export({ type: 'spki', format: 'der' })` + existing SHA-256 helper. No dependency, network, auth, or KMS call in the script.
- Do not refactor unrelated sections of the already-large artifact script; keep review surface limited to trust parsing, fingerprinting, component/schema changes, and one CLI command.
- Error messages must distinguish placeholder/root schema, configured/metadata key mismatch, unsupported algorithm, malformed metadata/PEM, and SPKI fingerprint mismatch.

## Architecture and Data Flow

```text
reviewed JSON bytes
  → strict parse/placeholder guard
  → included as release component record {path, bytes, sha256}
  → candidate manifest schema 2
  → candidateSha256

runtime protected KMS resource + fetched KMS metadata + PEM
  → strict reviewed JSON parse
  → exact resource/name/allowlisted-algorithm equality
  → PEM parse → canonical SPKI DER → SHA-256
  → exact fingerprint equality
  → verified trust-root object returned
```

Input source of truth is the checked-out/candidate-root JSON, not CLI flags or fetched metadata. Runtime values are assertions to compare, never authority. The helper has no state beyond one invocation; no lifetime/isolation risk.

## Related Code Files

| Action | Absolute path | Change |
| --- | --- | --- |
| Create | `/mnt/Projects/elly_code/flash-card/evidence-attestation-trust-root.json` | Placeholder, strict schema, reviewed trust root |
| Modify | `/mnt/Projects/elly_code/flash-card/scripts/release-artifact.mjs` | Parse/validate/fingerprint helper, sealed component, schema 2, CLI |
| Modify | `/mnt/Projects/elly_code/flash-card/scripts/release-artifact.test.mjs` | Synthetic key and substitution/fail-closed tests |

## Implementation Steps

1. Add constants for trust-root path, KMS version regex, exact supported KMS signing algorithms, placeholder token, bounded JSON/PEM sizes, and manifest schema 2 near current release constants (`scripts/release-artifact.mjs:6-21`).
2. Reuse `requireFile`/safe-path logic (`scripts/release-artifact.mjs:25-55`) to load the JSON from `root`; enforce exact keys via existing `exactKeys` (`scripts/release-artifact.mjs:297-302`) after moving that helper earlier or introducing no duplicate implementation.
3. Add pure fingerprint function: parse PEM with `createPublicKey`; export canonical SPKI DER; hash to lowercase hex. Reject non-public-key/malformed input.
4. Add exported trust verifier. Validate reviewed file first, then exact configured resource + bounded `gcloud ... describe --format=json(name,algorithm)` metadata + allowlisted algorithm, then fetched PEM fingerprint. Never accept a caller-supplied expected fingerprint/algorithm as authority.
5. Add the JSON to `COMPONENT_PATHS`; call trust-root parsing during both `sealReleaseArtifact` and `verifyReleaseArtifact` before success (`scripts/release-artifact.mjs:281-338`).
6. Change release manifest generation and verification from schema 1 to 2 (`scripts/release-artifact.mjs:287-314`); update CLI usage text with `verify-attestation-trust-root` (`scripts/release-artifact.mjs:383-420`).
7. Extend `createCandidate` fixture to write a valid synthetic trust root (`scripts/release-artifact.test.mjs:25-49`). Generate test RSA public keys in-memory; do not introduce production or checked-in private keys.
8. Add tests:
   - schema-2 candidate contains a trust-root component digest;
   - placeholder/missing/extra-field root rejects seal;
   - schema-1 manifest rejects verify;
   - exact configured resource + exact allowed metadata algorithm + matching public key passes helper;
   - metadata name mismatch, valid-looking alternate resource, or alternate matching key still rejects;
   - RSA-PSS/SHA-384/decrypt algorithm metadata rejects before signature verification;
   - exact resource + different public key rejects fingerprint;
   - PKCS#8/other private-key PEM input is rejected rather than converted to a public key;
   - PEM formatting differences that decode to the same SPKI retain the same fingerprint;
   - trust-root byte tampering after seal rejects candidate verification.

## Test Matrix

| Layer | Scenario | Expected |
| --- | --- | --- |
| Unit | Placeholder or malformed JSON/KMS/algorithm/SHA | Throw before sealing |
| Unit | Metadata name/algorithm differs from reviewed root | Reject exact metadata mismatch |
| Unit | RSA-PSS, wrong hash family, or decrypt algorithm | Reject as unsupported before verification |
| Unit | Reviewed key A; caller supplies valid key resource B | Reject exact-resource mismatch |
| Unit | Reviewed fingerprint A; caller supplies PEM B | Reject fingerprint mismatch |
| Unit | Caller supplies private-key PEM | Reject before `createPublicKey` conversion |
| Unit | Same key, normalized PEM variations | Same SPKI fingerprint |
| Integration | Seal → verify unchanged candidate | Schema 2 passes |
| Integration | Modify trust-root bytes after seal | Component digest failure |
| Compatibility | Schema-1 manifest | Explicit unsupported-schema failure |

## Todo List

- [x] Create placeholder trust-root JSON
- [x] Add strict root/metadata parser, algorithm allowlist, and canonical SPKI fingerprinting
- [x] Seal trust root and bump candidate manifest schema
- [x] Add verifier CLI branch
- [x] Add unit/integration regression cases
- [x] Run `node --check scripts/release-artifact.mjs`
- [x] Run `npx vitest run scripts/release-artifact.test.mjs`

## Success Criteria

- [x] Candidate manifest reports schema 2 and contains the trust-root component record.
- [x] Placeholder configuration cannot produce a candidate manifest.
- [x] A valid-looking substituted KMS resource/algorithm is rejected even when paired with its own valid public key.
- [x] KMS metadata name and allowlisted SHA-256 signing algorithm must match the reviewed root; RSA-PSS/decrypt/wrong-hash metadata rejects.
- [x] A fetched key whose DER SPKI digest differs by one hex character is rejected.
- [x] No production key, credential, or network access appears in source/tests.

## Risk Assessment

| Risk | Likelihood × Impact | Mitigation |
| --- | --- | --- |
| Fingerprinting PEM bytes causes formatting drift | High × High | Canonical DER SPKI; variation test |
| KMS algorithm and OpenSSL parameters diverge | Medium × High | Seal exact allowlisted SHA-256 signing algorithm; reject unsupported metadata; contract tests |
| Schema bump invalidates retained candidates | Certain × Medium | Intentional Rules cutover; rebuild/regenerate; document Phase 3 |
| Late placeholder failure wastes candidate build time | Medium × Low | Clear seal error now; optional later fail-fast step is out of scope |
| New logic bloats existing 423-line file | Medium × Low | Minimal colocated functions; no unrelated refactor during security fix |

## Security Considerations

- Fingerprint, KMS resource, and signing algorithm are public identifiers, safe to review in Git; private/signing material remains external.
- Never accept expected fingerprint from environment, secret, dispatch input, attestation, or downloaded artifact alone.
- Exact resource/metadata algorithm comparison prevents same-format or incompatible-key substitution; fingerprint protects against wrong public-key retrieval/configuration.
- Component digest makes candidate trust-root tampering observable before any deploy.

## Rollback Plan

Before Phase 2, revert Phase 1 files safely. After Phase 2, do not roll Phase 1 back alone: first disable/hold producer and Rules dispatches, revert Phase 2, then Phase 1. Restoring schema 1 reopens the vulnerability and requires explicit security acceptance.

## Next Steps

Phase 2 consumes the verifier CLI and schema-2 candidate contract. No later phase may start until focused Phase 1 tests pass.
