# Phase 4 final repair

Status: DONE_WITH_CONCERNS

Implemented lease-scoped immediate learning patch/review/delete/clear work, including ownership checks before protected, cleanup, mirror, backup, and acknowledgement operations. Review XP settlement now happens before acknowledgement; a settlement failure leaves the durable operation queued.

Device backup writes accept the scoped lease and carry its token. The dev adapter validates supplied PUT tokens while holding the backup-file lock; non-flush staging remains token-free. Pending-operation opens now have bounded blocked/timeout paths, close late connections, and validate the lease-store key shape. Added a fake-timer heartbeat test that renews past original expiry and confirms one release on callback throw.

Validation:

- `npx vitest run src/features/session/identitySessionController.test.ts src/lib/cardMirror.test.ts src/lib/deviceSync.test.ts src/lib/pendingOperationStore.test.ts src/features/librarySession/libraryReplica.test.ts src/features/learning/useLearningStatePersistence.test.tsx src/features/librarySession/useLibraryDeviceSync.test.tsx src/features/library/useCustomDeckWorkspace.ownerRace.test.ts devEndpointSecurity.test.ts --no-file-parallelism` — 174 passing.
- `git diff --check` — passing.
- `npx tsc --noEmit --pretty false` — blocked only by existing unrelated errors in `functions/src/libraryFacetPersistence.ts` and `src/features/sharing/sharedDeckSessionController.ts`.

Concerns/Blockers: Root typecheck remains red outside the assigned files; no changes were made there.

Follow-up: threaded the active `DevicePendingFlushLease` through the learning acknowledgement port, workspace adapter, and library device-sync adapter. All immediate learning acknowledgements and stale-epoch backup cleanup now receive that lease. Focused learning/workspace/device-sync tests passed (48 tests); root typecheck currently reports an unrelated `src/features/practice/practiceViews.test.tsx:279` mismatch.
