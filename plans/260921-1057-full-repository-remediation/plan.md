---
title: "Full repository remediation"
description: "Dependency-ordered remediation plan for the accepted OpenCodeReview repository audit findings."
status: complete
priority: P0
effort: "large / 8 phases"
tags: [open-code-review, remediation, data-integrity, accessibility, release]
created: 2026-09-21
---

# Full repository remediation

## Outcome

Resolve every accepted repository-wide OpenCodeReview finding without losing existing user work, changing established product contracts silently, or weakening tests. The work is complete only when the data model preserves multilingual lexeme identity, review and sync paths are race-safe and idempotent, all practice modes work accessibly, extension timeouts match backend behavior, and the release suite passes against the exact build under test.

## Constraints and non-goals

- Preserve the current dirty worktree. Before implementation, save a patch/status snapshot and reconcile each overlapping file instead of replacing it.
- Keep public and persisted contracts backward compatible unless a decision gate below explicitly authorizes a change.
- Prefer existing primitives: `createLexemeId`, the current XP port, practice lifecycle ownership, overlay focus scheduling, and existing extension metadata scope/retirement.
- Do not bulk re-key or delete legacy cards. Identity additions must be additive and old metadata-free cards must remain readable.
- Do not implement the rejected browser legacy-migration concern or privileged loopback Shared Device Store impersonation concern; current docs make those operator/threat-model boundaries explicit.
- Do not add another extension metadata cache. Current owner-scope/session-storage behavior is verified first and changed only if a regression test proves a remaining delivery race.
- Do not commit, push, deploy, mutate production data, or remove indexes as part of implementation without separate authorization.

## Resolved decision gates

The implementation uses the following compatibility policies. These choices preserve the current documented/runtime behavior while closing the verified failure modes.

| Decision | Selected policy | Affected phases |
|---|---|---|
| Shell labels | Keep the documented `Today / Paths / Vocabulary` contract and reconcile dirty E2E expectations to it | 1, 8 |
| Firebase CLI | Upgrade all repository pins to `firebase-tools@15.29.0`, refresh the lockfile, and require `js-yaml >=4.3.2` | 1, 8 |
| Daily boundary | Keep a documented UTC calendar-day boundary; do not describe it as learner-local | 2 |
| Review timestamps | After exact duplicate-receipt handling, require `reviewedAt > authoritative lastReview`; allow at most five minutes of future clock skew and return a typed stale/clock-skew result without writing | 3 |
| Durable receipt retention | Keep owner-scoped, fingerprinted receipts for 30 days using authoritative timestamps and TTL metadata; strict monotonic guards make post-expiry replay harmless | 3, 5 |
| Legacy shared-deck callers | New clients always send `opId`; accept missing `opId` through 2026-12-31 only, then reject it explicitly | 5 |
| Playwright server reuse | Disable by default; explicit opt-in requires an exact per-artifact identity in `dist/health.json` | 8 |

## Dependency map

```text
Phase 1 contract/baseline
  → Phase 2 identity/daily boundary
  → Phase 3 review/FSRS
  → Phase 4 owner/sync/mirror
  → Phase 5 backend indexes/idempotency
  → Phase 6 practice/UI/accessibility
  → Phase 7 extension lifecycle
  → Phase 8 release contracts and full verification
```

Execute phases sequentially (`1 → 2 → 3 → 4 → 5 → 6 → 7 → 8`). Persistence, rules, mirror, and dirty UI files have deliberate ownership handoffs, so parallel editing would make compatibility rollout and evidence ambiguous.

## Phases

| # | Phase | Purpose | Status |
|---|---|---|---|
| 1 | [Contract decisions and protected baseline](./phase-01-start.md) | Reconcile dirty edits, lock product policies, and capture trustworthy baselines | Complete |
| 2 | [Lexeme identity and daily boundary](./phase-02-lexeme-identity-and-daily-boundary.md) | Preserve language/POS/sense identity across compatibility flows | Complete |
| 3 | [Review scheduling and FSRS](./phase-03-review-scheduling-and-fsrs.md) | Enforce chronological reviews and safe FSRS domains | Complete |
| 4 | [Owner, sync, and mirror concurrency](./phase-04-owner-sync-and-mirror-concurrency.md) | Make epoch, mirror generations, and flush leases monotonic and owned | Complete |
| 5 | [Backend queries and idempotency](./phase-05-backend-query-and-idempotency.md) | Add required indexes and durable operation receipts | Complete |
| 6 | [Practice UI and accessibility](./phase-06-practice-ui-and-accessibility.md) | Restore all practice modes, scoring, lifecycle, keyboard, audio, and target behavior | Complete |
| 7 | [Extension lifecycle and timeouts](./phase-07-extension-lifecycle-and-timeouts.md) | Align extension timing and verify owner-scoped metadata cleanup | Complete |
| 8 | [Release contracts and full verification](./phase-08-release-contracts-and-verification.md) | Bind tests to the correct build, derive CSP, resolve dependency audit, and run all gates | Complete |

