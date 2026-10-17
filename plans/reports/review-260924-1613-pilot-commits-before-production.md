# Review: pilot commits before the production go

Reviewed 2026-09-24: `git diff 1347e64..482e1aa`, 21 commits, 127 files, about 7,000 added lines.

The review was split across three independent reviewers:
- AI cost and quota;
- privacy, deletion and Firestore Rules;
- client, extension and staging tooling.

The controller re-checked the top findings against the source.

## Verdict

**Good enough for staging. Fix before the production go (G1).**
- The review found no quota bypass, no Pro grant a client can spoof, no spend-cap bypass, and no route by which one user can read another user's data.
- Nine defects should be fixed before production. Two of them break the separation between staging and production, and one lets a delayed account deletion leave data behind.
- The focused unit tests pass, and Functions `tsc` is clean.
- Gitleaks has two hits, both in `firebase-targets/staging.json`: the public Firebase web config and the App Check site key. Neither is a secret.
- No commit message or code comment carries a plan id.

## Fix before G1 (production)

| # | Area | Defect | Where | Fix |
|---|---|---|---|---|
| 1 | Release | `staging:deploy:hosting` uploads whatever is in `dist` without checking the target. The staging config strips the predeploy hooks, so a production build can be served from the staging domain and write to production data. | `package.json:20`, `scripts/generate-build-metadata.mjs` | Chain `build:staging && verify:secrets:staging` into the script. Write `target` and `projectId` into `health.json` and check them before each deploy, in both directions. |
| 2 | Release | `vite.config.ts` resolves `SONFLASH_TARGET` through `loadEnv`, which reads `.env.local`, `.env.production.local` and similar files. `verify:release-config` only loads `.env.production`. A staging target set in `.env.local` would pass every production predeploy check. This is latent: no env file sets the variable today. | `vite.config.ts:29`, `package.json:24` | Read the target only from `process.env`, and add the `health.json` check from row 1. |
| 3 | Deletion | When a deletion stuck in `deleting` is resumed late, the Auth user is deleted and the final purge runs at once, because the original `purgeAfter` has already passed. The 65-minute guard against a second device disappears. Meanwhile the user is not disabled, so they can sign in again and write directly through Rules while the job is stuck. | `functions/src/accountData.ts:105-117`, `:120` | On the `deleting` branch, set `purgeAfter = max(old, now + 65 min)` and return `waiting`. Call `auth.updateUser(uid, {disabled: true})` before writing the tombstone. Add a late-resume test. |
| 4 | Deletion | One shared-deck revoke error blocks the whole deletion: a `SharedDeckUsageStateError`, or the migration fence on a schema-2 record. The job then fails every 15 minutes indefinitely. | `functions/src/accountData.ts:58-69` | During account deletion, `ownerUid == uid` is enough. On a revoke error, delete the deck and its ownership record directly. |
| 5 | Deletion | The client call uses the 70 s SDK default, but the server allows 300 s. On a timeout or an `internal` error after the tombstone is written, local data is not cleared, the user is not signed out, and the message says the deletion failed. | `src/features/account/accountDataService.ts:14-18`, `:72-81` | Use `{timeout: 300_000}`. Treat any error other than a validation error as "deletion started": clear local data, sign out, and say the deletion will finish automatically. |
| 6 | AI quota | The server compares a hash of `{word, context, language}` even on a failed operation. The client keys the draft operation id on the word only. A failed extension capture with a context, followed by a Generate in the app, returns a permanent `internal` error until the word is edited. | `functions/src/aiQuota.ts:62`, `src/features/intake/cardIntakeController.ts:338-343` | Enforce the hash only for `reserved` or `completed` operations. Map a real conflict to `failed-precondition` with a reason. Key the draft id on word, context and language. |
| 7 | AI quota | A refund that throws replaces the original error: the learner sees `internal` instead of `resource-exhausted` or `deadline-exceeded`. For story and translate, the daily unit is never returned. | `functions/src/index.ts:502`, `:536`, `:563` | Wrap each refund in its own try/catch that logs, then rethrow the original error. |
| 8 | Study | A horizontal drag inside the Edit or Report dialog, or on its backdrop, bubbles through the React portal to the study card's swipe handlers and can rate the card underneath. | `src/features/practice/StudyView.tsx:126-176` | Ignore touches whose target is outside the card element or inside `[role="dialog"]`, `input`, `textarea` or `select`. |
| 9 | Edit | The draft is captured when the dialog opens but diffed against the live card at save. A sync from another device in between is silently overwritten. A save that writes nothing (stale patch, owner conflict) still closes the dialog as saved. | `src/features/cardEdit/EditCardDialog.tsx:15`, `editCardModel.ts:24`, `src/features/learning/useLearningWorkspace.ts:175-181` | Diff against the card as it was when the dialog opened, or refuse the save if the revision moved. Return the patch outcome and show an error unless it is published or durably queued. |

## Lower priority (can follow the pilot start)

- The `generateVocabulary` handler has no behavioural test for refunds, replay, `settled === false` or hash conflicts. The existing test only regex-checks the source.
- `consumeBudget` runs before the reservation, so polling an in-flight operation or replaying a completed one uses up the hourly budgets.
- The plan meter uses the device clock against `proStart`. A granted Pro learner whose clock is a few seconds behind sees "Free, exhausted" until the month ends. Allow a small clock skew or schedule a refresh at `proStart`.
- Account deletion leaves some data behind:
  - `admin_shared_deck_migration_quarantine` (`ownerUid`, deck data) is not deleted;
  - `_serviceConfig/pilotExclusions.uids` keeps the raw uid;
  - `operator_audit` rows have no `expiresAt`.
  Either delete them or state their retention on the privacy page.
- Local cleanup misses `lingoflash_shared_deck_operation_v1`.
- The phrase "XÓA TÀI KHOẢN" is compared byte for byte. Normalize to NFC on both client and server.
- `finalizeDueDeletions` reads every tombstone every 15 minutes. Query by status and `purgeAfter` instead.
- "Báo thẻ sai" is shown to guests on device-only cards. Every failure says "check the connection". Hide the action when no one is signed in, and map each error to its own message.

## Verified correct

- **Quota transactions:** reserve, settle and refund are ordered correctly, with attempt ids, sweeper rechecks and per-user operation ids.
- **Spend cap:** the global and account shares are checked in one transaction, with day-correct corrections, and the cap fails closed.
- **Time boundaries:** the Asia/Ho_Chi_Minh day and month boundaries are right.
- **Pro grant:** operator-only, confirmed and audited.
- **Rules:** clients are denied every ledger, quota, analytics, report and audit collection. `origin` is immutable.
- **Analytics:** keyed HMAC pseudonyms and strict schemas; no uid, text, URL or operationId reaches events.
- **Export:** returns only the caller's data.
- **Deletion coverage:** covers `users/{uid}` recursively, plus the ledger, card reports, events and 17 rate-limit scopes.
- **Report action:** present in both the Zen and standard layouts. No flashcard effect was removed.
- **Recap XP:** `(good + again) × 2`.
- **Extension protocol:** backward compatible.
- **Staging bundle:** contains the staging `appId` and App Check key, and no production project id.

## Open questions

- Are there documents in `admin_shared_deck_migration_quarantine` on production? Decide whether to delete them on account deletion or keep them and disclose it.
