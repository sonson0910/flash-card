# Comprehensive upgrade closure plan

Date: 2026-08-10

Status: locally controllable implementation and verification complete; external
staging and production gates remain closed

## Objective

Close the remaining locally controllable gaps in the SonFlash comprehensive
upgrade while preserving the current reliability and security hardening batch.
The release candidate should be correct, bounded, accessible, recoverable, and
supported by reproducible evidence rather than optimistic phase-completion
prose.

This plan is authorized for local implementation and verification. It does not
authorize a production deploy, traffic change, Firebase project mutation,
catalog publication, destructive data migration, secret rotation, billing
change, or use of unreviewed language content.

## Historical audit verdict before closure implementation

At planning time, the codebase was substantially stronger than the original
roadmap baseline. The worktree already implemented atomic card identity reservations,
revision/library-epoch/tombstone enforcement, duplicate-race convergence,
owner-safe device acknowledgements, stale-session guards, rebased gamification
operations, bounded catalog scans, transactional catalog cancellation,
owner-private shared-deck persistence, and bounded AI output.

The following were the pre-implementation closure blockers. They are retained as
historical planning evidence; every item below is resolved in the final local
worktree:

- `src/App.tsx` exceeds the enforced 600-line architecture limit;
- the Phase 6 manifest smoke requirement contradicts the correct no-cache
  Hosting policy, so the documented smoke cannot pass;
- an unavailable study image can still be selected as the only recall cue;
- a missing design token makes daily-learning surfaces transparent;
- catalog filtering can announce a false empty result and performs work on
  every search keystroke;
- the bundle has less than 0.3% total-JavaScript headroom, dominated by a chart
  dependency that is unnecessary for three small visualizations;
- several recoverable UI failures are console-only or use inconsistent native
  confirmation;
- release evidence and roadmap prose do not accurately distinguish local proof
  from content, staging, and production gates.

## Assumptions

1. Existing modified and untracked files are user-owned and must be preserved.
2. Modern evergreen browsers are the support target; Node 22 is the CI runtime.
3. English-to-Vietnamese remains the currently shipped learning profile until
   a product-approved locale/content program exists.
4. Published catalog vocabulary requires licensing and reviewer evidence; test
   fixtures are not publishable content.
5. A locally unavailable browser/emulator is reported as an environment block,
   never rewritten as an application pass.

## Stack, structure, and commands

- React 19, TypeScript, Vite, Tailwind CSS, Firebase, Vitest, and Playwright.
- Application source and colocated tests: `src/`.
- Cloud Functions and tests: `functions/src/` and `functions/test/`.
- Browser journeys: `e2e/`.
- Release tooling: `scripts/`.
- Specifications, ADRs, plans, and runbooks: `docs/`.

Canonical verification commands:

```sh
npm run lint
npm test -- --run
npm --prefix functions run lint
npm --prefix functions test
npm --prefix functions run build
npm run build
npm run verify:release-config
npm run verify:secrets
npm run verify:bundle
npm run test:e2e:chromium
npm run verify:audit
npm run test:rules
```

Code follows the existing explicit typed-contract style: domain behavior lives
outside presentation components, async state has named variants, user-facing
errors are recoverable, and tests assert outcomes rather than implementation
calls. New behavior is implemented test-first where practical.

## Security and privacy threat model

Trust boundaries include user text and spreadsheet input, shared-deck IDs and
payloads, IndexedDB state, Firestore documents, callable Function input, catalog
manifests/chunks, remote media, and Gemini output. Assets include private cards,
learning history, identity boundaries, share ownership, API quota, and release
integrity.

The closure preserves these controls:

- spoofing/elevation: Auth, App Check, owner checks, private share metadata;
- tampering: schema validation, revisions, epochs, tombstones, content hashes;
- repudiation: stable operation IDs and acknowledgement records;
- disclosure: field allowlists, generic user errors, secret scanning;
- denial of service/cost: bounded input, output tokens, pages, scans, and rate
  limits;
- stale/cross-owner state: lifecycle identities, abortable transactions, and
  user-scoped persistence.

Abuse cases to retain in regression coverage include concurrent duplicate
creation, offline resurrection, stale account writes, forged share ownership,
oversized model output, corrupt catalog data, and delayed queries overwriting a
newer request.

## Ordered implementation tasks

### Task 1 — Make the staging smoke contract truthful

Acceptance:

- the release manifest must require `no-cache`, `no-store`, and
  `must-revalidate`;
- immutable caching remains required only for hashed catalog content assets;
- operator output and rollout documentation use unambiguous field names.

Verification: targeted release-readiness/operator tests, then Phase 6 tests.

### Task 2 — Restore the application architecture gate

Acceptance:

- lazy Library and Practice view composition plus the shared fallback live in a
  focused app module;
- behavior and code splitting are unchanged;
- `src/App.tsx` is at or below 600 analyzer lines.

