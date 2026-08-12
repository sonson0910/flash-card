# Spec: Owner-scoped Library Replica

## Objective

Deepen the existing card synchronization cluster into one owner-scoped Library
Replica module without changing user-visible behavior or persisted schemas. The
module must hide identity reservation, library epoch, revision, tombstone,
pending-operation, device-backup and IndexedDB mirror coordination from React
callers while preserving every ADR-006 invariant and current offline behavior.

Success means `useLibraryDeviceSync` coordinates React state and browser effects,
but delegates owner mutation staging, pending reconciliation and complete-mirror
refresh through the Library Replica interface.

## Tech stack

- React 19 and TypeScript
- Firebase Firestore
- Native IndexedDB and the development-only Shared Device Store
- Vitest with fake/in-memory adapters

## Commands

```bash
npx vitest run src/features/librarySession/libraryReplica.test.ts
npx vitest run src/features/librarySession/useLibraryDeviceSync.test.tsx
npx vitest run deviceBackupReconciliation.test.ts src/lib/cardRepositoryUniqueness.test.ts src/lib/cardMirror.test.ts
npm run lint
JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home" npm run verify:core
npm run build
git diff --check
```

## Project structure

- `src/features/librarySession/libraryReplica.ts` — deep owner-scoped module and
  its production adapter composition.
- `src/features/librarySession/libraryReplica.test.ts` — contract tests through
  the Library Replica interface.
- `src/features/librarySession/useLibraryDeviceSync.ts` — React lifecycle,
  presentation state and anonymous-device behavior.
- `src/lib/cardRepository.ts` — Firestore adapter implementation.
- `src/lib/cardMirror.ts` — IndexedDB adapter implementation.
- `src/lib/deviceSync.ts` — pending queue and Shared Device Store adapter.

## Code style

Callers express an intent and do not assemble protocol metadata or storage order:

```typescript
await replica.stage({
  type: 'patch',
  changes,
  operationId,
  nextTotal,
});

await replica.flush({ manualRetry: true, verifiedEpoch });
```

The module owns normalization, epoch binding, conflict recovery, safe local
cleanup, acknowledgement ordering and single-flight behavior.

## Testing strategy

- Characterize the existing hook behavior before moving each slice.
- Test the new module through `stage`, `flush`, `refreshMirror` and
  `refreshPending`; adapters are test doubles at the seam.
- Keep repository, mirror and device reconciliation tests as adapter contracts.
- Preserve owner-switch, stale/future epoch, duplicate create, revision conflict,
  tombstone and interrupted mirror-generation coverage.
- Run the complete core verification and production build after all slices.

## Boundaries

- Always: scope every operation to one immutable owner ID; queue before cleanup;
  acknowledge only after cloud and local reconciliation succeed; retain
  single-flight flush/mirror behavior.
- Ask first: Firestore/IndexedDB schema changes, migration or deletion of user
  data, new dependencies, Rules changes, production operations.
- Never: weaken ADR-006 identity/tombstone invariants, expose one owner's cache to
  another, treat an incomplete mirror as authoritative, or add a second write path.

## Success criteria

1. React callers do not directly coordinate reservation, epoch, revision,
   tombstone, mirror and pending-queue operations.
2. Create, patch and delete intents cross one owner-scoped staging interface.
3. Pending reconciliation and mirror refresh are single-flight within the module.
4. Existing hook, adapter, owner-race and full core tests remain green.
5. No persisted schema, Rules, migration, dependency or user-visible behavior changes.

## Open questions

None for this behavior-preserving phase. Production migration and schema changes
remain explicitly outside scope.
