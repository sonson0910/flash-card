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
staging smoke results and canary decisions. CI produces immutable evidence. Canary
policy returns a recommendation only; deployment and promotion stay behind explicit
environment approval and repository runbooks.

## Trade-offs

- Local/CI verification cannot prove real Firebase integrations without staging
  credentials; that gap is reported rather than mocked as a pass.
- A small in-memory telemetry buffer gives integration seams and privacy controls,
  but not long-term dashboards. A vendor can be added later behind the port.
- Conservative hold/rollback defaults may slow rollout, which is acceptable while
  protecting learning progress and quotas.

## Consequences

- Phase 6 evidence becomes deterministic and machine-readable.
- Source v2 and draft catalogs remain untouched.
- Rollout thresholds can be reviewed independently from deployment mechanics.
- Production promotion cannot happen as an accidental side effect of tests.

## Revisit triggers

- A staging Firebase project and approved credentials are available.
- A privacy-reviewed telemetry backend is selected.
- Hosting gains a supported weighted traffic/canary mechanism.
