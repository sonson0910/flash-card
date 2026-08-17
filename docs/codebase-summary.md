# Codebase summary

Generated from `repomix-output.xml` and verified against the current source tree.

## Product and runtime

SonFlash is an offline-first React 19/TypeScript vocabulary workspace. Vite serves the
browser application; Firebase Authentication, Firestore, App Check, Hosting, and callable
Functions provide the cloud boundary. Node.js 22 is required. Firestore Rules and the
full release gate require Java 21 for emulator execution.

## Repository map

| Area | Responsibility |
| --- | --- |
| `src/app/` | Application composition and feature coordination |
| `src/features/` | Library, sync, intake, learning, practice, catalog, sharing, and release-readiness domains |
| `src/lib/` | Firestore repositories, card identity, mirrors, protected Functions calls, and shared utilities |
| `src/components/` | Shell, flashcard, study, stats, motion, and reusable UI components |
| `functions/src/` | App Check-protected callable Functions, Admin migration, release/evidence helpers, and validation |
| `firestore.rules` | Owner boundaries, card identity/reservation invariants, write-fence Rules, and server-only migration progress |
| `functions/test/`, `src/**/*.test.*`, `firestore.rules.test.ts` | Unit, adapter, repository, and emulator-facing verification |
| `.github/workflows/` | Workflow-only release, migration, evidence, and deployment operations |
| `docs/architecture/`, `docs/specs/`, `docs/runbooks/` | Architecture decisions, implementation contracts, and human-gated operations |

## Persistence boundaries

Learner-owned cards, reservations, tombstones, library state, mirrors, and pending
operations are scoped to the authenticated owner. The browser maintains bounded local
replicas and durable pending work; Firestore is authoritative when signed in. Shared
catalog releases use immutable, provenance-aware cache boundaries and are not treated as
private library data.

Shared-deck persistence is a separate server-managed boundary. Firestore Rules deny all
client reads, queries, and writes for `shared_decks`; `shared_deck_owners` is server-only.
The browser calls the unauthenticated but App Check-enforced `loadSharedDeck` Function for
unlisted links. `functions/src/sharedDeckPersistence.ts` checks the exact top-level
schema, schema version, Firestore timestamps, expiry, and canonical public payload before
returning only `{ category, cards }`. `functions/src/inputValidation.ts` enforces the
100-card and encoded-size limits, exact public-card field allowlist, bounded strings and
string lists, and HTTPS media-host allowlists. Authenticated App Check-protected create
and revoke callables use atomic Admin transactions; owner metadata never enters the
public projection.

Current card mutation transactions coordinate with
`users/{ownerId}/profile/library_state`. `libraryEpoch` fences destructive resets and
`mutationGeneration` is an owner write fence: real client card/reservation/tombstone
mutations atomically advance it exactly once. Firestore Rules require `getAfter` state
to equal the prior generation plus one for current-generation card writes. Migration
progress at `profile/query_migration` is server-written and owner-readable only.

## Legacy library migration

`functions/src/legacyLibraryMigration.ts` implements a bounded `apply → verify →
complete` state machine. `functions/src/legacyLibraryMigrationFirestore.ts` reads at
most 100 source cards plus one probe per page, compares epoch and mutation generation,
creates server-only backups, applies canonical IDs/reservations/tombstones, and marks
completion only after a clean verification scan from document-ID start. Progress version
3 rejects stale version-2 completion evidence. Rollback requires completed v3 generation,
matching owner state, unchanged applied revisions, and no recreated source IDs.

The browser callable is bounded to 30 batches per action. The protected Admin operator
handles one explicit owner, 100-card pages, and at most 100 batches. Legacy clients may
read after enforcement, but writes that omit the atomic generation update fail closed.

## Release boundary

Release candidates are sealed from one clean revision and deployment is workflow-only
and human-gated. The detailed attestation, candidate, promotion, and rollback contract is
kept authoritative in `docs/runbooks/phase-6-rollout.md`; this summary does not duplicate
that operating procedure.

## Verification surface

```text
npm run lint                         TypeScript check
npm test -- --run                    Browser/application tests
npm --prefix functions run lint      Functions TypeScript check
npm --prefix functions test          Functions tests
npm run test:rules                   Java 21 Rules + Firestore Emulator integration
npm run verify:core                  Core checks including Rules emulator
npm run verify                       Full release verification and evidence checks
```

The current environment has no Java runtime, so emulator-backed Rules and migration
integration acceptance must be rerun on Java 21. Focused migration unit/adapter tests and
Functions type-checking are independently runnable without emulator credentials.
