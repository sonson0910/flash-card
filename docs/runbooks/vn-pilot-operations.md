# VN IELTS paid-pilot operations

This is a human-gated runbook. **W0 passed on staging; G1 is blocked.** The 2026-09-24 sign-in → capture → review smoke is recorded in the pilot decision log. Production must remain unchanged until the owner records an explicit go and uses the protected production workflows. Never commit credentials, print secret values, or infer a pass from a successful build/HTTP response.

## Targets and current state

| Environment | Firebase project | Firestore database | Region | Web origin | Deployment boundary |
|---|---|---|---|---|---|
| Staging | `sonflash-staging-20260906` | `ai-studio-945b4052-4462-4668-8936-277f09f07a37` | `asia-southeast1` | `https://sonflash-staging-20260906.web.app` | Explicit `SONFLASH_TARGET=staging` and `--project sonflash-staging-20260906` only |
| Production | `encoded-hangout-433912-h2` | `ai-studio-945b4052-4462-4668-8936-277f09f07a37` | Existing production configuration | Production URL from protected release config | Protected GitHub release workflows only; no local production deploy |

The matching database IDs are resources in **different projects**; do not treat them as the same database. `firebase-targets/staging.json` contains the staging Web app config and App Check public site key. The existing production `firebase-applet-config.json`, default `.firebaserc` alias, release config and protected workflows remain production-bound. Functions use the configured named database ID; an explicit Firebase `--project` selects which project's database receives the operation.

Owner-provided setup: Google sign-in is enabled; both Firebase hosting domains are authorized for Auth; the staging App Check Enterprise key is restricted to the two staging domains. The project, database, region, Firebase Web app identity, App Check domain allowlist and Hosting HTTP 200 were read back. These checks are not the browser smoke. Staging has an enabled `ANALYTICS_PSEUDONYM_KEY` Secret Manager version. Read-only checks report staging billing enabled, but `generativelanguage.googleapis.com` is not enabled on staging. The original staging Gemini secret version 1 has unknown provenance; an earlier reported key project `named-sunset-433912-j1` had billing disabled. Do not assume any running Function has picked up the new test key without an authorized deploy and smoke.

