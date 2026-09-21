# Phase 5 shared-deck client idempotency

Status: DONE

## Changed files

- `src/features/sharing/sharedDeckSessionController.ts`
- `src/features/sharing/sharedDeckSessionController.test.ts`
- `src/features/sharing/sharedDeckFirebaseAdapter.ts`
- `src/features/sharing/sharedDeckService.ts`
- `src/features/sharing/sharedDeckService.test.ts`

## Result

The controller stores a 20-entry, 30-day create-operation ledger containing only the owner ID, opaque canonical request fingerprint, operation ID, and creation time. It reuses an entry only for the same owner and request, retains independent entries through ambiguous failures and reloads, and removes only the matching entry after a valid terminal create response. The limit fails closed for a new request rather than evicting any unresolved operation. Operation IDs use `share-v2:<epochMs>:<random>` and the epoch must exactly match the ISO creation timestamp. The adapter and service forward both values unchanged to `createSharedDeckV2`; load and revoke paths are unchanged.

## Validation

- `npx vitest run src/features/sharing/sharedDeckSessionController.test.ts src/features/sharing/sharedDeckService.test.ts` — passed (29 tests).
- `git diff --check` — passed.
- `npm run lint` — blocked by concurrent unrelated work: `src/features/library/useCustomDeckWorkspace.test.tsx:183` has an incomplete mock value and `src/features/practice/practiceViews.test.tsx:279` has an obsolete boolean mock return.

## Concerns

The server parser/persistence work must accept and enforce the forwarded `opId` and `operationCreatedAt` fields. No client-owned server/rules/query files were edited.
