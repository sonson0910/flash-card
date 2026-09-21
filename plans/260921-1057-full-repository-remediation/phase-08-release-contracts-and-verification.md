---
title: "Phase 8: Release contracts and full verification"
status: complete
---

# Phase 8: Release contracts and full verification

## Overview

Ensure the final release tests exercise the exact new artifact, derive security contracts from their source, reconcile chosen labels and Firebase tooling, replace structural owner-safety assertions with behavior, then run every gate.

## Requirements

- [x] Playwright cannot silently attach to an unrelated/stale process on port 4173.
- [x] CSP hash validation is computed from the inline bootstrap script, not a duplicated literal.
- [x] Owner-switch correctness is proven with deferred promises and observable side effects.
- [x] Firebase CLI, lockfile, workflow tests, and audit resolve to one approved safe version.
- [x] Shell UI, docs, unit tests, and E2E use the selected label contract consistently.

## File inventory

| Concern | Paths |
|---|---|
| Playwright/build identity | `playwright.config.ts`, `scripts/generate-build-metadata.mjs`, `e2e/app.spec.ts` |
| Owner behavior | `src/features/practice/practiceSessionLifecycle.test.ts`, `src/features/practice/usePracticeSession.ownerRace.test.ts` |
| CSP | `index.html`, `firebase.json`, `deployGateSource.test.ts` |
| Firebase dependency/release | `package.json`, `package-lock.json`, `scripts/release-artifact.test.mjs`, `scripts/release-workflows.test.mjs`, `.github/workflows/deploy-production.yml`, `.github/workflows/deploy-firestore-rules.yml`, `.github/workflows/migrate-legacy-shared-decks.yml` |
| Shell contract | `docs/specs/sonflash-memory-atelier-ui-upgrade.md`, `src/components/shell/DesktopNavigation.tsx`, `src/components/shell/FloatingMobileNav.tsx`, `src/components/shell/AppNavigation.test.tsx`, `src/components/shell/FloatingMobileNav.test.tsx`, `e2e/accessibility.spec.ts`, `e2e/app-shell-remediation.spec.ts`, `e2e/app.spec.ts`, `e2e/catalog-workspace.spec.ts`, `e2e/phase5-learning.spec.ts` |

## Implementation steps

1. Default `reuseExistingServer` to false. If explicit reuse remains supported, generate a per-artifact identity after the build (content digest or equivalent that distinguishes dirty local builds), expose it in `dist/health.json`, and require an exact expected identity match. The existing fallback `revision: "local"` is not identity evidence.
2. Add stale-server reproductions for an unrelated 200 response and for two different local builds that both lack CI revision variables; both must be refused rather than incrementing ports or proceeding.
3. Replace source-regex owner-safety claims with deferred A→B and A→B→A behavior tests proving stale completion cannot publish, mutate, or clear the new owner's state. Keep source tests only for true architecture boundaries.
4. Parse every executable inline script from `index.html`, derive its SHA-256 token, parse `script-src`, and assert exact hash-set equality. Reject stale/duplicate/malformed hashes plus `'unsafe-inline'` and `'unsafe-eval'`; do not rotate a hash unless source changes.
5. Apply the approved Firebase CLI version to `package.json`, lockfile, `test:rules`, `.github/workflows/deploy-production.yml`, `.github/workflows/deploy-firestore-rules.yml`, `.github/workflows/migrate-legacy-shared-decks.yml`, and release tests. Add one repository-wide pin enumeration assertion, verify resolved `js-yaml` is fixed, and do not suppress audit or add an override unless the approved tree still needs it.
6. Apply the chosen shell labels consistently. Preserve user dirty edits and update docs only if the product-visible contract actually changes.
7. Run focused gates, then full verification in a cleanly owned server lifecycle. On port conflict, identify the owner; do not silently select another port or kill an unrelated process.

## Verification ladder

1. `git diff --check`
2. `node --test scripts/release-artifact.test.mjs scripts/release-workflows.test.mjs`
3. `npm run extension:check`
4. `npm run lint && npx vitest run`
5. `npm --prefix functions run lint && npm --prefix functions test && npm --prefix functions run build`
6. `npm run test:rules`
7. `npm run build && npm run verify:secrets && npm run verify:bundle`
8. `npm run test:e2e:chromium`, then full `npm run test:e2e` for Chromium/Firefox/WebKit
9. `npm run verify:audit`
10. `npm run verify`

## Release scenario matrix

| Scenario | Expected |
|---|---|
| Stale app already serves port 4173 | Harness refuses reuse or artifact-identity mismatch |
| Two local builds both report revision `local` | Artifact identities still differ |
| New build starts | Health artifact identity equals the exact requested build |
| Inline bootstrap changes or a stale hash remains | Exact-set CSP test fails until policy matches only derived hashes |
| Owner A request resolves after switch to B | No B-state mutation/publish |
| Approved Firebase install | One version across package/lock/scripts/workflows; no high audit |
| Desktop/mobile/E2E shell | Same approved labels and accessible names |

## Success criteria

- [x] Focused release contracts pass without copied constants or source-regex substitutes for behavior.
- [x] No stale process/artifact is accepted as E2E evidence.
- [x] Root and Functions audits have no high/critical finding.
- [x] All browsers, extension, Functions, rules/integration, build, secret, bundle, and release suites pass with no skipped/failed prerequisite reported as success.
- [x] Final `git status` lists only intended changes; user files remain preserved.

## Completion evidence

- Release contracts: 31/31 passed; the stale HTTP-200 server and local artifact-identity reproductions pass.
- Root Vitest: 195 files / 1704 tests; Functions: 234 passed with emulator-only suites subsequently exercised; Firestore rules: 61/61; emulator integrations: 21/21; extension: 136/136.
- Cross-browser E2E: 177/177 across Chromium, Firefox, and WebKit with no skips. Local workers are capped at four to avoid browser-engine starvation on shared machines.
- Build, secret scan, bundle budget, CSP exact-set checks, Firebase 15.29.0/js-yaml 4.3.2 resolution, and high/critical audits pass. Moderate transitive advisories remain visible and are not suppressed.
- `npm run verify` passed every executable quality gate through the audits. Its final `phase6:evidence --verified` attestation correctly rejected this intentionally dirty, uncommitted worktree with no release revision. Unattested evidence generation passed and remains `releaseEligible: false`; verified evidence must wait for a separately authorized clean commit/release workflow.

## Risks and rollback

- Lockfile/tool upgrades can alter emulator behavior. Retain the prior lockfile for comparison and keep package/script/workflow pins atomic.
- Shell label rollback must update runtime, docs, and tests together.
- Re-enable server reuse only through explicit artifact-identity-validated opt-in; never restore unconditional or revision-only local reuse.
