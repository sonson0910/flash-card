# VN IELTS paid-pilot operations

This is a human-gated runbook. **W0 is not complete; G1 is blocked.** The staging target is prepared locally, but no staging deploy or sign-in → capture → review smoke has been performed. Production must remain unchanged until the owner records an explicit go and uses the protected production workflows. Never commit credentials, print secret values, or infer a pass from a successful build/HTTP response.

## Targets and current state

| Environment | Firebase project | Firestore database | Region | Web origin | Deployment boundary |
|---|---|---|---|---|---|
| Staging | `sonflash-staging-20260906` | `ai-studio-945b4052-4462-4668-8936-277f09f07a37` | `asia-southeast1` | `https://sonflash-staging-20260906.web.app` | Explicit `SONFLASH_TARGET=staging` and `--project sonflash-staging-20260906` only |
| Production | `encoded-hangout-433912-h2` | `ai-studio-945b4052-4462-4668-8936-277f09f07a37` | Existing production configuration | Production URL from protected release config | Protected GitHub release workflows only; no local production deploy |

The matching database IDs are resources in **different projects**; do not treat them as the same database. `firebase-targets/staging.json` contains the staging Web app config and App Check public site key. The existing production `firebase-applet-config.json`, default `.firebaserc` alias, release config and protected workflows remain production-bound. Functions use the configured named database ID; an explicit Firebase `--project` selects which project's database receives the operation.

Owner-provided setup: Google sign-in is enabled; both Firebase hosting domains are authorized for Auth; the staging App Check Enterprise key is restricted to the two staging domains. The project, database, region, Firebase Web app identity, App Check domain allowlist and Hosting HTTP 200 were read back. These checks are not the browser smoke. Staging has enabled Secret Manager versions for `ANALYTICS_PSEUDONYM_KEY` and `GEMINI_API_KEY`; neither value was read or displayed. Read-only checks report staging billing enabled, but `generativelanguage.googleapis.com` is not enabled on staging. The reported Gemini key project `named-sunset-433912-j1` has billing disabled (API enabled). The staging Gemini secret's key provenance/binding and AI Studio quota remain unverified; do not use the key or change API/billing configuration without owner action.

## Prepare and deploy staging

From the repository root:

```sh
npm run staging:prepare
npm run build:staging
npm run verify:secrets:staging
npm run verify:bundle
```

`staging:prepare` verifies the sealed staging project/app/database/region/App Check target against the deployment and Functions runtime database, then writes the ignored, hook-free `.firebase/staging.json`. `build:staging` packages the staging app config only. The normal `npm run build` and `npm run build:release` stay production-default; `npm run verify:release-config` rejects `SONFLASH_TARGET=staging`.

When the owner authorizes a **staging** deploy and Gemini billing/quota is ready, first run `npm run verify:core`, `npm run build:staging`, `npm run verify:secrets:staging` and `npm run verify:bundle`. Then run one command at a time, in order, and confirm the layer is live before continuing:

```sh
npm run staging:deploy:rules
# Verify the Rules release and run its staging checks before proceeding.
npm run staging:deploy:functions
# Verify Functions health/compatibility before proceeding.
npm run staging:deploy:hosting
```

Each command hard-codes the staging project and passes `--config .firebase/staging.json` plus `--project sonflash-staging-20260906`; none was run during preparation. Do not copy `.firebase/staging.json` into production release workflows.

## W0 gate — do not mark passed until every item has evidence

- [x] Additive `staging` Firebase alias; preserve default production alias.
- [x] Seal the staging web/app/database/region/App Check target and validate it through `validateStagingReleaseTarget` in `scripts/release-artifact.mjs`.
- [x] Build-time target selection and explicit staging-only deploy command; production release validation rejects the staging selector.
- [x] Create staging-only `ANALYTICS_PSEUDONYM_KEY` Secret Manager version without exposing it.
- [ ] Confirm a staging `GEMINI_API_KEY` is available to Functions, belongs to the intended project, is billed, and has the required quota for **only** `gemini-3.1-flash-lite`; no fallback model is allowed.
- [ ] Owner-authorized staging deployment and live Functions/Rules/Hosting confirmation.
- [ ] Browser smoke: Google sign in → capture one word from a real passage → edit/review one card; verify persisted card, review result and meter movement. Record only aggregate evidence (timestamp, revision, pass/fail, non-sensitive correlation IDs); never record email, UID, token, passage, card text or secret.
- [ ] Record the smoke in `plans/260923-2000-vn-ielts-paid-pilot/decision-log.md` before any G1 work.
- [ ] Confirm remaining W0 operations: billing budget alert amount/account, recovery owner and monitoring access.

Until all items pass, **W0 remains blocked and no G1 step may start**. A successful local build, HTTP 200, App Check allowlist or Auth-domain setting alone is not smoke evidence.

## Gate checklist and deployment order

For every gate, before seeking the owner's written go, run `npm run verify:core` and `npm run verify:bundle` (including the CSS budget); run `npm run extension:check` if extension code changed; run that phase's validations against staging; attach non-sensitive evidence and the exact candidate revision to the decision log. Do not start a later gate on an incomplete prerequisite.

After a written go, deploy in compatibility order **Firestore Rules → Functions → Hosting**, confirming the live state between each layer. Use the protected production workflows only for production. Expand/contract `operationId` and `origin` so live clients remain compatible. Run the production smoke only after production authorization and promotion; it is not replaced by the staging smoke.

