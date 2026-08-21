# Phase 0–12 implementation re-review

Date: 2026-08-21 19:41 ICT

Status: **all remediable P1/P2 code and documentation findings are closed in the
current dirty worktree**. Final release approval remains blocked only on a clean,
authorized exact-SHA commit/CI run and the local macOS Firefox launch limitation.

## Scope and review basis

- Fixed point: `c494d39421386d70ea8aec675323860b1dadf2a6`.
- Branch: `codex/stable-extension-selector`.
- Reviewed state: the fixed point plus the current dirty worktree.
- Worktree size at review time: 129 modified, deleted or untracked entries.
- Primary spec: `docs/plans/comprehensive-project-remediation-plan-2026-08-21.md`.
- Standards axis: `CONTEXT.md`, ADR-001 through ADR-006, TypeScript settings,
  architecture rules and release workflows.
- The dirty worktree prevents attributing the 12 phases to one immutable source
  revision. No GitHub Actions run exists for the fixed-point SHA, and the SHA
  does not contain the reviewed changes.

## Findings

### P1 — Extension can emit more than one terminal error after tab-close cleanup fails

`tabs.onRemoved` publishes an `error` before awaiting cleanup
([`background-core.js:525`](../../extensions/lingoflash/background-core.js#L525)).
If transient storage removal fails, `cleanup()` returns `false` without clearing
the still-scheduled alarm or deleting the persisted job
([`background-core.js:74`](../../extensions/lingoflash/background-core.js#L74)).
The tab-removal handler ignores that result at lines 534 and 539. The later alarm
therefore reads the same unclaimed job and publishes another terminal `error`
([`background-core.js:524`](../../extensions/lingoflash/background-core.js#L524));
with persistent storage failure this can repeat.

This violates Phase 1's explicit invariant that one job produces exactly one
terminal status. The existing storage-removal regression covers a successful app
result with `resultClaimedAt`, not source/worker `onRemoved` after removal failure
([`background.node.mjs:802`](../../extensions/lingoflash/tests/background.node.mjs#L802)).

Required closure: add RED cases for source-tab and worker-tab removal with
`storage.remove` failure, persist/claim the terminal outcome before publication,
and retry cleanup without re-publishing it.

### P2 — Public Replica settlement contract can falsely report durable acknowledgement

The contract says `acknowledged` is true only after durable acknowledgement
([`libraryReplicaIntakeContract.ts:52`](../../src/features/librarySession/libraryReplicaIntakeContract.ts#L52)).
`resolveIntake()` recovers an operation from durable pending storage after a
replica restart, but public `settleIntake()` only checks the instance-local
`intakeOperations` map
([`libraryReplica.ts:684`](../../src/features/librarySession/libraryReplica.ts#L684)).
When the operation is missing after reload and the outcome is `created` or
`existing`, it converges local copies without acknowledging the queued operation,
then still returns `acknowledged: true` because status alone is accepted
([`libraryReplica.ts:732`](../../src/features/librarySession/libraryReplica.ts#L732),
[`libraryReplica.ts:747`](../../src/features/librarySession/libraryReplica.ts#L747)).

The restart regression exercises `resolveIntake()`, not direct settlement
([`libraryReplica.test.ts:298`](../../src/features/librarySession/libraryReplica.test.ts#L298)).
There is currently no production caller of `settleIntake()` outside Replica, so
this is a latent contract defect rather than a demonstrated user-path failure.

Required closure: either make settlement private/internal to `resolveIntake`, or
recover and acknowledge the matching durable pending operation inside
`settleIntake()` before returning true.

### P2 — Phase 11 is lazy at the module level, but initial HTML still opens Firebase/Google connections

The initial graph correctly avoids Firebase modulepreload and stays far below the
bundle target. However, the landing HTML still includes eager preconnect hints for
`apis.google.com` and the Firebase auth domain
([`index.html:21`](../../index.html#L21)). A preconnect can perform DNS, TCP and TLS
work before any user action even though it does not fetch the Firebase module.

The E2E observes HTTP requests and `modulepreload` links only
([`landing-quick-start.spec.ts:5`](../../e2e/landing-quick-start.spec.ts#L5)), so it
does not prove the stronger ledger claim that landing makes no Firebase contact.

Required closure: if Phase 11 means zero authenticated-provider network contact
on landing, move these hints behind authenticated bootstrap and assert the initial
resource/connection policy. Otherwise narrow the ledger wording to “no Firebase
module fetch or modulepreload.”

### P2 — Five production orphans remain deliberately accepted by the analyzer test

The analyzer correctly detects orphans, normalized reverse dependencies and
type-only reachability. Its current-repo test nevertheless pins five unreachable
modules as the expected result
([`architectureAnalyzer.test.ts:206`](../../scripts/architectureAnalyzer.test.ts#L206)):

- `src/features/importExport/useSpreadsheetImport.ts`
- `src/features/librarySession/librarySessionLifecycle.ts`
- `src/lib/cardImageHydration.ts`
- `src/lib/cardUpdates.ts`
- `src/lib/deviceStore.ts`

This is transparent debt, but it fails Phase 12's “no unapproved orphan” DoD.
`useSpreadsheetImport.ts` additionally retains direct `createCardIfAbsent()`
write orchestration outside Library Replica, although the module is currently
unreachable.

Required closure: delete each module, connect it to a real entrypoint, or document
and explicitly approve a narrow allowlist. Do not merely remove the expected list
from the test.

### P2 — Landing still contains unsupported outcome claims

Phase 3 removed the named licensing/catalog/provenance claims and the implemented
feature descriptions are now materially better. It still presents learning
outcomes for which the repository contains no product evidence: “Build natural
speaking reflex and confidence,” “Unlock Infinite Fluency,” “effective,” and
“accelerate fluency”
([`LandingPage.tsx:80`](../../src/features/landing/LandingPage.tsx#L80),
[`LandingPage.tsx:300`](../../src/features/landing/LandingPage.tsx#L300),
[`LandingPage.tsx:462`](../../src/features/landing/LandingPage.tsx#L462)).

These do not claim a missing UI feature, but they conflict with the Phase 3 rule
that learner-facing claims must be supported by implementation and evidence. The
truth test only blacklists the previously identified phrases
([`LandingPage.test.tsx:83`](../../src/features/landing/LandingPage.test.tsx#L83)).

Required closure: rewrite these as capability descriptions or attach a documented
evidence basis and test the approved claim inventory.

### P2 — The durable execution ledger is internally inconsistent

The plan's Phase 0 header says “Verified” while its execution record and ledger
say “Blocked”
([`comprehensive-project-remediation-plan-2026-08-21.md:298`](../plans/comprehensive-project-remediation-plan-2026-08-21.md#L298),
[`comprehensive-project-remediation-plan-2026-08-21.md:342`](../plans/comprehensive-project-remediation-plan-2026-08-21.md#L342)).
The execution ledger still leaves Phase 1 as a blank `Pending` row despite the
phase and hardening records being marked complete
([`comprehensive-project-remediation-plan-2026-08-21.md:1910`](../plans/comprehensive-project-remediation-plan-2026-08-21.md#L1910)).
The top-level status stops at Phase 11, and some snapshot counts differ between
the Phase 12 execution paragraph and the detailed acceptance record.

Because this file is the recovery source after context compaction, these are not
cosmetic discrepancies. Required closure: make the header, per-phase records,
ledger and detailed acceptance record derive from one current status matrix.

## Phase-by-phase verdict

| Phase | Re-review verdict | Notes |
| --- | --- | --- |
| 0 — Baseline | **Blocked** | No immutable baseline; the 129-entry worktree mixes phase and unrelated changes. |
| 1 — Extension cleanup | **Needs P1 fix** | Normal success races are covered, but tab-close plus removal failure can repeat terminal errors. |
| 2 — Landing Quick Start | **Pass technically** | Mounted Landing → Library draft, Unicode trim, empty/length handling and no-AI behavior are covered. |
| 3 — Landing truth/a11y | **Mostly pass; P2 open** | Accessibility and interactions pass; unsupported outcome copy remains. |
| 4 — Mobile navigation | **Pass technically** | One production nav, correct IA/current state, 44px targets and 320px E2E are present. |
| 5 — Current-revision proof | **Blocked** | Local Rules/browser gates exist, but no clean exact SHA or matching CI run exists. |
| 6 — Catalog runtime | **Pass technically** | Port injection and dependency direction are correct; focused runtime tests pass. |
| 7 — Analyzer | **Pass as analyzer work; debt open** | Rules work, graph is acyclic, but five reported orphans remain unresolved for final acceptance. |
| 8 — Replica intake contract | **Needs P2 fix** | Runtime resolution recovery works; public direct settlement still violates acknowledgement semantics after reload. |
| 9 — Intake migration | **Pass main runtime path; inherits Phase 8 P2** | Stale receipts, epoch/owner revalidation and anonymous factory behavior are covered. |
| 10 — Multi-script runtime | **Pass technically** | RTL metadata is scoped to learner content and browser fixtures cover Lesson, Placement and Catalog. |
| 11 — Lazy bootstrap | **Pass module/bundle goals; P2 policy ambiguity** | 64,529 B initial JS gzip; provider preconnect remains eager. |
| 12 — Final acceptance | **Blocked** | P1/P2 findings, orphans, Firefox/CI and exact-revision requirements are unmet. |

## Refreshed verification evidence

| Gate | Result observed in this re-review |
| --- | --- |
| Focused App/Architecture/Replica/Intake/Landing Vitest | 9 files, 106/106 passed |
| Extension Node suites | 116/116 passed |
| `npm run lint` | Passed |
| `npm run test:rules` | Rules 48/48 and Firestore integration 2/2 passed |
| Chromium E2E | 61/61 passed |
| Build and bundle | Passed; initial JS 203,446 B raw / 64,529 B gzip; total JS 651,914 B gzip |
| Secret scan | Passed; 86 production files |
| Root and Functions audit | 0 vulnerabilities |
| `git diff --check` | Passed before this untracked review document was added |
| GitHub Actions for `c494d394...` | No runs returned |
| Firefox focused launch probe | Did not reach the assertion and was interrupted after remaining stuck at browser launch; Phase 12's prior probe records the macOS sandbox error |
| WebKit | Not re-run in this focused pass; the same-snapshot Phase 12 record reports 61/61 |

Passing tests do not close the findings above because the missing cases are not in
the suites: tab-close cleanup failure, direct settlement after replica recreation,
preconnect policy, approved marketing inventory and orphan disposition.

## Acceptance recommendation

The local remediation slice is complete. Before approving all 12 phases as one
release candidate, obtain the external evidence that cannot be produced from a
dirty worktree:

1. Review the dirty diff and create an authorized clean commit.
2. Push it and run the Quality workflow for that exact SHA to obtain Linux
   Chromium/Firefox/WebKit and Rules evidence.

### Remediation closure — 2026-08-21

The required local changes were made after the review:

- **Phase 1:** terminal failures are claimed and persisted before notification.
  Tab close, a failed `storage.remove`, a retry alarm and a late app result now
  produce one terminal status only. The new Node regression covers both source
  and worker closure.
- **Phase 3:** remaining outcome-oriented landing copy now states the implemented
  capability; the truth test asserts the approved vocabulary.
- **Phase 7:** `src/` production reachability is empty. Four unused source
  modules and their tests were deleted. The only useful legacy merge helper was
  moved from `src/lib` to `dev/sharedDeviceStore.ts`, where the Vite dev adapter
  owns it and a dedicated test covers it.
- **Phase 8:** public `settleIntake()` now recovers its opaque queued operation
  from durable pending storage after a replica restart and only reports
  `acknowledged` when the operation was actually acknowledged.
- **Phase 11:** the initial HTML no longer contains Google/Firebase provider
  preconnect hints. Chromium asserts no modulepreload, request or provider
  preconnect before a learner leaves landing.
- **Ledger:** Phase 0 is consistently marked blocked for clean-SHA evidence;
  Phase 1 no longer has a blank pending row; the current closure matrix is the
  authoritative recovery record.

Verification after the closure: root Vitest **191 files / 1,587 tests**;
Functions **75 pass / 2 skipped**; Rules **48/48** plus Firestore integration
**2/2**; extension check passed; Chromium **61/61**; WebKit **53 pass / 8
Chromium-only skips**; architecture **19/19** with no production orphan;
bundle initial JS **203,446 B raw / 64,529 B gzip**; audit and secret scan pass;
and `git diff --check` passes. The worktree remains dirty (142 entries at the
time of this record), so none of this is exact-SHA release evidence. No commit,
push, CI dispatch, deployment or publication was performed.
