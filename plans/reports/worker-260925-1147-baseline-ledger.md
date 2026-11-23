# Phase 01.1 — Baseline dirty-file ownership

Frozen baseline: branch `feat/ui-redesign`, HEAD `8d1ec44e3af7e08e45b90454c887055a902ef7d2`, captured `2026-09-25T11:45:46+07:00`. Source: [implementation-start-ledger.json](../260925-1005-claude-design-workflow-recovery/evidence/implementation-start-ledger.json). The ownership CSV preserves each frozen status and SHA-256 and classifies all 244 unique paths.

| Classification | Paths | Assignment |
|---|---:|---|
| R9 implementation, exact handoff set | 13 | Phase 02, controller |
| Prior UI source patch | 44 | Phases 03, 04, 05, 06, 12 by feature owner |
| Generated i18n catalogs | 18 | Phase 01.4 / controller; review extractor output before commit |
| Phase 01 audit evidence | 47 | Controller; audit captures and current-screen evidence |
| Current recovery plan artifacts | 21 | Controller and named phase plans |
| Prior UI provenance reports | 16 | Preserve under their relevant phase/lane |
| R9 handoff report | 1 | Phase 02 provenance, separate from the exact 13 code/test paths |
| Unrelated-preserve | 84 | Existing user/workspace files; retain and exclude from phase-01 implementation changes |

The frozen statuses are 71 tracked modifications and 173 untracked paths. Classification is anchored to the ledger snapshot, not later worktree contents. Memory/configuration and snapshot artifact contents were not read; the corresponding paths are preserved by name only.

## R9 exact 13 paths

`firestore.rules`; `firestore.rules.test.ts`; `firestoreRulesSource.test.ts`; `functions/src/inputValidation.ts`; `functions/src/legacySharedDeckMigration.ts`; `functions/src/sharedDeckPersistence.ts`; `functions/test/inputValidation.test.ts`; `functions/test/legacySharedDeckMigration.test.ts`; `functions/test/sharedDeckPersistence.test.ts`; `src/features/sharing/sharedDeckService.ts`; `src/features/sharing/sharedDeckService.test.ts`; `src/features/sharing/sharedDeckSessionController.ts`; `src/features/sharing/sharedDeckSessionController.test.ts`.

The R9 handoff says its only test run was before the implementation changes: 46 passed and 3 expected failures. It records no post-change run and flags request fingerprint/migration exact-shape review, so the patch remains unverified. Do not report those pre-change results as phase-02 acceptance.

The 18 `.po` files are classified separately because the prior audit says `npm run i18n:check` ran extraction and changed catalogs. It also records 16 untranslated `vi/library` strings and one `vi/landing` string. The audit does not establish that generated catalog diffs were reviewed or accepted.

## Commit risks and handling

- A broad `git add -A` would include the incomplete R9 contract, prior UI patch, extractor output, local audit captures, 21 planning artifacts, and 84 unrelated-preserve files. Stage an explicit reviewed allowlist for each commit.
- Do not include the 13 R9 files in a phase-01 commit; phase 02 owns their review and verification. Preserve the handoff as evidence.
- Keep the prior UI patch separate by its assigned phase/lane. Existing UI code and the catalogs were not verified by this task.
- Recheck each selected path against its frozen SHA/status immediately before staging. The CSV proves provenance at capture time; it does not assert that no concurrent worker has since edited a path.

No source files were edited, staged, reset, or reverted for this ledger.
