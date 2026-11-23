# Phase 11: Staging verification, go gates, pilot operations

Effort: 2d of development (W0 staging setup 0.5-1d, budgeted at 1d, red team #8; runbook and gate
preparation 1d), plus about 1.5d of operations over the pilot (about 30 minutes per gate and 10
minutes per day), counted separately from the development total (red team #9). Blocked by: each
release; the staging setup blocks every G1 step. Release: all.

## Context

- The owner asked that nothing reach production without an explicit go. Existing release discipline:
  `predeploy:*` scripts run `verify:deploy` (`package.json` scripts), and the release runbooks in
  `docs/runbooks/phase-6-rollout.md` and `docs/runbooks/security-remediation-rollout.md`.
- **No staging deploy target exists in the repo (red team #8).** `.firebaserc` has only
  `"default": "encoded-hangout-433912-h2"`. The production project and database are sealed in
  `firebase-applet-config.json` (`projectId`, `firestoreDatabaseId`
  `ai-studio-945b4052-4462-4668-8936-277f09f07a37`), `functions/src/runtime-target.json` (imported at
  `functions/src/index.ts:10`, database id at `:97`) and the release artifact check
  (`scripts/release-artifact.mjs:10`). The staging project `sonflash-staging-20260906` exists (cost
  audit) but no staging smoke has ever run from this repo.
- Production uses a **named** Firestore database, so every TTL command needs `--database`
  (red team #14).
- Tailwind v4 compiles one CSS file with about 1.5 KB gzip headroom left; lazy JS chunks do not
  reduce it (red team #14).
- Config values live in `_serviceConfig/pilot` (phase 01) and are edited by the owner.

## Requirements

1. **W0 staging setup (0.5-1d, before any G1 step; red team #8):** a `staging` alias in
   `.firebaserc`; a sealed staging target (staging values for the project, database id and runtime
   target, selected explicitly at build and deploy time, and accepted by the release artifact
   check) without changing any production value; a reCAPTCHA Enterprise key for the staging
   hosting domain registered in App Check; the staging domain in Firebase Auth authorized domains;
   staging secrets (Gemini key, `ANALYTICS_PSEUDONYM_KEY`); and one staging smoke (sign in, capture
   one word, review one card) recorded in the decision log.
2. **Runbook** `docs/runbooks/vn-pilot-operations.md`: staging and production targets, gate
   checklists, deploy order, rollback commands, daily checks, incident responses. Link it from
   `README.md`.
3. **Gate checklist (every gate):** `npm run verify:core`, `npm run verify:bundle` including the CSS
   size against its budget, `npm run extension:check` if the extension changed, the gate's phase
   validations on staging, the owner's written go in the decision log, then deploy in the order
   rules → functions → hosting, confirming each is live before the next (expand/contract for
   `operationId` and `origin`, red team #4), and a production smoke (sign in, capture one word,
   review one card, meter moves).
4. **Rollback order:** hosting → functions → rules, and never to a functions or rules artifact that
   rejects a field the live hosting release sends (`operationId`, `origin`). Effective config rollbacks
   come first where they exist (`quotaEnforced`, caps, allowances, `analyticsEnabled`); `serverReviewXp`
   remains inert while phase 09 is deferred.
5. **TTL commands (red team #14).** Run per target with its project and database:
   `gcloud firestore fields ttls update expiresAt --collection-group=<group> --enable-ttl --database=<database-id> --project=<project-id>`,
   then paste the output of
   `gcloud firestore fields ttls list --database=<database-id> --project=<project-id>` into the
   decision log as gate evidence. Groups: `ai_operations`, `ai_cost_ledger` and `card_reports` (180 days, owner 2026-09-24) at G1,
   `analytics_events` at G2b, `account_tombstones` at G3.
6. **G1 extras (09-29/30):** staging setup and smoke done; the owner-accepted 2026-09-24 exception
   replaces the unavailable key-level Gemini quota with the app's $5/day cap and a monthly budget
   alert on the shared Gemini billing project. The alert warns but does not cap spending; other
   keys in that project bypass the app cap. Record this residual risk at the gate; enable TTL for
   `ai_operations` and `ai_cost_ledger`; `_serviceConfig/pilot` created with the measured Pro quota
   and the non-card allowances; spend cap and account share proven on staging; privacy page
   reviewed by the owner.
7. **G2 extras (10-02):** operator grant and revoke on the owner's production account; **one
   `purchase_intent` recorded on production**; `displayPriceVnd` set from the accountant's answer;
   terms page reviewed; the operator refuses an unknown target.
8. **G2b extras (10-07):** phase 05 live; TTL for `analytics_events`; `_serviceConfig/pilotExclusions`
   filled; 20 staging events checked for private text.
9. **G3 extras (10-14):** deletion tried on a throwaway production account with a second signed-in
   browser; XP replay check with the previous hosting release; TTL for `account_tombstones`.
10. **Daily operations (W1-W3, 10 minutes):** cost report for yesterday (spend, calls, mean and p95
    cost per card, timeouts, top accounts by spend), refusals by reason (card quota, daily
    allowance, account spend, service cap), open `card_reports`, capture failure rate, reservations
    refunded by the sweeper, tombstones not `done`. Weekly: run the metrics operator and append the
    numbers to the decision log.
11. **Decision log** `plans/260923-2000-vn-ielts-paid-pilot/decision-log.md`: staging smoke, measured
    cost per card and the resulting Pro quota, each gate's go with TTL evidence, config changes with
    date and reason, operator grants summary, and the 10-23 decision (continue, fix, or change ICP)
    with the metric table.
12. **Budget alarms:** a Cloud Billing budget alert for the Gemini billing project at the owner's
    chosen level (520,000 VND/month, about $20, delivered to the owner) in addition to the $5/day app cap.
    It is a notification, not an enforced spend ceiling.
13. **Cohort kit:** a one-page Vietnamese onboarding guide (install the extension, sign in with
    Google, capture from a real passage, review on the phone, what Free and Pro include, how Pro is
    granted in the pilot) and a feedback channel. **Deferred by the owner (2026-09-24):** easy to add
    later, and not needed at any gate before learners are recruited.

## Files

- Modify `.firebaserc` (staging alias) and add the staging target files or build selection the
  setup needs; production values stay unchanged.
- Create `docs/runbooks/vn-pilot-operations.md`; modify `README.md` (one link).
- Create `plans/260923-2000-vn-ielts-paid-pilot/decision-log.md` (first entry: staging smoke).
- Create the onboarding guide as a static page `public/pilot-guide.html` or a shared document (owner
  choice).

## Steps

1. W0 day 1: staging setup and smoke (requirement 1). No G1 step starts before it passes.
2. W0: runbook and the decision log.
3. Run G1 on 09-29/30, G2 on 10-02, G2b on 10-07, G3 on 10-14.
4. Daily and weekly operations through 10-23.
5. 10-23: final metrics run, decision entry, and a short backlog with business reasons (GPT §3 exit
   conditions).

## Validation

- The staging smoke is recorded before G1.
- Every gate has a dated go entry, `ttls list` output where the gate adds a TTL, the CSS size, and a
  passing production smoke.
- The final decision entry contains every metric in plan.md with numerator and denominator.

## Risk

| Risk | L × I | Mitigation |
|---|---|---|
| Staging setup takes longer than a day and delays G1 | M × H | First task of W0; the W0 cut line in plan.md decides what moves |
| A gate slips and onboarding starts without protection | M × H | Hard rule: no real learners before the spend cap, quota and allowances are live in production |
| A deploy order mistake breaks capture for the cohort | M × H | Rules → functions → hosting with a live check between; rollback in reverse (red team #4) |
| Operations take founder time from interviews | M × M | Daily checks capped at 10 minutes; alarms instead of watching dashboards |
| A bad deploy during the cohort | M × H | Deploy only on weekdays before 16:00 Asia/Ho_Chi_Minh; keep the previous artifacts; rollback commands in the runbook |

## Rollback

Per gate, in the reverse deploy order (hosting → functions → rules), using the previous artifacts
that still accept every field the live client sends; config-only rollbacks for quota
(`quotaEnforced`), caps, allowances and analytics (`analyticsEnabled`).
The staging alias and target are additive and can stay.
