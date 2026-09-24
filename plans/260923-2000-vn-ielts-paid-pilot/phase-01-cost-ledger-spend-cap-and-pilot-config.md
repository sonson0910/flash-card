# Phase 01: Cost ledger, daily spend cap, pilot config

Effort: 2d (red team #1, #3, #13: reserved spend, per-account spend share, client-safe config fields).
Blocked by: W0 staging setup (phase 11) for the staging steps only. Release: R1 (G1). Owner of
`functions/src/index.ts` during this phase.

> **Owner, 2026-09-23:** use `gemini-3.1-flash-lite` only, with no fallback model. The 503s in the
> measurement came from the AI Studio trial tier. The price table needs only this model. Moving the
> key to a paid tier is a G1 condition, not code work.

## Context

- `generateVocabulary` (`functions/src/index.ts:318-408`, `timeoutSeconds: 60` at `:322`) calls
  Gemini `gemini-3.1-flash-lite` (`:95`) for `word`, `story` and `translate` and discards
  `response.usageMetadata`. Tokens per card have never been measured; the whole Pro quota decision
  (1,000 vs 500) depends on them.
- Only call-count limits exist: 270 Gemini calls per hour for the service and 90 per owner
  (`:100-101`), plus per-action hourly budgets (`functions/src/aiRequestBudget.ts:9-25`), enforced
  through `consumeBudget` (`functions/src/index.ts:262-288`) and `consumeOwnerAndServiceBudget`
  (`functions/src/serviceBudget.ts:15-28`). There is no money cap.
- `translate` accepts any prompt up to 2,048 characters and backs five features through
  `translateText` (`src/lib/gemini.ts:92`): `WordExtractorModal` (`src/features/library/WordExtractorModal.tsx:56`),
  `AiDialogueModal` (`src/features/library/AiDialogueModal.tsx:92`), `CardAiAssistantModal`
  (`src/components/flashcard/CardAiAssistantModal.tsx:48`), `CardMnemonicSection`
  (`src/components/flashcard/CardMnemonicSection.tsx:35`) and the explanation translate in
  `src/components/Flashcard.tsx:458-459`. `story` backs `generateStoryContext` (`src/lib/gemini.ts:87`,
  called from `src/features/practice/usePracticeGames.ts:251-263`). None of them touches the card
  quota, so without a per-account brake one Free account can burn the global cap (red team #1).
- Output tokens are capped by `MAX_AI_OUTPUT_TOKENS` (`functions/src/aiGeneration.ts:38-42`); thinking
  tokens are billed as output (GPT review §2.2). This bound gives a worst-case cost per call.
- R5 requires quotas and caps "in configuration". Firebase params (`defineBoolean`, `:91`) need a
  redeploy; a Firestore config document does not.
- The callable parser rejects unknown fields (`assertAllowedFields`, `functions/src/inputValidation.ts:186`),
  so any request field added by this plan must reach production functions before any client sends
  it (red team #4, see Rollback).

## Requirements

1. **Pilot config** read by the server from `_serviceConfig/pilot` (Admin only; the default-deny rule
   `firestore.rules:6-7` already blocks clients). Fields and code defaults (red team #1, #6, #13):
   - Card quota: `freeMonthlyAiCards: 30`, `proMonthlyAiCards: 500` (switch to 1,000 after
     measurement), `quotaEnforced: true`.
   - Non-card AI allowance (`story`, `translate`): `freeDailyAiActions: 20`, `proDailyAiActions: 200`
     per account per pilot-timezone day, not counted against the card quota (enforced in phase 02).
   - Spend: `dailyGeminiSpendCapUsd: 5`, `accountDailySpendShare: 0.2` (one account may spend at
     most 20% of the daily cap, about $1), `geminiInputUsdPerMillion: 0.25`,
     `geminiOutputUsdPerMillion: 1.5`.
   - Offer: `proPriceVnd: 79000` (net of VAT, for records), `displayPriceVnd: null` (the final
     VAT-inclusive price the accountant confirms; phase 04 hides the price and G2 is not go while
     it is null), `proDurationDays: 30`.
   - Other: `pilotTimezone: 'Asia/Ho_Chi_Minh'`, `reviewBaseXp: 2`, `serverReviewXp: true`
     (phase 09), `analyticsEnabled: true` (phase 05).
   Cached per instance for 60 s. A missing or invalid field uses the code default and logs one
   error; an invalid cap, share or allowance can never disable its limit (values ≤ 0 or non-finite
   fall back to the default). Only `proMonthlyAiCards` and `displayPriceVnd` are ever sent to a
   client, through phase 04's `getPilotOffer` (red team #13).
2. **Ledger entry per Gemini call**, success or failure, in `ai_cost_ledger/{autoId}` (server-only):
   `uid`, `action`, `operationId` (from phase 02; null for `story`/`translate`), `model`,
   `promptTokens`, `outputTokens` (candidates), `thinkingTokens`, `cachedTokens`, `totalTokens`,
   `estimatedUsdMicros`, `reservedUsdMicros`, `latencyMs`, `outcome` (`ok`, `provider-error`,
   `parse-error`, `timeout`), `day` (pilot timezone), `createdAt`, `expiresAt` (+400 days; the TTL
   policy is a G1 step, red team #14). No prompt, context sentence, word or output text.
3. **Cost formula**: `(prompt − cached) × in + cached × in + (candidates + thoughts) × out`, in USD
   micros, using config prices. Keep cached input at the input price until a cached-input price is
   configured (no explicit cache is used today). The **worst-case reservation** for one call is
   `promptTokensUpperBound × in + MAX_AI_OUTPUT_TOKENS × out`, where the prompt bound comes from the
   bounded input length (red team #3).
4. **Reserved spend, not after-the-fact spend (red team #3, #1).** Two counters for the
   pilot-timezone day: global `_serviceBudgets/gemini-spend-{YYYY-MM-DD}` and per account
   `users/{uid}/ai_daily/{YYYY-MM-DD}` (server-only; phase 02 adds `nonCardActions` to the same
   document). Before any Gemini call, one transaction reads both and:
   - refuses with `resource-exhausted` and `{ reason: 'service-daily-cap' }` when
     `global.usdMicros + reservation > cap`;
   - refuses with `resource-exhausted` and `{ reason: 'account-daily-spend' }` when
     `account.usdMicros + reservation > cap × accountDailySpendShare`;
   - otherwise adds the reservation to both.
   After the call, one correction increments both by `actual − reservation` (negative when the call
   was cheaper). A call killed by the timeout or a failed correction write keeps its worst-case
   reservation, so errors overcount and never undercount. The cap is therefore hard up to the
   accuracy of the price config.
5. **Abort before the function timeout (red team #3).** The Gemini call is aborted after 45 s
   (below `timeoutSeconds: 60`), recorded as `outcome: 'timeout'`, and mapped to the same
   `HttpsError` a timeout produces today. Use the SDK's abort option if the installed `@google/genai`
   types expose one; otherwise race the call against a timer and ignore the late result.
6. Keep the 270/hour and 90/owner/hour limits unchanged (GPT P0 #4: do not remove limits). They run
   before the spend reservation; their refusals reserve nothing.
7. A ledger write failure must not fail the learner's request: log `ledger-write-failed` with the
   error name and continue. A reservation read or write failure fails closed (refuse the AI call),
   matching `consumeRateLimitFailClosed`.
8. A read-only operator report prints per-day spend, calls, mean/p50/p95 cost per `word` call, the
   share of calls that ended as `timeout`, and the top accounts by spend (as pids, see phase 05) for
   a date range, so the owner can apply the $0.001 rule and see abuse.
9. The last hard stop outside this code is a key-level request quota on the Gemini API key in AI
   Studio or Cloud console, set in G1 (phase 11, red team #3).

## Files

- Create `functions/src/pilotConfig.ts` (parse, defaults, 60 s cache).
- Create `functions/src/aiCostLedger.ts` (usage extraction, cost math, worst-case reservation,
  reserve and correction transactions on the two day counters, ledger write).
- Create `functions/src/aiCostReportOperator.ts` (env-validated, read-only; same style as
  `functions/src/legacyLibraryMigrationOperator.ts:18-34`, but accepting the production and staging
  targets only, see phase 04 requirement 5).
- Modify `functions/src/index.ts`: wrap the three `ai.models.generateContent` calls (`:346`, `:382`,
  `:399`) in one helper that runs reserve → call with abort → ledger → correction.
- Modify `src/lib/protectedFunctionsCapability.ts`: map `service-daily-cap` and
  `account-daily-spend` to non-retryable quota errors with Vietnamese copy.
- Create `functions/test/pilotConfig.test.ts`, `functions/test/aiCostLedger.test.ts`.
- Modify `README.md` operator section: how to read the cost report and edit `_serviceConfig/pilot`.

## Steps

1. Confirm the `usageMetadata` field names (`promptTokenCount`, `candidatesTokenCount`,
   `thoughtsTokenCount`, `cachedContentTokenCount`, `totalTokenCount`) and the abort option in the
   installed `@google/genai` 2.x types before coding; treat any missing count as 0 and record
   `usageMissing: true`.
2. Write `pilotConfig.ts` with a pure parser and tests for defaults, bad types, negative numbers,
   a cap or share of 0 or less, and a null or invalid `displayPriceVnd`.
3. Write `aiCostLedger.ts` as pure functions (`estimateCostUsdMicros`, `worstCaseReservationMicros`,
   `dayKey(now, tz)`) plus thin Firestore wrappers; unit-test the math with fixed token counts
   (400/400 → 700 micros at list price).
4. Add one `callGemini(uid, action, request)` helper in `index.ts` used by all three actions; it
   reserves, measures latency, aborts at 45 s, maps errors to the ledger outcome, corrects the
   counters and rethrows the same `HttpsError` as today.
5. Map `service-daily-cap` ("AI tạm dừng đến 00:00 hôm nay theo giờ Việt Nam") and
   `account-daily-spend` (per-account message, same reset time) in
   `src/lib/protectedFunctionsCapability.ts`; retries disabled.
6. Write the report operator; run it against the emulator in tests.
7. On staging (before G1): set `dailyGeminiSpendCapUsd` to 0.001 and prove the next call is refused;
   set `accountDailySpendShare` so one account is refused while a second account still succeeds;
   restore both.

## Validation

- `npm --prefix functions test` covers: cost math, worst-case reservation, day key at 23:59/00:00
  in Asia/Ho_Chi_Minh, global cap refusal, account share refusal, a simulated timeout keeps the full
  reservation, a successful call corrects the counters to the actual cost, ledger failure does not
  fail the call, reservation failure fails closed.
- Emulator run: one `word` call writes exactly one ledger entry and leaves both day counters equal
  to its actual cost.
- Staging: 50 real-context captures from IELTS passages; the report shows mean and p95 cost per
  `word` call. **Decision rule:** set `proMonthlyAiCards` to 1,000 if mean ≤ $0.001 (1,000 micros),
  else 500. Record the numbers in the pilot decision log (phase 11).

## Risk

| Risk | L × I | Mitigation |
|---|---|---|
| Thinking tokens make a card cost > $0.001 | M × M | Measured before G2; the Pro quota falls to 500; `maxOutputTokens` bounds the tail |
| One account exhausts the global cap through `translate`/`story` | H × H without the share | Per-account daily spend share (20%) here plus the non-card daily allowance in phase 02 (red team #1) |
| Worst-case reservations refuse calls near the cap although real spend is lower | M × L | Corrections return the difference within seconds; the cap is a safety limit, not a target |
| Extra Firestore reads and writes per call (two counters, ledger, correction) | H × L | About 2 reads and 4 writes per AI call; negligible at pilot scale |
| Global spend counter becomes a hot document | L × L | ≤ 270 calls per hour; well under Firestore's 1 write/s sustained guideline |
| Config typo disables protection | L × H | Parser falls back to defaults; caps, shares and allowances cannot be ≤ 0 |

## Rollback

Prefer config: raise `dailyGeminiSpendCapUsd` or `accountDailySpendShare` in `_serviceConfig/pilot`
(no deploy). For a code fault, redeploy a previous functions artifact **only if it accepts every
request field the live hosting release sends** (red team #4): once phase 02 is live, that means the
last artifact that accepts `operationId`. If no such artifact exists, roll hosting back first, then
functions (reverse of the deploy order). The ledger and counter documents are additive and can stay.