## Finding coverage

| Finding | Resolution phase |
|---|---|
| Match/Shadowing blank route | 6 |
| Language/POS/sense collapsed to word identity | 2 |
| Study shortcuts hijack controls / dead selector path | 6 |
| Match/Shadowing XP not wired | 6 |
| Word Match fixed denominator | 6 |
| Remaining controls below 44px | 6 |
| Undo toast expires while engaged | 6 |
| Shadowing/Active Recall/TTS cleanup missing | 6 |
| Out-of-order review throws instead of an explicit chronological conflict | 3 |
| Recap opens before final review persistence | 3 contract + 6 UI |
| Invalid/fractional FSRS values reach `ts-fsrs` | 3 |
| Same-owner epoch can move backward locally | 4 |
| Card mirror generation race | 4 |
| Flush lease lacks ownership token | 4 |
| IndexedDB open can hang on `blocked` | 4 |
| Missing Firestore composite indexes | 5 |
| Facet receipt eviction permits replay | 5 |
| Shared-deck create is not idempotent | 5 |
| Extension bridge/job timeout is below backend budget | 7 |
| Extension deck metadata can appear stale | 7 verification gate; fix only on failing delivery-race proof |
| Local Playwright can reuse stale port 4173 | 8 |
| Owner-safety test relies on source regex | 8 |
| CSP test does not derive the inline-script hash | 8 |
| Vulnerable `js-yaml` through Firebase CLI | 8 |
| Dirty shell-label and Firebase-version contracts disagree with source | 1 decision + 8 reconciliation |
| UTC daily pivot has no confirmed product contract | 1 decision + 2 implementation |

## Cross-phase scenario matrix

| Scenario | Required result | Primary evidence |
|---|---|---|
| Same spelling across language/POS/sense | Distinct logical cards and learning state | Unit + catalog/daily/device/mirror tests |
| Existing metadata-free card | Reads and syncs without re-keying | Compatibility and persistence tests |
| Older review arrives after newer review | No state/history write; explicit conflict | Client, Functions, rules/emulator tests |
| Invalid FSRS boundary values | Reject or documented legacy fallback; never crash scheduler | Shared matrix on client and Functions |
| Old mirror generation finishes after new begin | Cannot delete/complete new generation | Deterministic IndexedDB interleaving test |
| Expired lease owner releases late | Cannot remove successor lease | Two-owner lease test |
| Facet/share response is lost then retried | One mutation/share and same result | Transaction + emulator integration tests |
| Match/Shadowing launched and completed | Nonblank UI; XP once; correct totals | Component + three-engine E2E |
| User focuses/hover Undo | Timer pauses and resumes predictably | Fake-timer + browser focus test |
| Practice unmounts during audio/recognition | Media and callbacks stop; no late XP | Unit + browser fallback tests |
| Extension uses compatibility fallback | Deadline covers backend retry budget; job remains alive | Node extension suite |
| Existing stale preview runs on 4173 | Test refuses reuse unless exact artifact identity matches | Stale-server reproduction |
| Inline bootstrap changes or stale hash remains | CSP contract fails until hash sets match exactly | Release source test |

## Global success criteria

- [x] Every finding-coverage row and accepted red-team correction has a passing regression test or a documented verification-only disposition.
- [x] No current dirty change is silently discarded; overlapping edits are merged deliberately.
- [x] Root lint/unit, Functions lint/test/build, Firestore rules and integration, extension checks, production build, secret scan, bundle budget, audits, and release tests pass.
- [x] Chromium, Firefox, and WebKit E2E pass against the exact newly built artifact identity; no reused stale server is accepted.
- [x] `npm audit --audit-level=high` and the Functions audit pass without suppressions.
- [x] No data migration, deployment, commit, or push is performed without separate user authorization.

