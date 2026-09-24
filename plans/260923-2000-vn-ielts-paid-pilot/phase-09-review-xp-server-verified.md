# Phase 09: Review XP, Again equals Good, server-verified

Effort: 2.75d (red team #5, #6: stats bootstrap, strict-path grant, receipt-based legacy filter,
client delta caps, `serverReviewXp` flag). Blocked by: none (reads `reviewBaseXp`,
`serverReviewXp` and `pilotTimezone` from phase 01 config, with code defaults if 01 is not live).
Release: R3 (G3).

> **Deferred until after the pilot (owner, 2026-09-23).** The pilot keeps the client-side +2 XP
> for every rating. Only the recap mismatch (`src/features/practice/StudyView.tsx:312` shows
> `good*5 + again*2`) is fixed in the pilot, in phase 08. The design below is kept for later.

## Context

- R3: Again earns the same base XP as Good, once per card per day, verified on the server,
  idempotent, no change to FSRS.
- **Today:** every committed review queues a client XP operation of +2 regardless of rating:
  `stagePatch` tags reviews with `reviewEffect: { xp: 2 }` (`src/features/librarySession/libraryReplica.ts:347`);
  settlement calls `addXp(effect.xp, 'review:' + opId)` (`src/app/useAppLearningCoordination.ts:178-179`,
  via `libraryReplica.ts:704-705`); the pending-replay path calls `current.addXp(2, 'review:' + opId)`
  (`src/features/learning/useLearningStatePersistence.ts:222`). Device storage only accepts
  `reviewEffect.xp === 2` (`src/lib/deviceSync.ts:695-697`).
- The server trusts any client XP delta up to `MAX_XP_OPERATION_DELTA = 1_000_000`
  (`functions/src/gamificationPersistence.ts:10`, checked at `:140`, applied in
  `applyGamificationForOwner` `:434-586`). So XP is not server-verified, and a card reviewed five
  times a day earns five times.
