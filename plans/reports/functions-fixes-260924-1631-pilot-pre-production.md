# Functions fixes: pilot pre-production review remediation

Source: `plans/reports/review-260924-1613-pilot-commits-before-production.md` (read from
the main repo tree; it does not exist inside this worktree). Scope: `functions/` only
(source and tests), plus one root file explicitly permitted, `firestore.indexes.json`.

## Row 3 — late deletion resume (`functions/src/accountData.ts`)

`resumeAccountDeletion`'s `deleting` branch now checks whether its own `purgeAfter` has
already elapsed before doing anything destructive. If it has (a job stuck since creation,
or interrupted mid-run) and the account has not been disabled yet, the fix:

- calls `auth.updateUser(uid, { disabled: true })` (tolerating `auth/user-not-found`),
- sets `purgeAfter = max(old, now + 65 min)` and stamps `disabledAt`,
- returns `'waiting'` without purging or deleting the Auth user in that same call.

The first entry after that (whenever it comes) sees `disabledAt` already set and proceeds
exactly like a fresh job: revoke, purge, delete the Auth user, mark `auth-deleted`. The
extended `purgeAfter` is what then guarantees a genuine 65-minute gap before the second,
catch-all purge, since the deadline check that gates it uses that same field. A fresh
job created through `beginAccountDeletion` is unaffected — its `purgeAfter` is already in
the future, so the new branch never triggers, and behavior for the non-late path is
byte-for-byte the same as before (verified by the pre-existing emulator test, which still
passes unchanged).

New test: `functions/test/accountDataFirestore.integration.test.ts` — "disables the Auth
account and restarts the 65-minute window when a stuck deletion is resumed late" —
creates a raw stuck tombstone (bypassing `beginAccountDeletion`), resumes it 3 hours late,
and checks the disable call, the extended deadline, that a second early resume performs
the real purge without disabling twice, and that the final resume after the new deadline
returns `'done'`.

## Row 4 — revoke error blocks deletion (`functions/src/accountData.ts`)

`revokeOwnSharedDecks`'s catch now treats `ownerUid === uid` as sufficient to delete the
deck and its ownership record directly, for either `SharedDeckMigrationRequiredError`
(the global migration fence, which can block even a schema-2 deck) or the newly added
`SharedDeckUsageStateError` (a corrupted usage document). The previous `schemaVersion===1`
restriction is dropped — a confirmed owner's own account deletion must not stall on a
revoke that will keep failing for any of these reasons.

New test: "deletes an owned deck directly when revoking it fails during account deletion"
— seeds a schema-2 deck with a corrupted `shared_deck_usage` document (`activeCount` is a
string), triggers `SharedDeckUsageStateError` on revoke, and asserts the deck and its
ownership record are both gone after `beginAccountDeletion`.

## Row 6 (server) — requestHash conflict (`functions/src/aiQuota.ts`)

`reserveWordOperation` now enforces the request hash only when the existing operation's
`status` is `reserved` or `completed`; a `failed` operation (settled with a null result,
e.g. after a refund) can be re-reserved under a different hash. A real conflict now
throws `AiQuotaError('operation-request-mismatch', ...)` instead of a plain `Error`.
`functions/src/index.ts` maps that reason to `HttpsError('failed-precondition', ...)`
(previously an uncaught plain `Error` surfaced to the client as `internal`).

New tests:
- `functions/test/aiQuotaFirestore.integration.test.ts` — "rejects a hash conflict on a
  live operation but allows a different hash once it failed" — reserves, hits the
  conflict while `reserved`, settles it to `failed`, re-reserves under a new hash, and
  confirms the conflict check still applies once that new attempt is `completed`.
- `functions/test/generateVocabularyCallable.test.ts` — "maps a request-hash conflict to
  failed-precondition instead of an internal error" — exercises the callable end to end
  with `reserveWordOperation` mocked to throw the new error.

## Row 7 — refund masks original error (`functions/src/index.ts`)

Each of the three refund call sites (word: `settleWordOperation(...null...)`, story and
translate: `refundNonCardAction`) is now wrapped in its own try/catch that logs
(`ai-word-refund-failed`, `ai-story-refund-failed`, `ai-translate-refund-failed`) and then
rethrows the original error, never the refund's own error.

New tests in `functions/test/generateVocabularyCallable.test.ts`:
- "refunds the reservation but rethrows the original error when the budget check fails" —
  forces a rate-limit error from the (mocked) Gemini budget check after a successful
  reservation, and checks the caller sees `resource-exhausted` (not `internal`) and that
  the refund (`settleWordOperation(..., null, ...)`) was attempted.
- "still rethrows the original error when the refund itself fails" — same, but the refund
  call also rejects; the original `resource-exhausted` error still reaches the caller, and
  the refund failure is logged.

## Lower-priority items, all implemented

- **Behavioural tests for `generateVocabulary`.** New file
  `functions/test/generateVocabularyCallable.test.ts` mocks every I/O boundary
  (`aiQuota.js`, `pilotConfig.js`, `accountData.js`, `rateLimiter.js`, `aiCostLedger.js`)
  and calls the real exported `generateVocabulary.run(...)`, covering: replay of a
  completed operation (and that it does **not** spend the Gemini budget or call the
  model), the hash-conflict mapping, both refund-preserves-original-error cases, and
  `settled === false` mapping to `unavailable`. Real Gemini is never called — Gemini
  invocation is fully replaced by a mock of `runMeteredGemini`. The old regex-only test
  in `functions/test/aiGeneration.test.ts` ("keeps AI generation on one instance...") was
  updated (not deleted, since it still usefully pins `maxInstances: 1` and the Gemini
  budget wiring per action) to match the new source shape: it now expects three
  `consumeBudget` call sites (one per action, each still spending the `gemini` scope) in
  place of the old single shared call.