The SonFlash Gemini key is for **product testing only**; a production key will be configured later. Earlier test keys appeared in internal browser-tool output. The owner replaced them and updated the mode-`600` local file `~/.config/sonflash/gemini-staging.env`; the latest key differs from the previously exposed masked suffix. A minimal `gemini-3.1-flash-lite` request with the latest key returned HTTP 200. The owner authorized this cross-project test arrangement: AI Studio showed Gemini project `jovial-honor-410914` at Tier 1 Prepay, separate from Firebase staging project `sonflash-staging-20260906`, with project limits of 4,000 RPM, 4 million TPM and 150,000 RPD. Firebase Secret Manager staging `GEMINI_API_KEY` version 4 is enabled; a readback matched the local key exactly with no stored trailing newline. Versions 1–3 remain enabled; version 3 contained a trailing newline and must not be used. No key value was printed during the update or readback. The 2026-09-24 staging Functions rollout now binds `generateVocabulary` to version 4 and includes the pilot callables. [Google documents](https://ai.google.dev/gemini-api/docs/rate-limits) these limits as **per project, not per key**; the owner accepted the app $5/day cap plus a monthly budget alert as the G1 exception. Other keys in the same project bypass the app cap, and an alert does not stop charges. The direct API check, secret binding and successful deploy do not satisfy W0 app smoke.

Cloud Billing budget `SonFlash test Gemini` is scoped only to `jovial-honor-410914`: **520,000 VND per month**, actual-spend alerts at 50%, 90% and 100%, with the sole selected Monitoring email channel addressed to the owner. Billing-admin and project-owner recipient groups are disabled for this budget. Its alerts can lag reported charges and do not enforce the app's $5/day limit. The pre-existing account-wide `flashcard` budget remains separate.

The owner accepted responsibility for monitoring pilot test alerts and handling incidents. The owner's signed-in Chrome account opened Cloud Monitoring Overview, Alerting and Notification channels for `jovial-honor-410914`; the configured budget email channel was visible there. This verifies console read access, not delivery of an alert email. The owner will read the privacy and terms pages before confirming their approval for the pilot.

## Prepare and deploy staging

From the repository root:

```sh
npm run staging:prepare
npm run build:staging
SONFLASH_TARGET=staging node scripts/check-locale-pages.mjs
npm run verify:secrets:staging
npm run verify:bundle
```

`staging:prepare` verifies the sealed staging project/app/database/region/App Check target against the deployment and Functions runtime database, then writes the ignored, hook-free `firebase.staging.json` at the repository root and an ignored project-specific Functions env file containing `ENFORCE_APP_CHECK=true`. Firebase resolves deploy paths relative to the config and requires that env file for a noninteractive Functions deploy. `build:staging` packages the staging app config with the current Git revision in `health.json`. The normal `npm run build` and `npm run build:release` stay production-default; `npm run verify:release-config` rejects `SONFLASH_TARGET=staging`.

When the owner authorizes a **staging** deploy and Gemini billing/quota is ready, first run `npm run verify:core` and the build checks above. `staging:deploy:hosting` repeats the locale-page check after its own build and before Firebase deploy; the production hosting predeploy does the same for the production build. Then run one command at a time, in order, and confirm the layer is live before continuing:

```sh
npm run staging:deploy:rules
# Verify the Rules release and run its staging checks before proceeding.
npm run staging:deploy:indexes
npm run staging:verify:indexes
# Proceed only after the required index reports READY.
npm run staging:deploy:functions
# Verify Functions health/compatibility before proceeding.
npm run staging:deploy:hosting
```

Each deployment command hard-codes the staging project and passes `--config firebase.staging.json` plus `--project sonflash-staging-20260906`. The index readback uses the same project and named database. Do not copy `firebase.staging.json` into production release workflows.
`staging:deploy:rules` deploys only Firestore Rules. The pilot Upgrade offer and intent callables require the `entitlements(status, expiresAt)` collection index in `firestore.indexes.json`. The staging index command deploys that manifest to the sealed staging target; `staging:verify:indexes` reads the exact project/database with `gcloud` and fails unless the index reports **READY**. The local emulator passes without proving staging readiness. These deployment commands are documented for an authorized release and were not run in this local task. The protected production Functions workflow now checks the same index before promotion and fails closed until an authorized production index rollout is ready.
The Functions command deploys two explicit allowlists, defined in `package.json` (`staging:deploy:functions:existing` and `staging:deploy:functions:pilot`). The pilot list now includes the reminder delivery and AI tutor/generation endpoints; this is a local deployment-route change, not evidence that they are live. The bounded lists keep the pre-existing `assessPronunciation` endpoint in staging until a separate compatibility review authorizes its removal; a blanket Functions deploy would offer to delete it.
The allowlist invariant is checked by `scripts/staging-functions-allowlist.test.mjs`. Reminder push and email links resolve from the running Firebase project in `functions/src/reminderAppOrigin.ts`: staging links stay on the staging Hosting origin, production links stay on `sonflash.app`, and an unknown project fails closed. Validate both destinations before enabling delivery in staging.

## W0 gate — do not mark passed until every item has evidence

- [x] Additive `staging` Firebase alias; preserve default production alias.
- [x] Seal the staging web/app/database/region/App Check target and validate it through `validateStagingReleaseTarget` in `scripts/release-artifact.mjs`.
- [x] Build-time target selection and explicit staging-only deploy command; production release validation rejects the staging selector.
- [x] Create staging-only `ANALYTICS_PSEUDONYM_KEY` Secret Manager version without exposing it.
- [x] Confirm a staging `GEMINI_API_KEY` is available to Functions, belongs to the intended project, is billed, and has the required quota for **only** `gemini-3.1-flash-lite`; no fallback model is allowed. The live Function binds version 4; the direct provider check passed before deploy.
- [x] Owner-authorized staging deployment and live Functions/Rules/Hosting confirmation. Rules digest, 20 active Functions and Hosting revision were read back on 2026-09-24.
- [x] Browser smoke: Google sign in → enter one word from a real passage through the in-app form → edit/review one card; verify persisted card, review result and meter movement. Aggregate evidence for revision `e6f982f` is in the decision log; no private content is recorded there. Extension quick-add has separate phase 07 validation.
- [x] Record the smoke in `plans/260923-2000-vn-ielts-paid-pilot/decision-log.md` before any G1 work.
- [x] Confirm a monthly budget alert on the Gemini test billing project and its owner email recipient.
- [x] Replace the test key exposed in internal tool output; create staging secret version 4 from the local file and verify an exact value match without a trailing newline.
- [x] Confirm the owner responsible for monitoring alerts and incident recovery.
- [x] Verify the owner's read access to the Gemini test project's Monitoring Overview, Alerting and Notification channels.

W0 staging smoke passed on 2026-09-24. G1 has its own evidence and written-go requirements below. A successful local build, HTTP 200, App Check allowlist or Auth-domain setting alone is not smoke evidence.

The first 2026-09-24 browser smoke failed because the staging build dropped the Firebase Web app ID after validating it. Revision `e6f982f` keeps the app ID; the new staging Hosting release passed the sign-in, public passage word, edit, review, persisted-card and meter smoke. App Check enforcement and risk threshold remain enabled. An older bundle stayed cached at the bare `web.app/` URL in one Chrome tab; the fresh `web.app/` root response serves the corrected bundle. Use `index.html?pilot=e6f982f` if that profile still serves the old bundle, and recheck a clean root load before onboarding.

## Gate checklist and deployment order

For every gate, before seeking the owner's written go, run `npm run verify:core` and `npm run verify:bundle` (including the CSS budget); run `npm run extension:check` if extension code changed; run that phase's validations against staging; attach non-sensitive evidence and the exact candidate revision to the decision log. Do not start a later gate on an incomplete prerequisite.

After a written go, deploy in compatibility order **Firestore Rules → Functions → Hosting**, confirming the live state between each layer. Use the protected production workflows only for production. Expand/contract `operationId` and `origin` so live clients remain compatible. Run the production smoke only after production authorization and promotion; it is not replaced by the staging smoke.

| Gate | Additional evidence before go |
|---|---|
| G1 | Owner-accepted per-key quota exception: prove the $5/day app cap and account share on staging, verify the monthly budget alert on the Gemini billing project, and record that other keys bypass the app cap and the alert does not stop charges; `ai_operations`, `ai_cost_ledger` and `card_reports` TTL evidence; measured Pro quota and non-card allowances; owner-reviewed privacy page. |
| G2 | Operator grant/revoke on the authorized owner production account; the explicitly approved production `purchase_intent`; accountant-confirmed `displayPriceVnd`; owner-reviewed terms; unknown-target refusal. |
| G2b | `analytics_events` TTL; `_serviceConfig/pilotExclusions`; inspect 20 staging analytics events for private text. |
| G3 | Throwaway-account deletion with a second signed-in browser; current and previous Hosting clients must still persist review/XP once; `account_tombstones` TTL; 20-card owner phone review. |

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

Queued `mail` documents carry the learner's address and an `expiresAt` 30 days after queueing; enable the `mail` TTL before turning on the weekly digest. `payment_settlements` hold only the pid and an `expiresAt` ten years after settlement, because they back the books; account deletion keeps them while it removes the learner's own `payment_receipts`. A payment the settlement function cannot grant on its own (no price set, amount below the price, an offer version that no longer matches, or a Pro window already open) is recorded with `status: needs-review` and a `reviewReason` instead of being rejected. Review those settlements and grant, refund or credit each one by hand.

### Verified review XP cutover

The strict review Function awards two XP only for the first review of each card on the account's local study day. Its server-only `review_xp_awards` receipts have a seven-day `expiresAt` field and a TTL declaration in `firestore.indexes.json`. Before promoting this Function, rehearse the cutover on staging, enable and read back that collection group's TTL on the explicit named database, and confirm both current and previous clients still complete reviews.

The [backfill operator](../../scripts/backfill-review-xp-awards.mjs) reads existing strict `review_receipts` and creates only missing card/day award receipts; it never changes XP totals. It defaults to a dry run and requires an explicit sealed staging or production project, named database, and inclusive coverage dates. Save only its aggregate report; `preflightMissing` counts missing awards before apply, while `created` records writes completed by this run. For each write, the transaction rereads its source receipt and checks that account deletion has not begun. A clean scan cannot prove that old Function writers have stopped or that Firestore retained every receipt for the cutover day. Record independent evidence for both, pause review writers **and account deletion/final purge** during scan and apply, resolve malformed/conflicting receipts, and obtain the owner's written environment-specific go before any `--apply` invocation. The operator requires `--confirm APPLY_REVIEW_XP_AWARDS_WITH_EXTERNAL_COVERAGE_EVIDENCE` for apply; do not use that confirmation based only on the script's report. Backfill and verify before admitting reviews to the new Function or resuming account deletion. If coverage is incomplete, keep the release blocked rather than infer prior awards from aggregate XP or client history.

For a G2 operator rehearsal, build Functions, then run `node functions/lib/pilotOperator.js`
with explicit `PILOT_TARGET`, `FIREBASE_PROJECT_ID`, `FIRESTORE_DATABASE_ID`,
`PILOT_OPERATOR_MODE`, `PILOT_OPERATOR_UID` and
`PILOT_OPERATOR_CONFIRMATION=<mode>:<target>`. Every mutating mode requires
`PILOT_OPERATOR_REASON`; `grant` and `revoke` also require
`ANALYTICS_PSEUDONYM_KEY`. `status` is read-only.
The target validator accepts only the sealed staging or production project/database pair.
Do not run a mutating mode until that environment and account are explicitly authorized.
The audit record stores a pseudonym instead of the UID. Pro grants last exactly the
configured `proDurationDays`; extending access is a revoke followed by a new grant.
`getPilotOffer` is the only client-facing offer config. Its `displayPriceVnd` stays null
until the accountant confirms the VAT-inclusive final price; G2 remains blocked until then.
The callable also returns `offerVersion`, derived from the offer ID, AI-card quota,
display price and duration. The current client submits that version with
`recordPurchaseIntent`; a changed version is rejected before any rate-budget or
analytics write, so the learner must reopen the offer. Accepted versioned intents
record the server-owned terms. Older clients may still submit without a version;
their intent events leave the price and terms null because the displayed offer
cannot be verified. Deploy the compatible Functions before a Hosting build that
requires `offerVersion`; a new client treats an older response without it as an
unavailable offer.

At G3, the account menu offers the existing Excel card export, a JSON account export
(`exportMyData`, at most five per hour), and deletion after a fresh Google sign-in.
`deleteMyAccount` revokes refresh tokens, writes `account_tombstones/{pid}` before
purging data, removes Auth, then leaves the tombstone until the scheduled final
purge after 65 minutes. The final purge removes any late owner writes and the
tombstone UID; `account_tombstones.expiresAt` needs the G3 TTL. Never roll back
the scheduled purge while any tombstone is not `done`. If a job remains
`deleting` or `auth-deleted`, run the sealed operator with
`PILOT_OPERATOR_MODE=resume-deletion`, `PILOT_OPERATOR_PID=<32-hex-pid>` and
`PILOT_OPERATOR_CONFIRMATION=resume-deletion:<target>`, plus a bounded
`PILOT_OPERATOR_REASON`; the mode does not need an Auth UID. It writes a
pseudonymous `operator_audit` record before resuming and records the result.
Record only the pid and status, never the deleted UID or exported
JSON. A real two-browser Google/Auth smoke and a production throwaway-account
test remain G3 owner-gated actions.

## Rollback and incidents

Before promotion, retain the last-known-good candidate revision, artifact digest, Hosting version, Functions compatibility decision and Rules digest. If a problem occurs: (1) roll back effective config-only changes first (`quotaEnforced`, caps, allowances, `analyticsEnabled`); (2) restore Hosting; (3) restore compatible Functions; (4) restore Rules last. `serverReviewXp` is inert while phase 09 is deferred, so changing it cannot roll back review XP. Never restore Functions or Rules that reject fields sent by the live Hosting client (`operationId`, `origin`). If compatible artifacts are unavailable, stop and mitigate forward; do not rebuild an old revision and call it an artifact rollback.

- **Production:** use the retained candidate and the protected `deploy-production.yml` / `deploy-firestore-rules.yml` workflows as documented in [`phase-6-rollout.md`](./phase-6-rollout.md). No local Firebase CLI production rollback/deploy is supported.
- **Staging:** extract the exact retained staging artifact, regenerate its hook-free config, then use the matching `npm run staging:deploy:hosting`, `npm run staging:deploy:functions` or `npm run staging:deploy:rules` command one at a time after compatibility review. Verify the live revision/health and smoke after each restoration. Never use a default project alias for a mutating command.
- **Incident:** stop new pilot onboarding, preserve aggregate logs, page the owner, and record time, revision, affected gate and non-sensitive correlation IDs. Do not put tokens, account identifiers, private passages/cards or raw model responses in tickets or chat. Treat spend-cap/quota bypass, private-text leakage, cross-account access and lost capture/review data as stop-the-pilot incidents.

## Daily/weekly operations and cohort kit

Daily during W1–W3 (10-minute cap), review prior-day spend, request count, mean/p95 cost per card, timeouts, top-account spend, refusal reasons, open `card_reports`, capture failures, refunded reservations and tombstones not `done`. Use the read-only AI cost report command documented in the [README](../../README.md#production-releases) with an explicit project and named database; keep its pseudonym key out of logs. In the Firebase console, select the explicit pilot project and named database, open `card_reports`, and filter `status == open`. Review the server-copied card fields and reason, then set `status` to `closed` on the report document after resolving it; do not copy its note or card text into the decision log. The `expiresAt` timestamp retains reports for 180 days and requires the collection-group TTL at G1. Weekly, run the approved metrics operator and append aggregate numbers with numerator and denominator to the decision log. Do not query production for legacy shared decks until separately authorized.

For the read-only weekly cohort report, build Functions and run `node functions/lib/pilotMetricsOperator.js` with `PILOT_TARGET`, `FIREBASE_PROJECT_ID`, `FIRESTORE_DATABASE_ID`, `PILOT_METRICS_FROM`, `PILOT_METRICS_TO` (ISO dates bounding sign-up time), and `ANALYTICS_PSEUDONYM_KEY` set in the environment. The sealed target validator rejects other projects/databases; never print the key. The report reads Auth sign-up dates, analytics events, cost ledger, cards and review receipts, plus Admin-only `_serviceConfig/pilotExclusions.uids`. Fill that UID array before G2b, but save only aggregate raw/ICP counts in the decision log. Priced purchase intent counts button presses; interview confirmation is a separate owner observation. Free/Pro MAU uses trailing 30-day activity and the current plan tier, so historical tier changes are not reconstructed. Extension worker failures can be lost before client flush; the reported failure rate is an estimate. At G2b, enable `analytics_events.expiresAt` TTL with the command above, then inspect 20 real staging events for private text and record the redacted result. This inspection remains blocked until an authorized staging release exists.

The owner still needs to choose **static guide vs shared document** and a **feedback channel**. Do not publish a cohort guide or invite learners until those choices, W0 smoke, paid-tier/quota, spend cap and owner go are recorded. After approval, the one-page Vietnamese guide must cover extension install, Google sign-in, capture from a real passage, phone review, Free/Pro allowances and how Pro is granted for this pilot.

The final 10-23 decision records continue/fix/change ICP with the plan's metrics and denominators. Keep this runbook as operating procedure; use the pilot decision log for dated evidence and decisions.

## App Check provider switch (one-time)

reCAPTCHA Enterprise bills each assessment beyond the free tier. reCAPTCHA v3 has no assessment fee. The web app picks the provider from `VITE_FIREBASE_APP_CHECK_PROVIDER`: `v3` uses `ReCaptchaV3Provider`, and any other value uses Enterprise.

To switch a target:

1. Create a reCAPTCHA v3 key restricted to that target's domains.
2. Register it in Firebase Console → App Check → the Web app, with the reCAPTCHA provider.
3. Build with `VITE_FIREBASE_APP_CHECK_PROVIDER=v3` and `VITE_FIREBASE_APP_CHECK_SITE_KEY` set to the v3 key.
4. Deploy, and run the smoke test (sign in, create a card, review) before removing the Enterprise registration.

A provider/key mismatch fails every App Check token and protected calls stop working, so switch staging first.

## Card language backfill (one-time)

Card creation now always writes an explicit `language` field so course-scoped queries can filter `users/{uid}/cards` directly instead of relying on "missing field means en". Cards written before that change may still be missing `language`. Run `node scripts/backfill-card-language.mjs --project <id>` to find and repair them; it is a dry run by default and only reports counts. Add `--apply` to write `language: 'en'` to documents where the field is absent — it never touches a document that already has `language` set, and it defaults `--database` to the pilot's single named database (`ai-studio-945b4052-4462-4668-8936-277f09f07a37`), which staging and production share. Before every batch commit in `--apply` mode, the script writes a timestamped JSON backup of the pre-write data for every document in that batch to `artifacts/backfill-card-language/`; keep that directory until the backfill is confirmed correct in the Firebase console, then delete it rather than committing it. The scan is paged and checkpointed, so an interrupted run can continue with `--resume`; re-running the script at any point, resumed or from scratch, is a safe no-op once every legacy document has been backfilled. Requires ambient Google Cloud credentials for the target project (`gcloud auth application-default login` or `GOOGLE_APPLICATION_CREDENTIALS`); the script never accepts or prints credentials, and refuses to run without an explicit `--project`.

## Related authority

- [Phase 11 plan and gate requirements](../../plans/260923-2000-vn-ielts-paid-pilot/phase-11-staging-go-gates-and-pilot-operations.md)
- [Pilot plan](../../plans/260923-2000-vn-ielts-paid-pilot/plan.md)
- [Production release and rollback](./phase-6-rollout.md)
- [Staging decision log](../../plans/260923-2000-vn-ielts-paid-pilot/decision-log.md)
