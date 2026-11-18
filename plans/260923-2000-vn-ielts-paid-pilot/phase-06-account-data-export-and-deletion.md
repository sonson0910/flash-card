# Phase 06: Account data export and deletion

Effort: 2.5d (red team #7: token revocation, tombstone checked by callables, legacy decks, rate-limit
documents, resume mode, two-client test). Blocked by: 04 (entitlements, operator tool, audit), 05
(events to delete). Release: R3 (G3).

## Context

- GPT P0 #6: export and delete, and a stated data policy, before selling broadly. The privacy page
  from phase 03 promises both; until this phase ships, requests are handled by the operator by email
  (state that on the page for W1).
- Card export already exists as a spreadsheet (`src/features/importExport/useLibraryExport.ts:49`,
  menu entry `src/components/shell/LibraryManagementMenu.tsx:132-139`). "Clear library" exists
  (`src/app/useAppLearningCoordination.ts:325`). There is no account deletion and no export of
  non-card data.
- Everything owned by a learner sits under `users/{uid}` (cards, reservations, tombstones, profile
  docs, `xp_streams`, receipts, and the new `ai_usage`, `ai_operations`, `ai_daily`,
  `entitlements`, `review_xp_awards`), plus top-level records: `ai_cost_ledger` and `card_reports`
  (by uid), `shared_decks`/`shared_deck_owners`, `analytics_events` and `operator_audit` (by pid).
  No `payment_orders` exist in the pilot.
- Rate-limit documents in `_functionRateLimitBudgets` are keyed by a hash of uid and scope
  (`functions/src/rateLimiter.ts:78-82`). They carry an `expireAt` field (`:218`), but no TTL policy
  for it is verified, so they do not reliably expire and must be deleted by id (red team #7).
- A Firebase ID token stays valid for up to one hour after issue, and deleting the Auth user does
  not stop a second signed-in device from writing through the rules or calling callables in that
  hour, which could recreate data after deletion (red team #7).
- `revokeSharedDeckAtomically` (`functions/src/index.ts:689`) needs an ownership document; legacy
  shared decks without one make it throw (red team #7; whether any exist in production is an open
  question in plan.md).
- Local data lives in the browser (device store, card mirror, gamification storage scoped by owner),
  see `src/lib/deviceStore.ts` and `src/features/gamification/gamificationStorage.ts`.

## Requirements

1. **Export:** an "Account data" section in the account menu offers (a) the existing card
   spreadsheet and (b) "Download account data (JSON)" from a new `exportMyData` callable returning
   profile stats, XP history, plan, entitlements, usage and allowance counters, own card reports and
   a count of analytics events. Rate limit 5/hour.
2. **Delete:** "Delete my account" with a typed confirmation and a fresh Google sign-in
   (`auth_time` within 5 minutes, checked on the server). `deleteMyAccount` callable, in this order
   (red team #7):
   1. Revoke the user's refresh tokens (`auth.revokeRefreshTokens(uid)`).
   2. Write the tombstone `account_tombstones/{pid}` `{ uid, status: 'deleting', startedAt,
      purgeAfter: now + 65 min, expiresAt: +30 days }`. It is the only job record (it replaces the
      earlier `account_deletions` document). Every callable checks it through the shared
      owner-resolution path and refuses a tombstoned uid.
   3. Revoke shared decks: decks with an ownership document through `revokeSharedDeckAtomically`;
      legacy decks found by `authorUid == uid` without an ownership document are deleted directly.
   4. `recursiveDelete(users/{uid})`.
   5. Delete `ai_cost_ledger` and `card_reports` documents by uid, `analytics_events` by pid, and the
      `_functionRateLimitBudgets` documents whose ids are computed from the uid and each known scope.
   6. Delete the Firebase Auth user; set the tombstone `status: 'auth-deleted'`.
   7. **Final purge** after `purgeAfter` (every ID token issued before step 1 has expired): a
      scheduled function reruns steps 4-5 once, catching anything a second device wrote in the
      hour, then sets `status: 'done'` and removes `uid` from the tombstone.
   Every step is idempotent. `operator_audit` records keep only the pid.
3. **Resume (red team #7):** the phase 04 operator gains `resume-deletion` (`pid`), which reruns the
   remaining steps from the tombstone's `uid` and `status` even after the Auth user is gone.
4. The client then signs out and clears all owner-scoped local stores for that uid; an anonymous
   session is not affected.
5. An active Pro entitlement ends with the account; the dialog says so (no payment was taken in the
   pilot).

## Files

- Create `functions/src/accountData.ts` (export assembly, deletion job, final purge).
- Modify `functions/src/index.ts` (`exportMyData`, `deleteMyAccount`, the scheduled final purge, the
  tombstone check in the shared owner-resolution path used by every callable).
- Modify `functions/src/pilotOperator.ts` (`resume-deletion` mode).
- Create `src/features/account/AccountDataSection.tsx`, `src/features/account/accountDataService.ts`
  (lazy); modify `src/components/shell/LibraryManagementMenu.tsx` to open it.
- Reuse the owner-scoped clearing already used on sign-out (locate through
  `src/features/session/identitySessionController.ts`); add nothing new if it clears every store.
- Update `public/privacy.html` (self-service export and deletion; tombstone kept 30 days with a
  pseudonymous id).
- Tests: `functions/test/accountData.test.ts` (emulator: seed every collection, delete, assert empty;
  rerun after a simulated failure at each step; legacy deck without ownership document), a
  two-client test (client B keeps a valid token, writes a card and calls a callable after A deletes
  the account: the callable is refused and the final purge removes the card), and a client test that
  local stores for the uid are gone.

## Steps

1. Inventory test: seed one user in every collection listed above so a future collection without a
   deletion rule fails the test (update the list when a phase adds a collection).
2. Export callable and UI.
3. Deletion job, tombstone check, final purge, recent-auth check, client clean-up.
4. `resume-deletion` operator mode with a test that resumes after the Auth user is gone.
5. Try on staging with a throwaway Google account on two browsers, then on production (G3) with a
   second throwaway account.

## Validation

- Emulator test proves nothing remains under `users/{uid}`, in the uid-keyed collections, in
  `analytics_events` for the pid or in the uid's rate-limit documents.
- The two-client test passes; the tombstone ends as `done` without a `uid` field.
- The Auth user no longer exists; signing in again creates a fresh empty account (a new uid).
- The export JSON opens and contains no other user's data (test with two seeded users).

## Risk

| Risk | L × I | Mitigation |
|---|---|---|
| Another device recreates data after deletion | M × M | Token revocation, tombstone check in callables, final purge after 65 minutes (red team #7) |
| Deleting the wrong account | L × H | Server uses only `request.auth.uid`; recent sign-in; typed confirmation |
| Partial deletion, or failure after the Auth user is gone | M × M | Tombstone job record, idempotent steps, operator `resume-deletion` |
| Legacy shared deck makes deletion throw | M × M | Direct delete by `authorUid` for decks without ownership documents |
| Large libraries time out | L × M | 5,000-card cap (`functions/src/cardPersistence.ts:11`); `recursiveDelete` batches; timeout 300 s |

## Rollback

Hosting rollback hides the section; functions rollback removes the callables but must keep the
scheduled final purge while any tombstone is not `done` (or the operator runs `resume-deletion`).
Deletions already done cannot be undone; that is the intended behaviour and is stated in the dialog.
