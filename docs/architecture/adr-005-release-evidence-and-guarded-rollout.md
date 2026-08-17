# ADR-005: Release evidence and guarded rollout

Date: 2026-08-04

Status: Accepted for Phase 6 local implementation

## Context

Release signals currently live across unit tests, E2E, workflow YAML and manual
notes. Migration and rollback are safe per document, but there is no bounded batch
rehearsal artifact. Firebase Hosting also provides no repository-owned weighted
canary primitive, so pretending that a local command can safely promote traffic
would create a dangerous control surface.

## Options considered

| Option | Benefits | Costs |
| --- | --- | --- |
| Keep manual checklist | No code | Drift, unverifiable thresholds, weak rollback evidence |
| Adopt a telemetry/deployment SaaS | Rich dashboards and rollout controls | New vendor, credentials, runtime SDK, privacy and cost scope |
| Add vendor-neutral evidence + policy engines | Testable, no runtime dependency, safe human gates | Real staging probes still need environment access |

## Decision

Add bounded vendor-neutral contracts for migration evidence, operational metrics,
staging smoke results and canary decisions. Write operations require fresh externally
signed authorization before mutation. Authorization is bound to the exact current-main
revision and GitHub workflow run ID/attempt; persisted Admin progress rejects another
execution rather than silently continuing it. CI records a millisecond-precision completion
boundary, then accepts and verifies separately signed final-state evidence only when its
verification timestamp is strictly later; it never signs production evidence itself.

Both attestation stages sign canonical `{domain,schemaVersion,payload}` bytes so domain and
numeric schema cannot be relabeled outside the signature. The encrypted rollback snapshot
is retained as a protected immutable generation-qualified GCS object. Authorization, final
evidence, and deployment bind the same descriptor and digest. Workflows download and verify
the exact generation but retain only the descriptor in GitHub artifacts; ciphertext bytes
never use GitHub secret or artifact transport. Staging and canary operators can optionally
write schema-1 rollout envelopes bound to one immutable revision, candidate SHA-256,
allowlisted environment, UTC observation time/window, bounded non-URL source reference,
aggregate metrics, and the deterministic policy result. The envelopes exclude origins,
headers, content, identifiers, secrets, and free-form errors. Canary policy returns a
recommendation only; deployment and promotion stay behind explicit environment approval and
repository runbooks. The sealed schema-2 candidate and its artifact are bound to the exact successful producer
run and attempt; every promotion workflow verifies that attempt explicitly. Compatible runtime
promotion additionally requires the exact successful preparatory compatibility-Rules run and
attempt. Before protected Hosting or Functions access, it verifies the predecessor workflow,
required successful jobs, provider-verified evidence, protected target bindings, candidate
identity, and sealed compatibility Rules digest; a shared concurrency group or approval alone is
not predecessor evidence. Rules cutover also requires the exact successful production deployment
run and attempt and the exact reservation-migration workflow attempt that produced the retained
final-evidence artifact.
The separately attested mutation-job attempt stays bound to the original successful mutation
when final evidence is retried. A retained
schema-1 deployment envelope is emitted only after compatible
Hosting and Functions jobs both succeed and a GET-only provider read-back proves the live
Hosting channel points to a finalized version with the exact release message and health
revision, every expected Gen 2 Function is active, and every concrete Cloud Run revision
receiving observed traffic carries the complete split revision/candidate labels. Hosting and
Cloud Run mutable pointers are read twice so a concurrent promotion fails closed. The envelope
binds the shared protected target to the same revision and candidate run/digest that the Rules
workflow independently verifies. After the final Rules deployment, a separate GET-only
read-back resolves the named-database Firebase Rules Release, hashes its immutable Ruleset
source, compares it with the sealed file, and re-reads the Release before the job can succeed.

## Trade-offs

- Local/CI verification cannot prove real Firebase integrations without staging
  credentials; that gap is reported rather than mocked as a pass.
- A small in-memory telemetry buffer gives integration seams and privacy controls,
  but not long-term dashboards. A vendor can be added later behind the port.
- A rollout envelope proves bounded shape, candidate binding, and deterministic policy
  evaluation; it does not authenticate an unavailable external observation source.
- Provider read-back proves the observed control-plane pointers and the public Hosting health
  document at verification time. It does not replace App Check observation, browser smoke, or
  the documented propagation window for Firestore Rules enforcement.
- The verifier uses short-lived OAuth access only for bounded GET requests and emits no token,
  provider body, identity, URL, or free-form provider error. Missing viewer IAM is a release
  hold rather than a reason to grant deployment-wide read access.
- Conservative hold/rollback defaults may slow rollout, which is acceptable while
  protecting learning progress and quotas.
- Cross-run continuation is intentionally unavailable until a separately signed lineage
  protocol exists; a retry of the mutation job must obtain new authorization and cannot
  inherit another run attempt's persisted execution identity. A retry of only the final
  evidence job keeps the original successful mutation attempt through immutable job outputs.
- The external archive requires retention/versioning policy and least-privilege IAM outside
  this repository. Missing archive proof is a release hold, not a reason to fall back to a
  large GitHub secret.

## Consequences

- Phase 6 evidence becomes deterministic and machine-readable.
- Pre-mutation authorization cannot be relabeled as post-mutation final-state evidence.
- Final attestations bind the exact migration run ID/attempt, mode, completion timestamp,
  immutable rollback object generation, and ciphertext digest.
- Source v2 and draft catalogs remain untouched.
- Rollout thresholds can be reviewed independently from deployment mechanics.
- Production promotion cannot happen as an accidental side effect of tests.
- Firestore Rules cannot cut over from a Hosting-only, Functions-skipped, mismatched-target,
  provider-unverified, or differently bound production deployment run.
- A successful deploy command alone is no longer deployment evidence: live Hosting, Functions,
  Cloud Run traffic, and the active named-database Ruleset must read back as the sealed candidate.

## Revisit triggers

- A staging Firebase project and approved credentials are available.
- A privacy-reviewed telemetry backend is selected.
- Hosting gains a supported weighted traffic/canary mechanism.
