# Phase 05: Privacy-safe analytics and pilot metrics

Effort: 2d. Blocked by: 01 (ledger), 02 (quota refusals), 04 (`analyticsEvents.ts` writer and the
`purchase_intent` event). Release: R2 (G2b, 10-07).

## Context

- No analytics exists in the app (no `logEvent` or analytics SDK under `src`). Adding the Firebase
  Analytics SDK would spend most of the ~6 KB gzip initial headroom, so events are stored
  server-side.
- GPT §3 contract: capture, AI card, review, paywall, quota and pro-expired events; never private
  sentences, full URLs, page content, prompts or outputs; pseudonymous user id; separate analytics
  from operational records.
- Server code already sees most facts: the ledger (phase 01), quota refusals (02), card creation
  (`createCard`, `functions/src/index.ts:514-547`), reviews (`applyReviewForOwner`,
  `functions/src/reviewPersistence.ts:278-416`) and operator grants (04).
- The extension capture runs in a hidden worker tab of the web app
  (`src/features/browserExtension/browserExtensionImportRuntime.ts`) that closes as soon as the job
  finishes, so client events batched in that tab are lost before they flush (red team #10). Capture
  completion is therefore emitted by the server.
- Card ids are derived from the word (`createWordCardId`, `src/lib/cardIdentity.ts`), for example
  `word-<word>`. An HMAC of the card id alone gives the same value for every learner and can be
  reversed with a dictionary (red team #11).
- The ledger stores `uid` and `operationId`, so a raw `operationId` in an event would join the event
  back to the uid (red team #11).

## Requirements

1. **Store:** `analytics_events/{autoId}` (server-only; module created in phase 04) with `name`,
   `pid` (HMAC-SHA256 of uid with secret `ANALYTICS_PSEUDONYM_KEY`, hex, 32 chars), `ts`, `day`
   (pilot timezone), `props`, `expiresAt` (+180 days; TTL policy at G2b). This is the only event
   table; cost figures stay in the ledger (red team #10).
2. **References (red team #11):** `cardRef = HMAC(uid ‖ cardId)` and `opRef = HMAC(operationId)`,
   both computed on the server with the same key. No raw card id, operation id, uid or email is
   stored in an event. Every prop value is an enum member, a bounded number, or a string that
   matches a fixed regex (hex refs, `appVersion` as `^\d+\.\d+\.\d+$`); free text is rejected.
3. **Events** (server unless stated):

   | Event | Source | Props |
   |---|---|---|
   | `capture_completed` | server, `createCard` after commit (red team #10) | `origin: 'ai' \| 'manual'`, `cardRef` |
   | `ai_card_completed` | server, quota commit; thin, joined to the ledger by `opRef` in the metrics operator (red team #10) | `opRef`, `tier` |
   | `review_completed` | server, after review commit, not duplicates | `rating`, `cardAgeDays`, `xpAwarded`, `cardRef` |
   | `quota_exhausted` | server | `kind: 'card' \| 'daily-allowance' \| 'account-spend'`, `tier` |
   | `pro_granted`, `pro_revoked` | server, operator tool | `source: 'operator'` |
   | `pro_expired` | server, computed lazily when a read finds an expired plan | `offerId` |
   | `card_reported` | server | `reason` |
   | `purchase_intent` | server, `recordPurchaseIntent` (phase 04) | `trigger`, `offerId`, `displayPriceVnd` |
   | `capture_started`, `capture_failed` | client | `requestId` (random, per capture), `surface: 'extension' \| 'app'`, `latencyMs`, `errorCode` (enum), `appVersion` |
   | `paywall_viewed` | client | `trigger: 'quota' \| 'menu'`, `offerId` |

   There is no `signup_completed` event: the cohort date comes from the Firebase Auth user's
   `creationTime`, read by the metrics operator on the server (red team #10). `payment_confirmed`
   and `refund_recorded` belong to the deferred gateway work.
4. **`recordClientEvents` callable:** batches of up to 20, only the three client event names above,
   strict prop schemas, 300/hour/owner; unknown props are dropped, invalid values reject the event.
5. Server emission is best-effort after the business transaction commits; a failed event write logs
   and never fails the request. `analyticsEnabled: false` in config stops all emission.
6. **Metrics operator** `functions/src/pilotMetricsOperator.ts` (read-only; production or staging
   target only, same check as phase 04) computes the plan.md metrics for a cohort window with
   numerators and denominators:
   - cohort and sign-up time from Auth `creationTime`, mapped uid → pid on the server;
   - activation 24h (≥5 `capture_completed` with `origin: 'ai'` or `ai_card_completed`, plus one
     `review_completed` within 24 h of sign-up), D7 review retention (review on day 6-8, only for
     learners whose day 8 has passed), capture-to-review 7d (joins `capture_completed` to
     `review_completed` by `cardRef`), purchase intents, cost per free and Pro MAU and mean/p95 cost
     per card (ledger joined by `opRef`), wrong-card reports per 100 cards, capture failure rate
     (server outcomes from the ledger plus client `capture_failed`) and p95 latency;
   - the founder and friend exclusion list is computed on the server from uids in the Admin-only
     document `_serviceConfig/pilotExclusions` (red team #11); raw and ICP-only counts are both
     reported;
   - learners who signed up before this phase went live get activation and review counts from the
     ledger, card `createdAt` and review receipts, read on the server and output only as counts.

## Files

- Modify `functions/src/analyticsEvents.ts` (created in phase 04: add the schemas, refs and emitters
  above).
- Create `functions/src/pilotMetricsOperator.ts`.
- Modify `functions/src/index.ts` (`recordClientEvents`; emission calls next to the ledger, quota,
  `createCard`, review and report code).
- Create `src/lib/analytics.ts` (tiny batching client, flush on `visibilitychange`, no-op when signed
  out); wire `capture_started`/`capture_failed` in `src/features/intake/cardIntakeController.ts`
  around the generate call (`:316`) and `paywall_viewed` in the upgrade dialog.
- Tests: `functions/test/analyticsEvents.test.ts`, `src/lib/analytics.test.ts`,
  `functions/test/pilotMetricsOperator.test.ts`.

## Steps

1. Refs and schema module with tests that feed a sentence, a URL and a raw card id into every prop
   and prove they are rejected; prove `cardRef` differs for two uids with the same card id.
2. Server emissions at the listed points, including `capture_completed` in `createCard`.
3. Client batching library and the three client events.
4. Metrics operator with fixture data in tests (known cohort → known numbers), including the
   exclusion list and the pre-phase backfill.
5. Add the TTL policy for `analytics_events.expiresAt` to the G2b checklist (exact command in
   phase 11).

## Validation

- Tests above; a staging capture session from the extension produces `capture_completed` even
  though the worker tab closes at once.
- Manual check of 20 staging events: no sentence, word, URL, email, raw card id or operation id in
  any field.
- `npm run verify:bundle`: `src/lib/analytics.ts` adds < 1 KB gzip to the initial bundle, or it
  loads lazily after the first capture.

## Risk

| Risk | L × I | Mitigation |
|---|---|---|
| Private text leaks into analytics | L × H | Enum, number or regex props only; hostile-input tests |
| Events re-identify a learner | M × H | Per-user `cardRef`, `opRef` instead of `operationId`, no free text (red team #11) |
| Extension-side client failures are lost | M × L | Completion and AI failures come from the server; client failures are an undercount, stated in the report |
| Metrics wrong because founder/friends are counted | M × M | Server-side exclusion list; raw and ICP-only counts |
| Event writes add cost | M × L | ~5-10 events per active learner per day; negligible at 30 learners |

## Rollback

Hosting rollback removes client events; server emission stops with `analyticsEnabled: false` in
`_serviceConfig/pilot` (phase 01 field). Collected events expire by TTL or are deleted by pid
(phase 06).
