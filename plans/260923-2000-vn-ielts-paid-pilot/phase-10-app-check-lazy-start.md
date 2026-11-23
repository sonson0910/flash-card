# Phase 10: App Check changes (deferred, not in the pilot)

Effort: 0d in the pilot. Blocked by: not scheduled. Release: none. The phase number and file name
stay so links and numbering do not change.

## Decision (red team #15, owner, 2026-09-23)

Both App Check changes are out of the pilot. The lazy start was already dropped because the console
enforces App Check for Firestore or Auth. The token TTL raise is now removed too, and gate G4 no
longer exists. An App Check token is a bearer token for its whole lifetime, and App Check is the only
anti-bot protection in front of the AI callables (`enforceAppCheck` on every `onCall`,
`functions/src/index.ts:91-94`), so a longer TTL makes a stolen token worth more. At 30 learners
there is no cost benefit: the owner used 394 of the free 10,000 monthly assessments in 30 days
(Firebase cost audit). Revisit when real usage approaches the free tier, and then prefer
limited-use tokens on the AI calls over a longer TTL.

## Evidence kept for the revisit

- App Check starts on every page with auto-refresh (`src/lib/firebase.ts:45-48`,
  `isTokenAutoRefreshEnabled: true`), and the client capability requires it at boot
  (`src/lib/firebase.ts:75-80`, `src/lib/protectedFunctionsCapability.ts:53-60`).
- Every callable enforces App Check, not only AI, and source tests assert it for `saveGamification`
  and `createCard` (`functions/test/gamificationPersistence.test.ts:113`,
  `functions/test/cardPersistence.test.ts:629`).
- The console enforces App Check for Firestore or Auth (owner answer, 2026-09-23), so any lazy start
  must first stop that enforcement.

## Rollback

Nothing ships, so there is nothing to roll back. The pilot keeps today's App Check settings.
