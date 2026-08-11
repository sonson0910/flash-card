# Phase 6 — Verification and rollout readiness

Date: 2026-08-04

Status: implemented and fixture-tested locally; catalog, staging and production
gates pending

Execution gate: allowed for local implementation and CI/release tooling by the
user's explicit request. External staging/production deployment, Firebase project
changes, secrets, billing controls and destructive migration remain human gates.

Target environment: local/CI (`dev` semantics)

Maximum remediation rounds: 2

## Problem

Phases 0–5 establish the multilingual schema, catalog contracts/workspace, learning
paths and daily experience. Catalog behavior is fixture-tested but no reviewed
release is published, and rollout confidence is still fragmented. Reversible
migration is tested per entity rather than as a bounded rehearsal. A 10,000-item
performance result is not reported as a release artifact, and multi-script and
WCAG 2.2 coverage are not a
single gate, and staging/canary decisions lack machine-readable thresholds and
privacy-aware operational evidence.

## Goal

Turn Phase 6 into an enforceable release-readiness layer: deterministic migration
rehearsal and rollback evidence, bounded performance/content/accessibility QA,
structured operational signals, immutable staging smoke contracts, and a guarded
canary decision that can never deploy or promote silently.

## Scope

- Bounded v2→v3 migration rehearsal with dry-run, apply, rollback, quarantine,
  conflict, owner isolation and tamper-evident report semantics.
- 10,000-membership performance gate with separated install/query measurements
  and explicit cached-view/filter budgets.
- Offline reload and account-switch regression coverage across learning/catalog
  surfaces.
- Latin, Han, Kana and Hangul fixtures covering identity, normalization, scoring,
  presentation language/script and wrong-script rejection.
- Catalog content QA report covering schema, references, provenance, rights,
  editorial evidence and publishability; draft pilot must remain non-publishable.
- WCAG 2.2 AA automated tags plus keyboard, focus-not-obscured, 200% text,
  320px reflow, target size, reduced motion and error recovery evidence.
- Privacy-aware, bounded operational telemetry for release version, pending queue,
  oldest operation age, stale/conflict counts and catalog/mirror health.
- Release candidate, staging smoke and canary decision tooling with immutable
  revision checks, threshold validation, rollback instructions and CI integration.

## Non-goals

- Running a production migration or deleting v2 data.
- Publishing the AI-assisted draft pilot or changing catalog rights claims.
- Deploying staging/production, changing Firebase projects, secrets, billing or
  traffic without a separate explicit confirmation.
- Adding a telemetry vendor, user tracking SDK or runtime dependency.
- Claiming App Check/Auth/Firestore/AI/image integration passed without a real
  staging environment and credentials.

## Architecture decisions

1. Release readiness is a vendor-neutral domain under `features/releaseReadiness`
   plus small Node operators under `scripts/`; product controllers do not learn
   deployment/vendor details.
2. Migration rehearsal is additive and bounded. It plans first, applies through
   atomic ports, retains trusted rollback snapshots and never deletes source v2.
3. Performance budgets measure query work separately from fixture installation so
   CI machine variance cannot disguise an unbounded query.
4. Telemetry is allowlisted, numeric/categorical, bounded in memory and free of
   word text, translations, email, UID, token, URL query or free-form errors.
5. A canary evaluator produces `promote | hold | rollback`; only a human-approved
   workflow may act on it. Threshold absence or stale evidence always means hold.
6. Staging smoke targets an explicit HTTPS origin and immutable build revision.
   Local tests use a fake transport; no external environment is inferred.

See `docs/architecture/adr-005-release-evidence-and-guarded-rollout.md`.

## Acceptance criteria

1. A bounded rehearsal of up to 10,000 legacy cards emits deterministic counts,
   quarantines malformed records, detects identity/conflict collisions and rejects
   cross-owner application before any write.
2. Applying the same rehearsal twice is idempotent; rollback restores normalized
   v2 progress only when owner/document/fingerprint/revision/epoch match, and never
   recreates a missing or newer document.
3. Migration evidence includes no card content or learner identifier and can be
   serialized as a stable release artifact.
4. The 10,000-item catalog gate reports cached-open and indexed-query durations;
   cached content target is <500 ms and filter/search target is <100 ms on the
   configured CI benchmark, with scan bounds asserted independently of timing.
5. Latin/Han/Kana/Hangul matrices prove collision-safe identity, exact script
   scoring, wrong-script rejection and correct `lang`/direction presentation.
6. Content QA rejects missing rights/source/reviewer/digest, invalid references,
   duplicate identity and any unreviewed/non-publishable candidate from release.
7. Phase 6 WCAG 2.2 AA journeys have zero serious/critical axe violations and
   assertions for keyboard focus, target size, 320px reflow and 200% text.
8. Offline reload remains useful, and account changes during pool/catalog/stats/
   migration work cannot publish or render the prior owner's result.
9. Operational events accept only the allowlisted schema, cap memory, omit private
   content and expose release/pending/conflict/mirror metrics with correlation IDs.
10. Staging smoke rejects HTTP, revision mismatch, unhealthy metadata, missing
    security headers and failed bounded service probes.
11. Canary evaluation has explicit error, latency, sync-loss, quota and cost
    thresholds; missing/stale samples hold, breach rolls back, and healthy evidence
    promotes. No command promotes automatically.
12. CI uses Node 22/Java 21 and gates app/Functions/rules/catalog/build/secrets/
    bundle/audit/WCAG/Chromium/Firefox/WebKit plus Phase 6 readiness artifacts.
13. Root/Functions High/Critical audit is clean, initial bundle stays under budget,
    `src/App.tsx` stays ≤600 lines and no secret appears in artifacts.
14. Real staging smoke, canary observation and production promotion are reported
    as blocked until separately authorized and supplied with environment access.

## Work breakdown

### Increment 1 — migration rehearsal

- RED tests for deterministic planning, bounds, owner isolation, apply retry,
  quarantine/conflict reporting and rollback preconditions.
- Implement a pure rehearsal controller over existing migration atomic ports.

### Increment 2 — performance, script and content QA

- RED tests for benchmark budgets and structural scan limits.
- Multi-script fixture matrix across identity/scoring/presentation.
- Machine-readable content readiness report; pilot remains rejected.

### Increment 3 — observability and rollout policy

- RED tests for privacy allowlist, bounded buffer and aggregate metrics.
- Staging smoke contract and canary decision engine with rollback thresholds.
- Release runbook and immutable evidence format.

### Increment 4 — accessibility and resilience journeys

- WCAG 2.2 AA E2E, keyboard/focus/target/reflow/zoom.
- Offline and account-switch integration regressions.

### Increment 5 — CI and acceptance

- Integrate Phase 6 gates into CI and release-candidate workflows.
- Run focused tests, full suites, build, audits and browser gates.
- Independent architecture/security/accessibility review is required before local
  acceptance. External rollout remains a separate human-gated operation.

## Stop conditions

- Escalate after two remediation rounds if a Definition of Done item still fails.
- Stop before external deploy, migration apply/delete, catalog publication,
  Firebase project/secrets/billing change or production traffic action.
- Missing Java/browser/runtime may block local execution but must remain visible;
  CI configuration is not evidence that a gate actually ran locally.