## Risk and rollback summary

- Identity changes are additive; rollback stops writing new metadata but continues reading it. Never bulk re-key cards.
- Scheduling/rules changes ship only after client/server boundary matrices agree; rollback preserves old-card fallback.
- Mirror and lease changes are local-only and must fail closed to resync, never promote an incomplete mirror.
- Before any Firestore schema/rules/index rollout, take a project export/backup, record its location, and verify restore access. Indexes are additive and remain in place on rollback.
- Receipt writes must be atomic with their mutation. If atomicity cannot be proven in emulator tests, do not deploy that phase.
- UI/extension/release changes can be reverted independently after their focused suites pass.

## Validation Log

### Session 1 — 2026-09-21

**Trigger:** Repository-wide OpenCodeReview audit and user request for a complete remediation plan.

**Evidence:** OCR inventory covered 672 repository files (330 directly reviewable, 342 manually inventoried/excluded by format or review defaults), followed by domain reviews, focused suites, full Chromium E2E, build/audit checks, and targeted source verification.

**Pending questions:** the seven decision gates above. Until answered, this plan is implementable only through tests and code paths unaffected by those gates and is not ready for an unconditional `/ak:cook` handoff.

### Session 2 — 2026-09-21

**Trigger:** User authorized full implementation and asked to set an execution goal.

**Decisions:** The seven gates are resolved in the table above. UTC preserves the current cross-device deterministic day contract because the product has no authoritative learner-timezone profile. Five-minute future skew reuses the repository's existing bounded-skew convention. Thirty-day receipts match the established shared-deck lifetime and keep retry semantics explicit. The legacy no-`opId` window ends on 2026-12-31.

**Protected baseline:** Branch `fix/apple-device-performance`, HEAD `067b2a24e3b327aac48ce8594db99b6d656b7de1`. Dirty file paths and SHA-256 content hashes are recorded in `../reports/baseline-260921-1837-full-repository-remediation.md`; no stash, reset, clean, commit, push, or deploy was performed.

**Database safety:** The configured project is `encoded-hangout-433912-h2` and the configured database is `ai-studio-945b4052-4462-4668-8936-277f09f07a37`. This host does not have `gcloud`, so a production Firestore export cannot be created or restore-verified here. This execution changes repository code and additive manifests only; it must not deploy or mutate live data. A verified export remains a hard rollout gate before any production schema/index/rules activation.

**Baseline checks:** `git diff --check`, root lint, Functions lint/tests/build passed. Functions reported 211 passed and 19 skipped; the skipped integration suites remain unverified. Extension checks reproduced the 38-second versus 135-second timeout failure. Release checks reproduced the 15.23.0 versus 15.29.0 pin mismatch, and direct `node --test` execution of the Vitest artifact test is invalid and remains a release-runner contract to fix. Root audit reproduced one high `js-yaml` advisory; Functions audit and the package checker after failed `&&` commands remain unresolved rather than passed.

### Full-tier verification results

- Tier: Full (8 phases; Fact Checker, Flow Tracer, Scope Auditor, Contract Verifier).
- Claims checked: at least 120 path/symbol/flow/contract claims across the phases.
- Initial failures: 20 consolidated red-team findings; 17 accepted and propagated, 3 rejected with source evidence.
- Final structural checks: all cited local file paths exist, AgentKit validation passes, `git diff --check` passes for the plan, and superseded terms/paths are absent.
- Product choices: the seven decision gates were resolved in Session 2 before implementation.

### Session 3 — 2026-09-21

**Outcome:** All eight implementation phases are complete. Independent Phase 6 review passed after the speech enqueue race, production-shipped test harness, full two-layout target matrix, stale class assertion, and high-parallelism browser contention were resolved.

**Final verification:** Root lint and 1704/1704 Vitest tests passed; Functions lint/build and 234 tests passed; Firestore rules 61/61 and emulator integrations 21/21 passed; extension 136/136 passed; release contracts 31/31 passed; production build, secret scan, bundle budget, and high/critical audits passed; cross-browser E2E passed 177/177 with no skips.

**Release boundary:** No commit, push, migration, deployment, or production data mutation was performed. Verified release evidence intentionally remains blocked because the worktree is uncommitted and dirty, and production rollout still requires a verified Firestore export/restore path, deployed index readiness, and TTL policy configuration/readback.