Verification: lazy-loading tests, architecture analyzer, TypeScript.

### Task 3 — Close high-impact accessibility defects

Acceptance:

- Image-to-Word is not offered when no usable image exists, and an active mode
  resolves safely if media becomes unavailable;
- missing-image semantics have a valid accessible role;
- `--sf-surface-muted` exists in light and dark themes;
- each application view exposes one canonical `h1` and a skip-to-content path;
- long quiz options wrap and expose answer-group semantics.

Verification: focused component tests, token-contract test, Chromium axe/reflow
journeys, and existing keyboard tests.

### Task 4 — Recover meaningful bundle headroom

Acceptance:

- Recharts is replaced by dependency-free SVG/CSS charts;
- the existing hidden data tables and `role="img"` descriptions remain;
- chart empty/partial states remain truthful;
- the dependency and lockfile are removed through npm;
- total gzip JavaScript has material headroom below the existing budget.

Verification: chart tests, production build, bundle budget, dependency audit.

### Task 5 — Make catalog filtering race-safe and truthful

Acceptance:

- initial/filter reload has an explicit busy state and never announces a false
  empty library;
- search input updates immediately while URL/cache queries debounce by about
  250 ms;
- popstate synchronizes the input draft;
- stale query completion cannot replace the newest result.

Verification: model/component tests for rapid typing, delayed queries,
navigation synchronization, loading, true empty, and error states.

### Task 6 — Make recoverable failures actionable

Acceptance:

- clipboard rejection and explanation-translation rejection produce visible,
  dismissible feedback without leaking internals;
- custom-deck deletion uses the existing accessible AlertDialog pattern with
  cancel, confirm, and focus restoration;
- native `window.confirm` is removed from that path.

Verification: component/hook tests for rejected promises and destructive-dialog
keyboard behavior.

### Task 7 — Align release evidence and architecture records

Acceptance:

- roadmap/phase/runbook text distinguishes implemented code, fixture proof,
  unpublished content, staging proof, and production approval;
- an ADR records card identity reservations and private share ownership;
- the current hardening batch has an acceptance record with exact commands and
  known environment blocks.

Verification: documentation link/config checks and diff review.

### Task 8 — Full acceptance and independent review

Acceptance:

- all locally runnable lint, unit, Functions, build, configuration, secret,
  bundle, audit, Chromium, WebKit, and accessibility gates pass;
- Firestore Rules and Firefox are either passed in a compatible environment or
  recorded with their exact environment failure and CI command;
- an independent reviewer finds no unresolved required correctness,
  architecture, security, accessibility, or performance issue introduced by
  this closure;
- `git diff --check` passes and user-owned work remains intact.

## Checkpoints

1. Tasks 1–2: release and architecture blockers are green.
2. Tasks 3–4: accessibility regressions are covered and bundle headroom is
   recovered.
3. Tasks 5–6: asynchronous catalog and error-recovery flows are deterministic.
4. Tasks 7–8: evidence matches reality and every available gate is rerun.

## Closure execution outcome

All eight ordered tasks are implemented. Final local proof uses portable Node
22.23.2 and records 1,269/1,269 root tests, 35/35 Functions tests, 69/69 Phase 6
tests, 41/41 Firestore Rules emulator tests, a 1,930-module production build,
92 passing Chromium/WebKit journeys with two intentional WebKit skips, zero
dependency vulnerabilities, and clean independent correctness, runtime and
release reviews. The final bundle is 277,503/280,000 bytes initial JavaScript
gzip and 587,874/700,000 bytes total JavaScript gzip.

Verified release evidence is now permitted only when the supplied immutable
revision exactly matches a clean Git HEAD. The current intentionally dirty local
worktree therefore fails that gate closed and is not represented as a release
candidate. See the
[acceptance record](../reviews/comprehensive-upgrade-closure-2026-08-10.md) for
exact commands, retained evidence and external blockers.

## External completion gates

The following cannot be truthfully completed by local code changes alone:

- publishing English, Japanese, Korean, or Chinese catalog releases without
  licensed/reviewed source content;
- staging App Check/Auth/Firestore/AI/image integration without staging project
  credentials and an approved cost boundary;
- canary, production deploy, traffic promotion, rollback exercise, billing
  alerts, or destructive duplicate migration;
- the separately authorized reservation-migration workflow, external-KMS
  rollback evidence and protected production environment configuration;
- local Firefox proof while the host Playwright sandbox/SWGL launch fails.

These gates remain explicit release conditions. They must not be bypassed by
weakening tests, fabricating evidence, or publishing fixture content.

## Definition of done

The locally controllable definition of done is satisfied: every task above is
implemented, focused and broad available gates pass, independent review is
resolved, and the final acceptance record names remaining external gates. This
does not satisfy staging verification, production readiness, content approval,
migration authorization, or deployment approval.
