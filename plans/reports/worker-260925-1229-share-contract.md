# Share contract implementation report

Date: 2026-09-25 (Asia/Saigon)
Revision: `47a1bdc2e5b102ff616f57a1ac7573c00f239fcf` (working tree remains uncommitted and shared)

## Implemented

- Kept shared-deck schema v2 at the deck level: only a complete canonical target/native pair is emitted, fingerprinted, byte-counted, migrated, and stored. Per-card `translationLanguage` remains outside the wire projection. Language names such as `english` are rejected by the canonical language-code validator.
- Kept missing and mixed legacy language metadata unknown. A valid canonical card identity can supply its target language; native language comes only from a valid, non-conflicting deck pair. A deck pair that conflicts with a canonical card target is rejected at request validation and ignored when previewing legacy public data.
- Preserved only `origin: 'ai' | 'manual'` through client projection, server parsing, fingerprints, persistence, migration digest/application, preview samples, and card adoption. Invalid or absent legacy origin remains absent. The preview aggregate scans every card, including cards beyond the four-word sample.
- Incoming samples now include translation, resolved target/native labels, and safe origin. Incoming previews include public `createdAt` and `expiresAt` as ISO strings or `null`; outgoing previews include server `expiresAt` and the aggregate AI flag. No sender or private owner fields were added.
- Updated the Firebase migration mapping note to preserve explicit language metadata and safe origin without assigning defaults or copying owner identity.

## Files

Implementation and tests:

- `functions/src/inputValidation.ts`
- `functions/src/legacySharedDeckMigration.ts`
- `functions/test/inputValidation.test.ts`
- `functions/test/legacySharedDeckMigration.test.ts`
- `functions/test/sharedDeckPersistence.test.ts`
- `functions/test/sharedDeckPersistenceFirestore.integration.test.ts`
- `src/features/sharing/sharedDeckService.ts`
- `src/features/sharing/sharedDeckService.test.ts`
- `src/features/sharing/sharedDeckSessionController.ts`
- `src/features/sharing/sharedDeckSessionController.test.ts`
- `src/features/intake/cardIntakeController.ts`
- `src/features/intake/cardIntakeController.test.ts`
- `plans/260923-1831-global-multilingual-launch/backend/phase-07-firebase-migration-tooling.md`

`functions/src/sharedDeckPersistence.ts` already contained the Phase 01 deck-pair storage changes in the shared working tree; this worker made no additional source edit there. The updated unit test confirms safe origin and pair data are passed into the public document and included in byte accounting.

## Checks

| Command | Result |
|---|---|
| `npm test -- --run src/features/sharing/sharedDeckService.test.ts src/features/sharing/sharedDeckSessionController.test.ts src/features/intake/cardIntakeController.test.ts firestoreRulesSource.test.ts` | PASS, 4 files / 76 tests |
| `npm --prefix functions test -- inputValidation.test.ts sharedDeckPersistence.test.ts legacySharedDeckMigration.test.ts` | PASS, 3 files / 96 tests |
| `npm --prefix functions run lint` | PASS |
| `git diff --check` | PASS |
| `functions/test/sharedDeckPersistenceFirestore.integration.test.ts` | NOT RUN; emulator execution is excluded from this worker's gate |

A root `npm run lint` attempt earlier in implementation exited 1 while UI files were mid-edit. It reported cross-owned `AppRuntime`/`AppOverlays` prop mismatches and initial type widening in this worker's origin fixtures. The worker-owned type issues have been corrected and the focused suites plus Functions lint now pass; root owns the final global lint/core gates, so the root lint was not repeated here.

## Remaining verification

- Root owns the final `npm run lint`, `npm run verify:core`, Rules/emulator gates, and final review coordination.
- No emulator, build, deployment, cloud operation, or live data migration was run.
