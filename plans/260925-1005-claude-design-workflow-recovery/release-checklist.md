---
title: "Release checklist and rollback artifact — task 13.6"
status: snapshot
---

# Release checklist and rollback artifact

Dated snapshot for phase 13 task 13.6, Asia/Saigon, captured 2026-09-27. This
file records one release event (the `feat/ui-redesign` branch reaching
staging) and how to roll it back. It does not replace the standing runbooks
that own the deploy *procedure*:

- [`docs/runbooks/vn-pilot-operations.md`](../../docs/runbooks/vn-pilot-operations.md) —
  staging prepare/deploy commands, W0/G1 gates, browser smoke, and the
  card-language backfill script.
- [`docs/runbooks/phase-6-rollout.md`](../../docs/runbooks/phase-6-rollout.md) —
  the protected production path (`release-candidate.yml` →
  `deploy-production.yml` / `deploy-firestore-rules.yml`) and its
  target-specific rollback steps.

Re-read those two before acting; this file only adds the pre-release gate
list, the production secret step, and a revision/rollback snapshot specific to
this release.

## 1. Pre-release gates (run in a clean worktree, before any deploy)

All commands are `npm run <script>` from the repo root; the canonical
definitions live in [`package.json`](../../package.json) `scripts` and
[`scripts/bundle-budget.mjs`](../../scripts/bundle-budget.mjs). Do not deploy
if any gate fails.

| Gate | Script | Notes |
|---|---|---|
| Typecheck | `lint` (`tsc --noEmit`) | |
| Unit/component tests | part of `verify:core` (`vitest run`) | |
| Functions lint/test/build | part of `verify:core` (`functions` workspace) | |
| Firestore/Functions rules tests | `test:rules` (part of `verify:core`) | runs against the `firestore`/`auth` emulators, project `demo-lingoflash` |
| Extension checks | `extension:check` | |
| Client build | `build` | |
| Bundle budget | `verify:bundle` | current thresholds in `DEFAULT_BUNDLE_BUDGETS`: initial JS ≤ 71,000 B gzip, initial CSS ≤ 29,500 B gzip — read the script for the full budget object, do not hand-copy other fields |
| i18n catalog check | `i18n:check` | |
| Chromium e2e | `test:e2e:chromium` (`playwright test --project=chromium`) | |

`predeploy:functions`, `predeploy:firestore` and `predeploy:hosting` already
run `verify:deploy` (`verify:core` + `npm audit`) automatically before any
Firebase CLI deploy in this repo — see `firebase.json`.

## 2. Staging hosting deploy and browser smoke

Follow [`vn-pilot-operations.md` § "Prepare and deploy staging"](../../docs/runbooks/vn-pilot-operations.md#prepare-and-deploy-staging)
for the exact command order (`staging:deploy:rules` →
`staging:deploy:functions` → `staging:deploy:hosting`, verifying the live
layer between each).

As of this snapshot, staging Hosting still serves the pre-redesign client
(see revision table below) even though staging Rules/Functions/indexes are
current. Run `staging:deploy:hosting` for this release, then do the owner
Google sign-in browser smoke described in the same runbook's W0 gate
(sign in → capture/create → edit → review, persisted card and meter
movement). Record the result in
[`plans/260923-2000-vn-ielts-paid-pilot/decision-log.md`](../260923-2000-vn-ielts-paid-pilot/decision-log.md),
never in this file.

## 3. Production secret creation (owner action)

Production (`encoded-hangout-433912-h2`) has no `ANALYTICS_PSEUDONYM_KEY`
secret. Every callable that pseudonymizes a uid (`requireUser()` in
[`functions/src/pilotOperator.ts`](../../functions/src/pilotOperator.ts) and
the shared-deck/purchase-intent/account callables) throws without it, so it
must exist **before** any production Functions deploy that includes those
callables.

The owner creates it directly — never through this agent, never printed or
read back:

```sh
firebase functions:secrets:set ANALYTICS_PSEUDONYM_KEY --project encoded-hangout-433912-h2
```

Confirm only that a version exists and is enabled (`firebase functions:secrets:access` output is *not* to be pasted anywhere); do not verify by reading the value.

## 4. Production deploy order

Production only ever moves through the protected GitHub Actions workflows —
confirmed in [`.github/workflows/deploy-production.yml`](../../.github/workflows/deploy-production.yml)
and [`deploy-firestore-rules.yml`](../../.github/workflows/deploy-firestore-rules.yml).
There is no local Firebase CLI production deploy in this repo. Order, per
`phase-6-rollout.md` §§1–4:

1. Push `feat/ui-redesign` to `main` (it is currently local-only — see
   revision table) and dispatch `Build release candidate` for the merged
   revision.
2. Complete the production secret step above if not already done.
3. Firestore Rules: dispatch the Rules workflow with `operation: cutover`
   against the sealed candidate, only after the compatible Functions/Hosting
   compatibility review.
4. Dispatch `Deploy production artifact`; set `promote_functions=true` only
   when Hosting depends on a new backward-compatible Function, per the
   recorded compatibility decision.
5. Never select or infer an all-target deploy; each target above is a
   separate protected dispatch.

## 5. Post-deploy verification

- Staging/production Hosting: `phase6:smoke` (`npm run phase6:smoke`) against
  the deployed origin, per `phase-6-rollout.md` §3.
- Functions: confirm the live function count and names match the deployed
  commit's `functions/src/index.ts` exports (no bare `--only functions` —
  it would delete the legacy `assessPronunciation` endpoint, which is live
  but absent from source).