| Gate | Additional evidence before go |
|---|---|
| G1 | Gemini key-level quota hard stop behind the $5/day cap; `ai_operations`, `ai_cost_ledger` and `card_reports` TTL evidence; measured Pro quota and non-card allowances; spend cap/account-share proof on staging; owner-reviewed privacy page. |
| G2 | Operator grant/revoke on the authorized owner production account; the explicitly approved production `purchase_intent`; accountant-confirmed `displayPriceVnd`; owner-reviewed terms; unknown-target refusal. |
| G2b | `analytics_events` TTL; `_serviceConfig/pilotExclusions`; inspect 20 staging analytics events for private text. |
| G3 | Throwaway-account deletion with a second signed-in browser; XP replay check against the previous Hosting release; `account_tombstones` TTL. |

For each TTL gate, use the exact project and named database (never rely on the default database):

```sh
gcloud firestore fields ttls update expiresAt \
  --collection-group=<group> --enable-ttl \
  --database=ai-studio-945b4052-4462-4668-8936-277f09f07a37 \
  --project=<explicit-project-id>
gcloud firestore fields ttls list \
  --database=ai-studio-945b4052-4462-4668-8936-277f09f07a37 \
  --project=<explicit-project-id>
```

Save the list output in the decision log after redacting unrelated identifiers. TTL mutations are not part of this staging preparation.

For a G2 operator rehearsal, build Functions, then run `node functions/lib/pilotOperator.js`
with explicit `PILOT_TARGET`, `FIREBASE_PROJECT_ID`, `FIRESTORE_DATABASE_ID`,
`PILOT_OPERATOR_MODE`, `PILOT_OPERATOR_UID` and
`PILOT_OPERATOR_CONFIRMATION=<mode>:<target>`. `grant` and `revoke` also require
`PILOT_OPERATOR_REASON` and `ANALYTICS_PSEUDONYM_KEY`; `status` is read-only.
The target validator accepts only the sealed staging or production project/database pair.
Do not run a mutating mode until that environment and account are explicitly authorized.
The audit record stores a pseudonym instead of the UID. Pro grants last exactly the
configured `proDurationDays`; extending access is a revoke followed by a new grant.
`getPilotOffer` is the only client-facing offer config. Its `displayPriceVnd` stays null
until the accountant confirms the VAT-inclusive final price; G2 remains blocked until then.

## Rollback and incidents

Before promotion, retain the last-known-good candidate revision, artifact digest, Hosting version, Functions compatibility decision and Rules digest. If a problem occurs: (1) roll back config-only changes first (`quotaEnforced`, caps, allowances, `serverReviewXp`, `analyticsEnabled`); (2) restore Hosting; (3) restore compatible Functions; (4) restore Rules last. Never restore Functions or Rules that reject fields sent by the live Hosting client (`operationId`, `origin`). If compatible artifacts are unavailable, stop and mitigate forward; do not rebuild an old revision and call it an artifact rollback.

- **Production:** use the retained candidate and the protected `deploy-production.yml` / `deploy-firestore-rules.yml` workflows as documented in [`phase-6-rollout.md`](./phase-6-rollout.md). No local Firebase CLI production rollback/deploy is supported.
- **Staging:** extract the exact retained staging artifact, regenerate its hook-free config, then use the matching `npm run staging:deploy:hosting`, `npm run staging:deploy:functions` or `npm run staging:deploy:rules` command one at a time after compatibility review. Verify the live revision/health and smoke after each restoration. Never use a default project alias for a mutating command.
- **Incident:** stop new pilot onboarding, preserve aggregate logs, page the owner, and record time, revision, affected gate and non-sensitive correlation IDs. Do not put tokens, account identifiers, private passages/cards or raw model responses in tickets or chat. Treat spend-cap/quota bypass, private-text leakage, cross-account access and lost capture/review data as stop-the-pilot incidents.

## Daily/weekly operations and cohort kit

Daily during W1–W3 (10-minute cap), review prior-day spend, request count, mean/p95 cost per card, timeouts, top-account spend, refusal reasons, open `card_reports`, capture failures, refunded reservations and tombstones not `done`. Use the read-only AI cost report command documented in the [README](../../README.md#production-releases) with an explicit project and named database; keep its pseudonym key out of logs. In the Firebase console, select the explicit pilot project and named database, open `card_reports`, and filter `status == open`. Review the server-copied card fields and reason, then set `status` to `closed` on the report document after resolving it; do not copy its note or card text into the decision log. The `expiresAt` timestamp retains reports for 180 days and requires the collection-group TTL at G1. Weekly, run the approved metrics operator and append aggregate numbers with numerator and denominator to the decision log. Do not query production for legacy shared decks until separately authorized.

The owner still needs to choose **static guide vs shared document** and a **feedback channel**. Do not publish a cohort guide or invite learners until those choices, W0 smoke, paid-tier/quota, spend cap and owner go are recorded. After approval, the one-page Vietnamese guide must cover extension install, Google sign-in, capture from a real passage, phone review, Free/Pro allowances and how Pro is granted for this pilot.

The final 10-23 decision records continue/fix/change ICP with the plan's metrics and denominators. Keep this runbook as operating procedure; use the pilot decision log for dated evidence and decisions.

## Related authority

- [Phase 11 plan and gate requirements](../../plans/260923-2000-vn-ielts-paid-pilot/phase-11-staging-go-gates-and-pilot-operations.md)
- [Pilot plan](../../plans/260923-2000-vn-ielts-paid-pilot/plan.md)
- [Production release and rollback](./phase-6-rollout.md)
- [Staging decision log](../../plans/260923-2000-vn-ielts-paid-pilot/decision-log.md)