- Structured XP operations carry `clientId` and `sequence`; a missing sequence number throws
  `GamificationSequenceGapError` (`:66-73`, `:501-509`), which stalls every later save for that
  client. Dropping an operation without acknowledging its sequence would stall all XP (red team #6).
- `parseStoredStats` (`:317-345`) requires an exact key set on `users/{uid}/profile/stats` (`:408`)
  and throws `GamificationMigrationRequiredError` otherwise. A server write that creates `stats`
  with any other key set makes every later `saveGamification` fail (red team #5). `mergeActivity`
  (`:388`) lets the client snapshot set `streak` and `lastActive`. History lives in
  `users/{uid}/profile/xp_history` (`:411`).
- `reviewCard` (non-strict v1) and `reviewCardV2` (strict) share `reviewCardHandler`
  (`functions/src/index.ts:571-596`); only the strict path requires an operation and applies the
  receipt and skew checks (`:609-613`).
- `applyReviewForOwner` (`functions/src/reviewPersistence.ts:278-416`) is already a transaction with
  receipts per `(cardId, opId)`; a duplicate returns early (`:329`).
- The study recap shows `good*5 + again*2` (`src/features/practice/StudyView.tsx:312`), which does
  not match what the ledger grants.

## Design

1. **Grant on the strict path only (red team #6).** When `serverReviewXp` is true, the
   `reviewCardV2` transaction also reads `users/{uid}/review_xp_awards/{cardId}`, `profile/stats` and
   `profile/xp_history`. `day` = the review's `reviewedAt` in `pilotTimezone` (bounded by the
   5-minute future-skew check at `reviewPersistence.ts:337-340`). If the award's `day` differs,
   grant `reviewBaseXp` for any rating: set the award `{ day, opId, awardedAt }`, write
   `users/{uid}/review_xp_receipts/{opId}` `{ xpAwarded, day }`, add to `stats.xp` and to
   `xp_history[dayKey]` in the client's key format. Otherwise grant 0. The v1 `reviewCard` path
   grants nothing on the server.
2. **Stats bootstrap (red team #5).** If `profile/stats` does not exist, the transaction creates it
   through one shared builder exported from `gamificationPersistence.ts` that writes the exact v2
   key set `saveGamification` expects (`streak`, `xp`, `lastActive`, `appliedXpOperationIds`,
   `xpStreamSchemaVersion`). The review path never writes any other key.
3. **Streak ownership (red team #5).** `streak` and `lastActive` stay client-owned, as today through
   `mergeActivity`; the server grant touches only `xp` and `xp_history`. This keeps one owner per
   field and needs no change to the streak rule.
4. The review result and the stored review receipt gain `xpAwarded: number | null` (null when the
   flag is off or on the v1 path), so a replay returns the same value.
5. **Client.** When the response carries a number, the client does not queue a review XP operation
   and applies `xpAwarded` to the displayed snapshot as a local, non-queued adjustment until the
   next authoritative snapshot replaces it (verify in `useGamification.ts` that an authoritative
   snapshot overwrites local XP rather than adding to it; if not, add that rule with a test). When
   `xpAwarded` is null or missing, the client queues its legacy `+2` operation as today. This makes
   `serverReviewXp: false` a real rollback without a deploy.
6. **Legacy operation filter (red team #6).** In `applyGamificationForOwner`, a `review:{opId}`
   operation is acknowledged **without applying its delta** only if `review_xp_receipts/{opId}`
   exists (the server already granted it). Its sequence number is registered as applied, so no gap
   opens. Every other `review:` operation (made before the deploy, on the v1 path, or while the flag
   was off) applies as before.
7. **Client delta caps (red team #6).** Each client operation's delta is clamped to the maximum of
   its known source, identified by its id prefix: review 2, quiz and spelling 5
   (`src/features/practice/usePracticeGames.ts:150,222`), card creation 10
   (`src/features/intake/cardIntakePipeline.ts:635`); an unknown prefix is clamped to 10. Clamped
   operations are still applied and acknowledged, so sequences stay contiguous. Confirm the exact
   prefixes in `gamificationStorage.ts:331-400` before writing the clamp.
8. The recap shows the sum of `xpAwarded` for the session and "XP đang chờ đồng bộ" for reviews
   still pending.
9. Quiz, spelling and card-creation XP stay client-authored within the caps. Recorded as residual
   risk; no public league exists.

## Files

- Modify `functions/src/reviewPersistence.ts` (award and receipt read/write, stats bootstrap call,
  history update, `xpAwarded` in result and receipt, strict path only).
- Modify `functions/src/gamificationPersistence.ts` (export the v2 stats builder and day-key helper
  or add `functions/src/xpDay.ts`; receipt-based `review:` filter; per-source delta clamp).
- Modify `functions/src/index.ts` only if the review response mapping must pass `xpAwarded`.
- Modify `src/lib/cardReviewRepository.ts` (parse `xpAwarded`), `src/features/librarySession/libraryReplica.ts`,
  `src/lib/deviceSync.ts` (the review effect carries the server value; accept the old `xp: 2` shape
  for queued items), `src/features/learning/useLearningStatePersistence.ts:222`,
  `src/app/useAppLearningCoordination.ts:178-179`, `src/features/gamification/useGamification.ts`
  (local adjustment), `src/features/practice/StudyView.tsx:312` (recap).
- `firestore.rules`: nothing to add (`review_xp_awards` and `review_xp_receipts` are covered by
  default deny, `firestore.rules:6-7`).
- Tests: `functions/test/reviewPersistence.test.ts` and `functions/test/reviewCallable.test.ts`
  (Again = Good = base; second review same card same day = 0; next day = base; replay returns the
  same `xpAwarded` and changes nothing; v1 path returns null; flag off returns null; **review before
  the first `saveGamification` creates a stats document that the next save accepts**; FSRS output
  identical to a snapshot taken before the change), `functions/test/gamificationPersistence.test.ts`
  (receipt-backed `review:` ops acknowledged with no sequence gap; pre-deploy `review:` ops applied;
  a delta of 1,000,000 clamped to its source cap), `src/features/librarySession/libraryReplica.test.ts`
  and `useLibrarySessionPorts.test.ts` updates.

## Steps

1. Snapshot FSRS outputs for a fixed set of cards and ratings before touching code (golden test).
2. Stats builder, server grant and tests (including review before the first save).
3. Legacy filter, delta clamp and tests.
4. Client: skip review XP when `xpAwarded` is a number, apply it, recap; tests for both flag states.
5. Staging: review 10 cards with mixed ratings twice in one day; XP rises by `10 × base` once. Flip
   `serverReviewXp` to false, review again next day, and see the legacy path grant XP.

## Validation

- All tests above; `npm run verify:core`.
- Golden FSRS test unchanged.
- Staging check in step 5; old bundle (previous hosting release) against the new functions shows
  no double XP and no stalled XP stream.

## Risk

| Risk | L × I | Mitigation |
|---|---|---|
| Server creates `stats` with the wrong keys and blocks every later save | M × H | Shared v2 builder; "review before first save" test (red team #5) |
| Dropped legacy ops open sequence gaps or lose pre-deploy XP | M × H | Drop only receipt-backed ops and register their sequence (red team #6) |
| Review transaction contends with `saveGamification` on `stats` | M × L | Both are transactions; retries are automatic; one learner's traffic is low |
| Day key format mismatch shows wrong history | M × M | Reuse the exact client formats; tests compare server output with the client model |
| Local display adjustment double-counts after reload | M × M | Authoritative snapshot rule and a reload test |
| +3 reads and +4 writes per review | H × L | Acceptable at pilot scale; noted for the backend migration |

## Rollback

First set `serverReviewXp: false` in `_serviceConfig/pilot` (no deploy): the server stops granting,
responses carry null, and the new client falls back to its legacy operation. For a code fault,
roll back hosting and functions together (the old client ignores `xpAwarded`). XP already granted
by the server stays; no data repair needed.