- Rules: confirm the deployed digest matches the deployed commit's
  `firestore.rules`.
- Repeat the owner browser smoke on the newly deployed environment; a
  successful build or HTTP 200 is not smoke evidence.

## 6. Rollback

### Functions

Firebase has no built-in "redeploy previous revision" command. Rollback is:
check out the known-good commit in a clean worktree, run a real
`npm ci --ignore-scripts` (no symlinks) and `functions && npm run build`,
then redeploy using that commit's own explicit function list — read it from
that commit's `package.json` / `functions/src/index.ts`, never reuse the
current list against an older commit. Deploy in groups of at most 10
functions, same as the forward deploy. Staging commands:
`staging:deploy:functions:existing` / `:pilot` in `package.json`. Production:
`phase-6-rollout.md` §6.2 (redeploy the retained last-known-good candidate
with `promote_functions=true`, requires fresh Functions approval).

### Rules

- Staging: redeploy the prior commit's `firestore.rules` with
  `staging:deploy:rules`, or open the Firestore Rules tab in the Firebase
  console for `sonflash-staging-20260906` and publish an earlier ruleset
  from its history.
- Production: never use the normal deploy path for rollback. Dispatch
  `deploy-firestore-rules.yml` with `operation: rollback` and the retained
  last-known-good candidate (`phase-6-rollout.md` §6.3). A Rules rollback
  never mutates existing Firestore documents.

### Indexes

`firestore.indexes.json` at commit `e83cd4f` removed two single-field
composite index definitions (`normalizedWord`, `nextReviewDate` +
`__name__`) because Firestore rejects single-field composite indexes. Rolling
functions/rules back to a commit **before** `e83cd4f` and then redeploying
its `firestore.indexes.json` will reproduce that same rejected-index failure.
Pin any index rollback to `e83cd4f` or later, or drop the offending
single-field entries again by hand.

### Card-language backfill

Each `--apply` batch of
[`scripts/backfill-card-language.mjs`](../../scripts/backfill-card-language.mjs)
writes a timestamped JSON backup to `artifacts/backfill-card-language/`
before writing, gitignored, one entry per touched document as
`{ path, data }` — `data` is the full pre-write document snapshot. To
restore: for every entry in every `backup-*.json` file for the run being
undone, write `data` back to `path` in the same project/database (e.g. with
the Admin SDK or the Firebase console), restoring the document to exactly
its pre-backfill state. No restore script exists yet — this is a manual
per-document write-back until one is built. Keep the backup directory until
the restore (or the original backfill) is confirmed correct in the console,
then delete it; never commit it.

### Hosting

Firebase Hosting keeps a release history per site with no CLI rollback
command in this repo. In the Firebase console: Hosting → the target site →
Release History → pick the prior release → roll back from there. Do this for
staging (`sonflash-staging-20260906`) directly; for production, prefer the
protected `Deploy production artifact` workflow with the retained
last-known-good candidate (`phase-6-rollout.md` §6.1) so the rollback stays
inside the audited path.

## 7. Revision snapshot (2026-09-27, Asia/Saigon)

Stateful snapshot — re-verify before trusting it on a later date.

| Environment | Commit | Functions | Rules / indexes | Hosting | As of |
|---|---|---|---|---|---|
| Local (`feat/ui-redesign`, no upstream configured — not pushed) | `9ffd31c` (branch tip; includes `665ff57`, `0ede4eb`, `e83cd4f`) | 29 exported in `functions/src/index.ts` at this commit; not deployed | `firestore.rules`/`firestore.indexes.json` at this commit (single-field indexes already removed) | not deployed | 2026-09-27 10:49 +07 (HEAD commit time) |
| Staging (`sonflash-staging-20260906`) | `e83cd4f` | 29 from source + legacy `assessPronunciation` kept for compatibility = 30 live | Rules released at `e83cd4f`; indexes deployed (previously blocked by the single-field indexes fixed in the same commit) | **Old** client, revision `560bf21`, built 2026-09-24 08:36 UTC — not yet redeployed for this release | Functions/rules/indexes: 2026-09-27 ~10:30 +07 |
| Production (`encoded-hangout-433912-h2`) | pre-pilot revision, ~2026-09-22 (exact commit not confirmed) | 12 old functions | Old (pre-pilot) rules and client | Old client | Unchanged since ~2026-09-22; owner decision is to deploy later, together with the web client |

Card-language backfill ran once, on staging only, at commit `e83cd4f`: 3 of 4
scanned documents updated (`artifacts/backfill-card-language/checkpoint.json`
records `complete: true`). Production has not been backfilled.

## Checklist

- [ ] Pre-release gates (§1) green on the commit being released.
- [ ] Staging Hosting redeployed and owner browser smoke recorded (§2).
- [ ] Production `ANALYTICS_PSEUDONYM_KEY` created by the owner before any
      production Functions promotion that needs it (§3).
- [ ] Production deploy dispatched only through the protected workflows, in
      the order in §4.
- [ ] Post-deploy verification done on each newly deployed environment (§5).
- [ ] Rollback path for each target (§6) confirmed reachable *before*
      promoting, per the standing runbooks' "retain the last-known-good
      candidate" rule.
