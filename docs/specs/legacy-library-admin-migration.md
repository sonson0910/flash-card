# Spec: Legacy library Admin migration

## Objective

Repair owner-scoped legacy card libraries that cannot be upgraded by the browser
because their words are non-canonical or duplicate. The repair must make every valid
card searchable/pageable under schema v2 without losing the strongest learning state.

## Commands

- Targeted tests: `npm --prefix functions test -- legacyLibraryMigration`
- Functions verification: `npm --prefix functions run lint && npm --prefix functions test && npm --prefix functions run build`
- Repository verification: `npm run verify`
- Operator dry-run: dispatched only by the protected GitHub migration workflow; emits
  12-character SHA-256 owner keys and aggregate counts only. Every owner gets a row with
  its job phase: an owner already applied, rolled back, blocked (with its reason code) or
  fenced does not stop the run. A row carries a source revision only for a phase that
  apply (`discovered`) or rollback (`verify`, `apply`, `complete`, `rollback`) accepts
- Operator apply/rollback: dispatched only after selecting exactly one owner key from
  a clean dry-run for the same revision and target
- Operator catalog-progress repair (`MIGRATION_CONFIRMATION=REPAIR_CATALOG_PROGRESS`):
  writes the missing or outdated `catalog_progress` projection of every lexeme card in
  each owner's current library, which cards written before the projection existed lack.
  Idempotent; a fenced owner is reported as `skipped: migration-fence` and left for a
  later run. Reports owner keys with scanned and repaired counts only
- Operator restart (`MIGRATION_CONFIRMATION=RESTART_QUERY_V3`, owner key only): after the
  cause a dry-run reported for a `blocked` owner is repaired, or after a `rolled-back`
  owner's cause is fixed and a fixed release is deployed, starts that owner's job over
  with a new scan. A blocked job never applied a group, so its manifest and backup root
  are retired with it. A rolled-back job's rollback backup is kept: its root, plans and
  source backups move to the backup id `<job id>:rolled-back:<retired scan id>`, which
  no later apply or rollback reads. Any other phase is refused. Dispatch dry-run again
  and approve the revision it reports
- Library changed after the dry-run: apply fails without migrating anything, releases
  the fence and reopens discovery for that owner; dispatch dry-run again and approve
  the new revision it reports. The earlier revision is never applied

## Project structure

- `functions/src/legacyLibraryMigration.ts`: pure planning and Admin persistence service
- `functions/src/index.ts`: authenticated, App Check-protected bounded callable
- `functions/test/legacyLibraryMigration.test.ts`: planner and persistence contracts
- `src/features/librarySession/`: browser callable adapter and owner-session orchestration
- `.github/workflows/`: protected production operator entry point

## Code style

Use explicit result unions and bounded inputs. All owner identity comes from verified
Auth or the protected operator scan, never from a browser-provided UID.

```ts
type MigrationResult = {
  scanned: number;
  migrated: number;
  merged: number;
  complete: boolean;
};
```

## Testing strategy

- Pure unit tests prove normalization, primary selection, canonical IDs and tombstones.
- Fake-Firestore service tests prove dry-run has no mutations and apply is idempotent.
- Client contract tests prove the browser uses the protected callable and refreshes page 1.
- Full repository verification remains the release gate.

## Boundaries

- Always: scope mutations to one authenticated owner, check library epoch, create a
  server-only rollback snapshot before apply, preserve the strongest learning record,
  reject identity groups over 100 source cards, and verify zero
  duplicate/invalid/missing-reservation identities afterward.
- Ask first: changing identity normalization, Firestore Rules, or deleting rollback data.
- Never: expose service-account credentials, accept a caller-provided owner UID, skip
  malformed cards, overwrite a newer epoch, or upload plaintext card data as an artifact.

## Success criteria

- The 1,175-card legacy library can complete from one protected operator run.
- Search, filters and normal paging include every migrated valid card without reload.
- Duplicate groups converge to the stable `createWordCardId` equivalent, preserve the
  strongest learning state and leave durable tombstones for non-canonical source IDs.
- `profile/query_migration` is marked complete only after final verification.
- Dry-run and apply reports contain counts only; rollback snapshots remain server-only.
- Functions, root tests, browser tests, audit and bundle gates pass before deployment.

## Rollback

Disable the callable/deploy the previous Functions artifact, then dispatch protected
`rollback` with the selected owner key and `ROLLBACK_QUERY_V2`. Restoration proceeds
only when owner epoch, final card count and migrated revisions still match the recorded
job, and none of the removed source IDs has been recreated.
