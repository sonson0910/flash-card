---
title: "Phase 1: Contract decisions and protected baseline"
status: complete
---

# Phase 1: Contract decisions and protected baseline

## Overview

Protect the existing dirty worktree, turn ambiguous audit observations into explicit product/compatibility policies, and establish a reproducible failing baseline. This phase changes no product behavior until the decision gates are recorded.

## Requirements

- [x] Preserve every pre-existing modified/untracked file; implementation begins from an explicit status and content-hash snapshot.
- [x] Resolve shell labels, Firebase CLI version, daily timezone, review clock policy, receipt retention, shared-deck compatibility, and Playwright reuse.
- [x] Treat a skipped, unavailable, timed-out, or parser-failed check as unresolved, never passing.

## Files to inspect or reconcile

| Path | Purpose |
|---|---|
| `docs/specs/sonflash-memory-atelier-ui-upgrade.md` | Current documented shell-label contract |
| `docs/specs/multilingual-learning-platform.md` | Canonical multilingual boundaries |
| `docs/specs/practice-session-lifecycle.md` | Practice persistence/ownership contract |
| `package.json`, `package-lock.json` | Firebase CLI and audit state |
| `e2e/accessibility.spec.ts`, `e2e/app-shell-remediation.spec.ts`, `e2e/app.spec.ts`, `e2e/catalog-workspace.spec.ts`, `e2e/phase5-learning.spec.ts` | Dirty label/accessibility expectations |
| `extensions/lingoflash/tests/app-bridge.node.mjs` | Dirty extension timeout contract |
| `scripts/release-artifact.test.mjs`, `scripts/release-workflows.test.mjs` | Dirty release version contract |
| `src/components/Flashcard.tsx`, `src/components/Flashcard.test.tsx`, `src/components/ui/UndoToast.tsx`, `src/components/ui/UndoToast.test.tsx` | Existing in-progress UI fixes to merge, not overwrite |

## Implementation steps

1. Record `git status --short`, HEAD, branch, `git diff --check`, and separate diffs for all overlapping files. Do not stash, reset, clean, or revert.
2. Record the seven decisions in `plan.md`'s validation log. If any answer changes scope, update every affected phase before coding. Completed in Session 2.
3. Reproduce the current focused failures: dirty shell labels, extension timeout, release Firebase version, and `npm audit`.
4. Record the already-green baselines (Functions, rules/integration, build, secret/bundle checks) and the Chromium result. Do not claim Firefox/WebKit until run.
5. Before production rollout of the Phase 2 schema or Phase 5 receipt/index infrastructure, create a Firestore export/backup, record its project/location/retention, and prove the operator has restore access. This code-only execution must not deploy or mutate live data; the missing `gcloud` client keeps export/restore evidence as an explicit rollout blocker rather than falsely claiming a backup.
6. Assign one phase owner at a time; implementation follows the sequential phase chain because persistence/rules files are handed off between phases.

## Test matrix

| Check | Expected baseline |
|---|---|
| `git diff --check` | Pass |
| `npm run lint` | Pass |
| `npm --prefix functions run lint && npm --prefix functions test && npm --prefix functions run build` | Pass |
| `npm run test:rules` | Pass only if emulator completes |
| `npm run test:e2e:chromium` | Known dirty label failures documented |
| `npm run extension:check` | Known timeout contract failure documented |
| `node --test scripts/release-workflows.test.mjs scripts/release-artifact.test.mjs` | Known Firebase-version contract failure documented |
| `npm run verify:audit` | Known root `js-yaml` high advisory documented |

## Success criteria

- [x] All decisions are explicit, with rationale and compatibility window where applicable.
- [x] Current user edits are recorded by path/content hash and every overlap has an owner.
- [x] The baseline distinguishes product defects from dirty-contract mismatches.
- [ ] A restorable Firestore export is recorded before any schema/data rollout. Blocked on the absent `gcloud` client; no rollout or live mutation is authorized in this execution.
- [x] Phase 2–8 requirements contain no contradiction with the recorded choices.

## Risks and rollback

- Main risk: mistaking uncommitted user intent for disposable test drift. Mitigation: no reversion; choose the product contract first.
- This phase is documentation and evidence only. Rollback is removal of the plan-generated records, not modification of application files.
