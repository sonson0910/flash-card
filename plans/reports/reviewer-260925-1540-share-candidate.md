# Read-only review: phase02 share candidate

## Scope and evidence

Reviewed the immutable candidate tree `402fab2137116f8b929a9cb7fe72405da07aba45` from alternate index `artifacts/phase02-candidate-staging/candidate.index`, based on `47a1bdc2e5b102ff616f57a1ac7573c00f239fcf`. Compared it with the phase02 contract and decision log. No source edits or tests/build/extraction were run in this review. Root separately reported lint and 106 focused tests passing, and reported `i18n:check` failing because extraction would change catalogs; those execution results were not rerun here.

## Findings

### P1 — Candidate omits the `components` catalogs required by Lingui extraction

`lingui.config.ts` includes `src/components/AppOverlays.tsx` in both the `shell` catalog (`lines 3–8`) and the `components` catalog (`line 9`). The candidate changes only `shell.po` for EN, VI, and en-XA. The unchanged `components.po` files still contain the prior share strings (for example, EN `src/i18n/locales/en/components.po:898` onward), while the candidate `AppOverlays.tsx` introduces new `shell.share.*` IDs such as `shell.share.incoming-created` and `shell.share.empty-title`. Extraction therefore changes the component catalogs, so this tree does not pass the catalog stability gate. Include the six matching `components.po` catalog updates from the stable extraction alongside the existing shell catalog updates before treating the candidate as ready.

### P2 — Incoming preview is capped at four samples although the view can render five (fixed after this candidate snapshot)

In the reviewed tree, `src/features/sharing/sharedDeckSessionController.ts:311` truncates `sampleWords` with `.slice(0, 4)`, while `src/components/AppOverlays.tsx:388` renders up to five. The fifth preview tile could not appear. Root subsequently reported that the cap is fixed and requested finalization. I did not re-inspect or recalculate a newer candidate hash; carry the correction and its focused assertion into the refreshed candidate.

## Contract checks

- Owner boundaries are intact in the candidate: `functions/src/index.ts:1028–1034` authenticates the V2 caller and matches `expectedOwnerId`; `firestore.rules:900–915` keeps owner metadata unreadable, disallows client writes, and gates public reads on schema, expiry, and quarantine; session operations check the captured owner/lifecycle before publishing. Public card projection forwards only enum `origin: ai|manual` and the allowlisted card payload, not owner IDs or email.
- R9 pair, origin, fingerprint, and migration shape are aligned across the callable parser, persistence, and migration classifier. The language pair is kept deck-level on the wire; legacy/mixed cards do not get defaulted to `en`/`vi`.
- Accepted limitation: the receiver preview uses the public deck-level native language, but card adoption does not persist that native language onto local cards. The post-UI roadmap explicitly marks persisting `translationLanguage` on cards as out of scope for this share phase and assigns it to course/card-model work; keep that as a Phase 08 adoption metadata seam rather than expanding the R9 share wire.
- Non-blocking schema-gate difference: `firestore.rules:55–60` checks pair completeness and string length, but not the canonical lowercase language-code pattern enforced by `functions/src/inputValidation.ts:171–184` and `legacySharedDeckMigration.ts:900–904`. V2 callable writes are validated before persistence and client writes are denied, so I found no normal client path to publish an invalid pair. Align the Rules read predicate if the intended schema gate must also reject malformed pairs originating from server/admin writes.
- Phase02 item 02.5 still calls for the migration mapping and decision-log update after the test package is correct. Those documentation updates are not part of this candidate manifest and should remain a separate completion gate; they are not an implementation dependency for this review.

## Verification limits

Patch replay had already been verified by the staging report and reproduced the candidate tree. This review only inspected candidate blobs and repository contract documents. The reviewed tree has the catalog extraction blocker; root reports the sample cap has since been fixed. Any refreshed candidate should include that fix and the matching catalog updates before final verification.

## Refreshed candidate delta — 2026-09-25

Rechecked immutable tree `d07752a5baf369084dbee7e287dbc74c116f2f7b` against base `47a1bdc2e5b102ff616f57a1ac7573c00f239fcf`, using `artifacts/phase02-candidate-staging/final-source.patch` and candidate blobs. This supersedes the two candidate-snapshot findings above for this tree; their original notes remain as history.

- **Catalog blocker resolved.** The candidate changes both `shell.po` and `components.po` for `en`, `vi`, and `en-XA` (all six locale files). The new catalog IDs are the share messages plus the shared `flashcard.ai-disclosure` used by the preview’s AI notice. The final i18n evidence reports stable extraction across 11 catalogs and complete EN/VI coverage (`plans/260925-1005-claude-design-workflow-recovery/evidence/phase-02-isolated-final-i18n.log`).
- **Sample cap resolved.** The candidate controller uses `.slice(0, 5)` at `src/features/sharing/sharedDeckSessionController.ts:311`; its focused test asserts a five-item preview and excludes the sixth item at `sharedDeckSessionController.test.ts:430–455`. Final focused evidence reports 2 files and 35 tests passing (`evidence/phase-02-isolated-final-focused.log`).
- **Scope check clean.** The candidate diff from the phase01 base has 31 paths covering share persistence/validation, intake, share UI, rules, fixtures, and catalogs. `AppRuntime.tsx` changes are limited to share-dialog state/error wiring, and the library contract test change updates the share error shape. No learning/undo/restore, account menu, identity/session recovery, device sync, or later-phase implementation paths are present. Candidate catalog additions beyond `shell.share.*` consist only of the AI disclosure key used by this share preview.

Final gate evidence read: isolated core retry reports 226 web files / 1,966 tests, 27 Functions files / 284 tests (8 skipped), 65 Rules tests, and 8 emulator integration files / 38 tests passing (`evidence/phase-02-isolated-core-retry.log`). The final build completes, bundle budget passes for 101 JavaScript chunks, and focused overlay/controller tests pass (`phase-02-isolated-final-build.log`, `phase-02-isolated-final-bundle.log`, and `phase-02-isolated-final-focused.log`). This was a read-only review; no tests, builds, extraction, browser checks, source, or index were changed by this reviewer. The earlier non-final `phase-02-isolated-core.log` contains scratch-environment failures and is superseded by the successful retry evidence above.

**Disposition:** no blocking candidate-scope or previous catalog/sample finding remains for tree `d07752a5baf369084dbee7e287dbc74c116f2f7b`.
