# Phase 02: Account AI quota with idempotent operations

Effort: 3d (red team #1, #2, #4: transactional operation record, attempt id, in-flight error,
sweeper, non-card daily allowance). Blocked by: 01 (config, spend helper). Release: R1 (G1).

## Context

- R5: Free 30 AI cards a month, Pro 1,000 or 500; per account; count completed cards; cache hits
  count; failures and same-operation retries do not; values in configuration.
- The server sees only the generation. The client then saves through `createCard`
  (`src/features/intake/cardIntakePipeline.ts:476-560`, persistence at `:562-640`). The client retries
  a generation once on network errors (`withNetworkRetry`, `src/lib/gemini.ts:35-57`), which today
  would count twice.
- The client treats `aborted` as final: it falls through to the non-retryable `unknown` branch of
  `classifyProtectedFunctionError` (`src/lib/protectedFunctionsCapability.ts:147-163`; only
  `cancelled`, `deadline-exceeded`, `network-request-failed` and `unavailable` are retryable at
  `:149`). An "in flight" answer must therefore use a retryable code (red team #2).
- The intake reuses a card already in the library without calling AI
  (`src/features/intake/cardIntakeController.ts:289`); that path never reaches the server and is
  never counted, which matches GPT §B5 ("reopening an existing card does not count").
- `parseVocabularyRequest` (`functions/src/inputValidation.ts:184-186`) allows only `action` and
  `input` and rejects any other field, so `operationId` must reach production functions before any
  client sends it (red team #4).
- Rules: `users/{uid}/profile/{doc}` is deny-by-default for unknown names
  (`firestore.rules:826-833`), and the source guard test keeps the exclusion list
  (`firestoreRulesSource.test.ts`).

## Definition

A **completed AI card** is a `generateVocabulary` call with `action: 'word'` whose Gemini response
parses into a valid result. It is charged once per `operationId`. `story` and `translate` are **not**
charged to the card quota; they count against a separate per-account daily allowance
(requirement 9) and the per-account spend share from phase 01 (owner decision on red team #1).

## Requirements

1. **Operation id (red team #4).** `generateWordInfo` creates one `operationId`
   (`crypto.randomUUID()`) per user action and reuses it across `withNetworkRetry` attempts. The
   request gains an optional **top-level** `operationId` (UUID v4) next to `action` and `input`;
   when absent (old bundles) the server generates one. Deploy order is expand/contract: the
   functions parser that accepts the field ships and is live before the hosting release that sends
   it.
2. **Intake draft keeps the id (red team #2).** The intake draft for a word stores the
   `operationId` of its generation until the card is saved or discarded, so a manual "retry" of the
   same word reuses the id. A completed result is returned without another provider call;
   after a failed or timed-out attempt, the same id may make another provider call and incur
   another charge under the owner-accepted pilot retry exception.
3. **Plan summary** `users/{uid}/profile/plan` (server-written, owner-readable):
   `{ tier: 'pro', entitlementId, startsAt, expiresAt, updatedAt }`. Missing document or
   `expiresAt <= now` means Free. Phase 04 writes it; this phase only reads it.
4. **Usage counter** `users/{uid}/ai_usage/{periodKey}` (server-written, owner-readable):
   `{ periodKey, tier, used, limit, periodStartsAt, periodEndsAt, updatedAt }`.
   `periodKey` is `free-YYYY-MM` (calendar month, pilot timezone) or `pro-{entitlementId}`. Phase 04
   never extends an entitlement, so one `entitlementId` always maps to one fixed window (red team
   #13).
5. **Operation record** `users/{uid}/ai_operations/{operationId}` (server-only):
   `{ status: 'reserved' | 'completed' | 'failed', attemptId, periodKey, reservedAt, completedAt,
   result, expiresAt: +7 days }`. `result` holds the generated card fields so a retry returns them
   without a new Gemini call; it expires with the record (TTL policy in G1).
6. **Flow in `generateVocabulary` for `word` (red team #2):**
   1. **Reserve transaction** reads the operation record, plan and usage **inside one
      transaction**, so two concurrent requests with the same id cannot both charge:
      - `completed` → return the stored result after the transaction (no Gemini, no charge).
      - `reserved` and `reservedAt` younger than 90 s (longer than the 60 s function timeout, so
        the first attempt may still be running) → throw `unavailable` with
        `{ reason: 'operation-in-flight', retryAfterMs: 5000 }`, which the client retries.
      - `reserved` and older than 90 s (the first attempt is dead) → take over: write a new
        `attemptId` and `reservedAt`; `used` is **not** incremented again, because the stale
        reservation's unit transfers to the new attempt.
      - `failed` or missing → if `quotaEnforced` and `used >= limit`, refuse with
        `resource-exhausted` and `{ reason: 'ai-card-quota', used, limit, periodEndsAt, tier }`;
        otherwise `used += 1` and write the record as `reserved` with a fresh `attemptId`.
   2. Spend reservation and Gemini call (phase 01 helper).
   3. **Commit or refund transaction** acts only if the record is still `reserved` **and** its
      `attemptId` equals this attempt's id. Success → `completed` with the result. Failure →
      `failed` and `used -= 1`. Any other state is a no-op, so a late original attempt can neither
      commit over nor refund a takeover.
7. **Sweeper (red team #2).** A scheduled function every 15 minutes finds `ai_operations` records
   still `reserved` after 10 minutes (collection-group query on `status` and `reservedAt`) and
   refunds each with the same attempt-checked transaction (`failed`, `used -= 1`). This replaces the
   earlier "a crash leaks one unit" acceptance.
8. **Client:** a small usage meter ("12 / 30 thẻ AI tháng này") read from the usage document for the
   current period, shown next to the capture/add entry and in the account menu; an exhausted state
   that explains when the quota resets, offers Pro (phase 04), and never blocks review, manual cards
   or export. Both are lazy chunks. Import stays enabled: structured rows persist without AI,
   while missing cards from word-only rows call AI and count against the account quota.
9. **Non-card daily allowance (red team #1, owner decision).** `story` and `translate` calls first
   pass one transaction on `users/{uid}/ai_daily/{YYYY-MM-DD}` (the phase 01 per-account day
   document): if `nonCardActions >= limit` (`freeDailyAiActions` 20 or `proDailyAiActions` 200 by
   the current plan), refuse with `resource-exhausted` and
   `{ reason: 'ai-daily-allowance', used, limit, resetsAt }`; otherwise `nonCardActions += 1`. A
   failed Gemini call gives the unit back (`nonCardActions -= 1`) after the call returns. The phase 01 spend share
   still applies to every action, cards included.
10. Existing hourly limits keep running before the quota and allowance checks; rate-limit refusals
    do not charge.

## Files

- Create `functions/src/aiQuota.ts` (period key, plan read, reserve/commit/refund transactions with
  attempt ids, non-card allowance transaction, sweeper query).
- Modify `functions/src/inputValidation.ts` (top-level `operationId` in `parseVocabularyRequest`,
  `:186`).
- Modify `functions/src/index.ts` (`generateVocabulary` `word` branch `:340-378`, allowance check
  before `story`/`translate`, and the scheduled sweeper export).
- Modify `firestore.indexes.json` (collection-group index on `ai_operations` `status` + `reservedAt`
  for the sweeper).
- Modify `src/lib/gemini.ts` (`generateWordInfo` accepts and reuses an operation id, `:70-85`).
- Modify `src/features/intake/cardIntakePipeline.ts` and `src/features/intake/cardIntakeController.ts`
  (the draft keeps `operationId` for manual retries).
- Modify `src/lib/protectedFunctionsCapability.ts` (map `ai-card-quota` and `ai-daily-allowance` to
  non-retryable quota errors with reset time; map `operation-in-flight` to a retryable error).
- Create `src/features/plan/usePlanUsage.ts` and `src/features/plan/PlanUsageMeter.tsx`
  (Firestore `onSnapshot` on the two owner-readable documents, lazy-loaded).
- Modify the capture entry and account menu to mount the meter (`src/components/shell/LibraryManagementMenu.tsx`
  and the add-word surface found through `src/features/intake/useCardIntake.ts`).
- Modify `firestore.rules`: owner `get` on `users/{uid}/profile/plan` and `users/{uid}/ai_usage/{periodKey}`;
  no client writes; `ai_operations` and `ai_daily` stay default-deny. Update the exclusion comment at
  `:826-833` and `firestoreRulesSource.test.ts`.
- Modify `firestore.rules.test.ts` (owner can read, others cannot, nobody can write).
- Create `functions/test/aiQuota.test.ts`.

## Steps

1. Pure period logic with tests (month boundary at 00:00 Asia/Ho_Chi_Minh; Pro window).
2. Reserve/commit/refund transactions with emulator tests: concurrent reservations at `limit − 1`
   let exactly one through; two concurrent requests with the **same** `operationId` charge once;
   a late commit with an old `attemptId` is a no-op; refund runs once.
3. Wire the `word` branch and the allowance check for `story`/`translate`.
4. Sweeper with an emulator test (a `reserved` record 11 minutes old is refunded once).
5. Client operation id, draft reuse and error mapping; unit tests in `src/lib/gemini.test.ts`
   prove both retry attempts send the same id and that `operation-in-flight` is retried.
6. Meter and exhausted state; test that review and manual add stay enabled when exhausted.
7. Rules and rules tests (`npm run test:rules`).

## Validation

- Functions tests: 30 completions allowed, 31st refused; retry with the same id returns the stored
  result and does not change `used`; concurrent same-id requests charge once; in-flight answer is
  `unavailable` with `operation-in-flight`; takeover after 90 s does not charge again; Gemini error
  refunds; parse error refunds; missing `operationId` still charges once; the 21st Free `translate`
  of the day is refused and the card quota is unchanged.
- Emulator end to end: capture in the app with the functions emulator; the meter moves from 0 to 1;
  a manual retry of the same word after a forced failure does not move it twice.
- `npm run verify:bundle`: the initial chunk grows by < 1 KB gzip (the meter is lazy); CSS stays
  inside its budget (plan.md risks).

## Risk

| Risk | L × I | Mitigation |
|---|---|---|
| Quota refuses a paying learner by mistake | M × H | `quotaEnforced` switch in config; the operator can revoke and re-grant Pro (phase 04) |
| Another provider charge after a failed or timed-out retry | M × M | Completed results reuse the operation record; each retry reserves against the $5/day app cap. Owner accepted this pilot exception (red team #2) |
| Leaked reservations after a crash | L × L | Sweeper refunds within 25 minutes |
| New client meets old functions and every capture fails | M × H | Expand/contract deploy; rollback never returns to a parser without `operationId` (red team #4) |
| Stored results hold generated text | M × L | Server-only, 7-day TTL, deleted with the account (phase 06) |
| Extra reads and writes per capture (~4 reads, 4 writes) | H × L | Fine at pilot scale; revisit at the backend migration |
| TTL policy on `ai_operations.expiresAt` needs a gcloud change | M × L | Exact command with `--database` in the G1 checklist (phase 11) |

## Rollback

Set `quotaEnforced: false` in `_serviceConfig/pilot` (no deploy); the allowance and spend share can
be raised in the same document. For a code fault, roll hosting back first, then functions, and only
to a functions artifact that still accepts `operationId` while any client that sends it may be live
(red team #4). The new documents are additive.
