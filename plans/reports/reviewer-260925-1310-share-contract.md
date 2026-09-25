# Independent review: shared-deck contract

Date: 2026-09-25 (Asia/Saigon)
Reviewed revision: `47a1bdc2e5b102ff616f57a1ac7573c00f239fcf` plus shared working-tree edits
Scope: phase02 shared-deck validation, persistence/migration, owner lifecycle, intake, and share UI wiring.

## Findings

1. **P1 — Overlong language codes are truncated into accepted codes.** In `functions/src/inputValidation.ts:171-174`, `parseSharedDeckLanguagePair` calls `boundedText(..., 16)` before `isCanonicalLanguageCode` checks the maximum length. For example, `zh-hant-123456789` is sliced to the valid 16-character `zh-hant-12345678` and persisted as if that were the supplied target. The same truncation pattern appears for canonical card language at `:315-321` and word-language inputs at `:155-158`; the client regex in `src/features/sharing/sharedDeckService.ts:18-20` also has no length limit. This violates the contract that invalid codes are rejected and can silently change the declared language.

   **Accept when:** raw trimmed language-code values longer than 16 characters are rejected before normalization/truncation at every canonical-language input boundary; tests cover target, native, and canonical card/word language values. **Reject if:** any overlong raw code is silently shortened and accepted.

2. **P2 — Share overlay tests pass removed props, blocking the TypeScript lint gate.** `IncomingSharePreview` accepts only `preview`, `isSharing`, optional `error`, and optional `onDismissError` (`src/components/AppOverlays.tsx:379-384`), but `src/components/AppOverlays.test.tsx:37-38` and `:130-131` pass `onAccept`/`onCancel`. `OutgoingShareDetails` has no revoke props (`AppOverlays.tsx:478-500`), while `AppOverlays.test.tsx:164` and `:168` still pass `canRevokeShare`/`onRevoke`. The root `tsconfig.json` has no `include`/`exclude` narrowing, and `npm run lint` runs `tsc --noEmit`, so these excess JSX attributes are a static typecheck failure even though Vitest transpilation can pass.

   **Accept when:** obsolete props are removed from the preview/detail tests, with action behavior covered through `ShareImportActions` or the owning dialog; root `npm run lint` passes. **Reject if:** the typed test file continues to pass unsupported JSX props.

## Verified behavior and gate notes

- Server validation rejects incomplete pairs, rejects invalid `origin` values, and checks a complete deck target against canonical per-card target languages. Safe origins remain `ai | manual`; missing/unknown legacy origin stays absent.
- Persistence fingerprints and byte accounting include the optional complete pair. Migration shape checks preserve explicit pairs and leave absent legacy metadata unknown. Firestore public reads require an unexpired share and reject owner writes; server revoke checks private owner metadata.
- Preview derives labels from explicit deck/card metadata, leaves unresolved native language unknown, scans all cards for AI disclosure, and carries public expiry timestamps. Intake adopts only safe origins and does not rewrite existing progress. Owner/session checks surround create/revoke/accept operations; modal action busy/focus/privacy handling is present.
- The implementation report records PASS for client focused tests (4 files / 76 tests), Functions focused tests (3 files / 96 tests), Functions lint, and `git diff --check`. At initial review time, the Firestore emulator integration had not run; root's later evidence below supersedes that state.
- A targeted local TypeScript command could not be run: the host pre-tool hook blocked access to `./node_modules/.bin/tsc`, and no global `tsc` is on PATH. The JSX finding above is based on component prop declarations, call sites, `tsconfig.json`, and the root lint script; root should confirm in its already-owned final lint gate.

At initial review time, no source, test, Rules, or plan implementation files were changed.

## Follow-up implementation and evidence

- Rejected overlong trimmed language codes before truncation at the Functions word-language, shared-deck-pair, and canonical-card-language boundaries. The client canonical-code check now enforces the same 16-character maximum. Regression tests cover overlong target/native pair values, both word-language fields, a canonical card value whose truncated prefix would otherwise validate, and omission of an overlong client pair.
- Removed obsolete action/revoke props from `IncomingSharePreview` and `OutgoingShareDetails` test renderings. Existing `ShareImportActions` coverage still verifies disabled empty-deck import, visible card count, and busy state; revoke behavior remains covered by sharing service/controller tests.
- Focused verification after these changes: `npm --prefix functions test -- inputValidation.test.ts` PASS (1 file / 36 tests); `npm test -- --run src/features/sharing/sharedDeckService.test.ts src/components/AppOverlays.test.tsx` PASS (2 files / 28 tests).
- Root's later `plans/260925-1005-claude-design-workflow-recovery/evidence/phase-02-rules-integration.log` records Rules 65/65 and Functions Firestore integration tests 38/38 PASS. This root evidence supersedes the initial review-lane note above that emulator integration had not been run. No global build, lint, emulator, or extraction was run by this follow-up.
- The earlier targeted `tsc` attempt remains unrun because the host pre-tool hook denied `node_modules` access. The unsupported JSX attributes are now removed; root owns any final global typecheck gate.
