---
name: release-readiness
description: "Assess SonFlash release readiness for an exact Git revision using repository-native evidence, without shipping, deploying, promoting, or mutating production."
user-invocable: true
when_to_use: "Invoke before creating or promoting a release candidate, approving a production workflow, evaluating rollback readiness, or answering whether a revision is ready to release."
category: dev-tools
keywords: [release, readiness, verification, evidence, provenance]
argument-hint: "[full-git-revision]"
metadata:
  author: sonflash
  version: "1.0.0"
---

# SonFlash Release Readiness

Assess one exact revision. Produce evidence, not optimism.

## Outcomes

Return exactly one final outcome:

- `READY` — required executable gates passed for the exact revision and remaining human approvals are identified.
- `HOLD` — the revision may be valid, but the checkout, evidence, prerequisites, or approvals are incomplete or stale.
- `BLOCKED` — a required gate failed or the requested revision cannot be verified safely.

Historical reports and acceptance notes are context only. They never prove the current revision.

## Hard boundaries

Do not:

- commit, merge, push, create a PR, bump a version, publish, or create a release;
- invoke `firebase deploy` or dispatch a deployment/promotion workflow;
- run a migration, alter traffic, change Firebase resources, or mutate production data;
- authenticate to Firebase merely to turn an unavailable check into a pass;
- represent skipped or blocked checks as passing.

Production remains workflow-only and human-gated.

## Required sources

Read the current versions of:

- `README.md`
- `package.json`
- `phase-6-release-readiness.md`
- `docs/runbooks/phase-6-rollout.md`
- `.github/workflows/release-candidate.yml`
- `.github/workflows/deploy-production.yml`
- `.github/workflows/deploy-firestore-rules.yml`

Read relevant architecture decisions when persistence, catalog, sharing, or migration evidence is involved.

## Preflight

1. Resolve the requested revision to a full 40- or 64-character identifier.
2. Record `HEAD`, branch, and clean/dirty worktree state.
3. Confirm evidence and artifacts claim the same revision as the target.
4. Confirm Node.js 22.
5. Confirm Java 21 before any Firestore Rules or complete release verification.
6. Record CI/runtime prerequisites that are unavailable locally.

A dirty checkout cannot produce release-grade evidence. Return `HOLD`, but continue with read-only assessment when useful.

## Verification

Use repository-native commands; do not invent a generic test matrix.

For complete release verification, only when the user requested execution and prerequisites exist:

```bash
RELEASE_REVISION="$(git rev-parse HEAD)" npm run verify
```

This gate already covers application and Functions type checks/tests, Firestore Rules, production build, secret and bundle checks, Playwright journeys, dependency audits, and Phase 6 evidence.

When a narrower assessment was requested, clearly list which of these were not run. Never infer the full gate from a subset.

## Evidence review

Verify:

- `artifacts/phase6-readiness.json` exists when expected;
- evidence revision equals the target revision;
- release-candidate artifact identity and digest are immutable;
- browser failure evidence and retention are accounted for;
- Hosting/Functions promotion and Firestore Rules cutover remain separate;
- rollback inputs and protected-environment approvals remain required;
- no local production deployment path was introduced.

## Report

Include:

- target revision and current `HEAD`;
- checkout state;
- Node and Java versions;
- each gate as `PASS`, `FAIL`, `BLOCKED`, or `NOT_RUN`;
- commands executed and concise results;
- evidence/artifact paths and provenance;
- human approvals still required;
- residual risks;
- final `READY`, `HOLD`, or `BLOCKED`.

Use exact `file:line` evidence for policy or workflow claims. List unresolved questions last.