### Session 4 — 2026-09-22

**Trigger:** The user required a complete repository review through Alibaba OpenCodeReview, full remediation, and independent re-review.

**Coverage:** OpenCodeReview v1.12.8 Delegation Mode reviewed all 376 reviewable files across eight non-overlapping manifests. The delegated review accepted 33 P1/P2 findings; independent staged-diff review and re-review added nine failure paths. All accepted findings are fixed. The final correctness and security/data-integrity reviews found no remaining P0/P1/P2 issue. Full evidence is recorded in [the OpenCodeReview delegation report](../reports/open-code-review-delegation-260922.md).

**Final verification:** Root lint and 2,257/2,257 Vitest tests passed; Functions lint/build and 275 unit tests passed; Firestore Rules passed 61/61 and emulator integrations passed 23/23; extension checks passed 149/149; production build, secret scan, bundle budget, and high/critical audits passed. The final cross-browser run passed 227 tests with 16 intentional engine-specific skips and zero failures.

**Release boundary:** The integration worktree remains staged and uncommitted. No commit, push, pull request, deployment, production-data mutation, or index removal was performed. Production still requires an approved and retention-locked export destination, a verified Firestore export/restore, authenticated IAM/gcloud access, TTL policy activation/readback, additive index readiness, protected-workflow approval, and an authorized release candidate.

## Red Team Review

### Session — 2026-09-21

**Findings:** 20 consolidated (17 accepted, 3 rejected as stale or contradicted by source)

| # | Finding | Severity | Disposition | Applied to |
|---|---|---|---|---|
| 1 | Authoritative persistence/rules still enforce word-only identity | Critical | Accept | Phase 2 |
| 2 | Identity is dropped by catalog, import/export, sharing, intake, and pending-overlay consumers | High | Accept | Phase 2 |
| 3 | Learning persistence swallows review conflicts before Study can decide | Critical | Accept | Phases 3, 6 |
| 4 | Review receipts are bounded and equal timestamps can double-apply | High | Accept | Phase 3 |
| 5 | New review conflict reasons need mixed-version rollout | High | Accept | Phase 3 |
| 6 | Lease authority and IndexedDB fallback schema were omitted | High | Accept | Phase 4 |
| 7 | Timed-out IndexedDB open needs late-success close | Medium | Accept | Phase 4 |
| 8 | Reachable Firestore query signatures were under-specified | High | Accept | Phase 5 |
| 9 | Receipt TTL/expiry semantics were not implementable | High | Accept | Phases 3, 5 |
| 10 | Shared-deck `opId` lifecycle and rate-limit idempotency were omitted | High | Accept | Phase 5 |
| 11 | Audio cancellation omitted callers/ownership | High | Accept | Phase 6 |
| 12 | Extension deadline needed a full-path formula | High | Accept | Phase 7 |
| 13 | Local `revision: local` cannot identify an exact E2E artifact | High | Accept | Phase 8 |
| 14 | CSP membership allows stale hashes | Medium | Accept | Phase 8 |
| 15 | Workflow inventory names were wrong | High | Reject | Corrected to actual workflow paths before adjudication |
| 16 | Deploy-gate test path was wrong | Medium | Reject | Corrected to root `deployGateSource.test.ts` before adjudication |
| 17 | Two-attempt extension budget is unsupported | Medium | Reject | `src/lib/gemini.ts` owns two 65-second attempts; the bridge fallback submits through that UI path |
| 18 | Offline replica verification still reconciles by word and can delete a distinct sense | Critical | Accept | Phase 2 |
| 19 | `durably-queued` review needs provisional-effect reconciliation | High | Accept | Phases 3, 6 |
| 20 | Mixed-version review rollout must prevent old-client optimistic success, not only crashes | High | Accept | Phase 3 |

### Whole-plan consistency sweep

- Files reread: `plan.md` and all eight `phase-*.md` files.
- Decision deltas checked: strict review chronology, authoritative identity/replica paths, provisional offline review reconciliation, versioned review rollout, receipt lifetime, lease wire contract, share retry owner, audio owners, extension formula, exact build identity, and CSP exact hash set.
- Superseded references reconciled: workflow names and root deploy-gate test path.
- Unresolved contradictions: the seven explicit decision gates only.

<!-- slug: full-repository-remediation -->