- **`consumeBudget` no longer runs before the reservation for the word action.** It is
  now called only after `reserveWordOperation` returns a genuine `reserved` result (a
  cached `completed` replay returns immediately, before ever touching the budget), and it
  sits inside the same try/catch that refunds the reservation on any later failure
  (including the budget check itself failing). Story and translate keep their original
  relative order (`consumeBudget` before `reserveNonCardAction`) since they have no
  replay/poll state to protect against — that reordering was out of the requested scope
  and would only have added a wasted reserve-then-refund round trip for those two.

- **Account deletion leftovers**, all added to `purgeAccountData` in
  `functions/src/accountData.ts` (so both the immediate and the final catch-all purge
  clean them up):
  - deletes `admin_shared_deck_migration_quarantine` docs where `ownerUid === uid`;
  - removes the uid from `_serviceConfig/pilotExclusions.uids` via `arrayRemove` (a
    `set({...}, {merge:true})`, so it is a no-op if the doc or the uid is absent).

- **`operator_audit` TTL.** Added `export const OPERATOR_AUDIT_TTL_MS = 400 * 24 * 60 *
  60 * 1_000` to `functions/src/entitlements.ts` and used it on every new `operator_audit`
  row: `grantPro`, `revokePro` (both in `entitlements.ts`), and `resumeDeletionWithAudit`
  (`functions/src/pilotOperator.ts`). Retention chosen: 400 days, matching the AI cost
  ledger (`functions/src/aiCostLedger.ts:130`) — the closest comparable "ledger" retention
  in the codebase, and appropriate for a trail of privileged operator actions (Pro
  grants/revokes, deletion resumes) rather than the shorter 180-day retention used for
  analytics events and card reports. Note: setting `expiresAt` on the documents only
  prepares them for TTL; enabling the Firestore TTL policy on that field is an
  infrastructure step outside `functions/` and was not touched here (no existing script
  in this repo does that for the other ledgers either, as far as this pass found).

- **NFC normalization of the confirmation phrase.** `deleteMyAccount` in
  `functions/src/index.ts` now compares `request.data.confirmation.normalize('NFC').trim()`
  against `'XÓA TÀI KHOẢN'.normalize('NFC')`.

- **`finalizeDueDeletions` query.** Now queries
  `.where('status', 'in', ['deleting', 'auth-deleted']).where('purgeAfter', '<=', now)`
  instead of reading every tombstone and filtering in memory. Added the composite index
  to `firestore.indexes.json` (`account_tombstones`: `status` ASC, `purgeAfter` ASC).

## Files changed

- `functions/src/accountData.ts` — late-resume disable/extend branch, broadened
  shared-deck revoke bypass, quarantine + pilotExclusions cleanup in `purgeAccountData`,
  indexed query in `finalizeDueDeletions`.
- `functions/src/aiQuota.ts` — `operation-request-mismatch` reason, hash check scoped to
  `reserved`/`completed`.
- `functions/src/entitlements.ts` — `OPERATOR_AUDIT_TTL_MS`, `expiresAt` on grant/revoke
  audit rows.
- `functions/src/index.ts` — hash-conflict mapping to `failed-precondition`, per-branch
  `consumeBudget` placement, refund try/catch on all three sites, NFC confirmation
  compare.
- `functions/src/pilotOperator.ts` — `expiresAt` on the `resume-deletion` audit row.
- `firestore.indexes.json` — composite index for `account_tombstones` (`status`,
  `purgeAfter`).
- `functions/test/accountDataFirestore.integration.test.ts` — late-resume test, shared-deck
  revoke-bypass test, `fakeAuth()` now also stubs `updateUser`.
- `functions/test/aiQuotaFirestore.integration.test.ts` — hash-conflict/re-reservation test.
- `functions/test/aiGeneration.test.ts` — updated the per-action `consumeBudget` source
  assertion to match the new call sites.
- `functions/test/generateVocabularyCallable.test.ts` (new) — behavioural coverage of
  `generateVocabulary` described above.

## Verification

- `npm --prefix functions run lint` (tsc --noEmit): clean.
- `npm --prefix functions run build` (tsc): clean.
- `npm --prefix functions test`: 269 passed, 38 skipped (the skipped ones are the
  Firestore-emulator integration suites, gated on `FIRESTORE_EMULATOR_HOST`).
- `npm run test:rules` (root script; starts the Firestore + Auth emulators, runs the root
  rules suite and the `functions/` emulator integration tests): 64 + 38 = 102 tests
  passed, including the 6 `accountDataFirestore.integration.test.ts` tests (up from 4)
  and the 7 `aiQuotaFirestore.integration.test.ts` tests (up from 6). Java/the emulator
  were available in this environment, so this ran to completion rather than being
  skipped.

## Deviations / things worth flagging

- `firestore.indexes.json` was edited as explicitly permitted. No other file outside
  `functions/` was touched.
- The `OPERATOR_AUDIT_TTL_MS` retention (400 days) is a judgment call stated above and in
  the code comment; there was no existing named constant for it, and no dedicated
  "operator audit" retention precedent in the codebase to copy verbatim.
- Real Gemini was never called, real network calls were never made from the new unit
  tests: every Firestore- or Gemini-touching dependency of `generateVocabulary` is mocked
  in `generateVocabularyCallable.test.ts`. Firestore emulator integration tests exercise
  real Firestore through the emulator only, per the existing repo pattern.
