---
title: "Phase 2: Lexeme identity and daily boundary"
status: complete
---

# Phase 2: Lexeme identity and daily boundary

## Overview

Carry the existing V3 identity (`language + normalized lemma + part of speech + sense`) through compatibility cards, catalog adoption, persistence, daily planning, and placement without re-keying old records. Implement the chosen definition of a calendar day.

## Requirements

- [x] Same spelling in different languages, parts of speech, or senses remains distinct end-to-end.
- [x] Existing metadata-free cards retain their IDs and legacy English-compatible behavior.
- [x] One logical-key helper is used by all compatibility dedupe/merge consumers; server/rules duplicate only the unavoidable cross-runtime validation formula and are locked by golden vectors.
- [x] Daily pivot behavior remains the selected deterministic UTC contract.

## File inventory

| Change | Paths |
|---|---|
| Identity types/helper | `src/types/card.ts`, `src/features/multilingual/lexemeIdentity.ts`, `src/lib/cardIdentity.ts` |
| Authoritative persistence | `functions/src/cardPersistence.ts`, `functions/test/cardPersistence.test.ts`, `src/lib/cardMutationProtocol.ts`, `src/lib/cardMutationProtocol.test.ts`, `firestore.rules`, `firestore.rules.test.ts` |
| Compatibility/catalog projection | `src/features/multilingual/compatibilityProjection.ts`, `src/features/catalogWorkspace/catalogPresentation.ts`, `src/features/catalogWorkspace/catalogWorkspacePresenter.ts`, `src/features/catalogWorkspace/catalogWorkspacePresenter.test.ts` |
| Dedupe/persistence consumers | `src/lib/cardUniqueness.ts`, `src/lib/cardRepository.ts`, `src/lib/deviceStore.ts`, `src/lib/cardMirror.ts` |
| Offline creation/reconnect | `src/features/librarySession/libraryReplica.ts`, `src/features/librarySession/libraryReplica.test.ts`, `src/lib/cardCreation.ts`, `src/lib/cardCreation.test.ts` |
| Catalog/daily/placement | `src/features/catalogWorkspace/catalogLearningFlow.ts`, `src/features/dailyLearning/dailyPlan.ts`, `src/features/dailyLearning/placementEngine.ts`, `src/lib/cardQuery.ts` |
| Round-trip consumers | `src/features/importExport/spreadsheetModel.ts`, `src/features/importExport/spreadsheetModel.test.ts`, `src/features/sharing/sharedDeckService.ts`, `functions/src/inputValidation.ts`, `src/features/intake/cardIntakeController.ts`, `src/features/intake/cardIntakeController.test.ts`, `src/features/intake/cardIntakePipeline.ts`, `src/features/intake/cardIntakePipeline.test.ts`, `src/lib/pendingCardOverlay.ts`, `src/lib/pendingCardOverlay.test.ts` |
| Tests | `src/lib/cardIdentity.test.ts`, `src/lib/cardUniqueness.test.ts`, `src/lib/cardRepositoryUniqueness.test.ts`, `src/lib/deviceStore.test.ts`, `src/lib/cardMirror.test.ts`, `src/features/catalogWorkspace/catalogLearningFlow.test.ts`, `src/features/dailyLearning/dailyPlan.test.ts`, `src/features/dailyLearning/placementEngine.test.ts`, `src/lib/cardQuery.test.ts` |

## Implementation steps

1. Add optional canonical identity metadata (`lexemeId` plus the minimum language/POS/sense fields needed to reproduce it) to `CardData`; keep `id` and all legacy fields unchanged.
2. Extend `cardIdentity` around `createLexemeId` to return a logical identity from canonical metadata, with an explicit legacy fallback. Do not default a known non-English card to English.
3. Carry the full canonical identity through catalog presentation/presenter and compatibility projection; verify the projected `lexemeId` matches a fresh tuple calculation.
4. Define a versioned authoritative reservation/ID contract. Legacy cards retain word reservations and IDs; new canonical cards reserve by validated lexeme identity. Update Functions allowlists/canonicalization, client mutation fields, and Firestore rules together.
5. Replace normalized-word-only dedupe in catalog, uniqueness, repository, device store, mirror, daily plan, and placement with the shared logical key.
6. Extend import/export and shared-deck payloads additively, and make intake/pending-overlay/mirror lookup accept a logical identity descriptor when available. Keep a versioned, explicit word-only fallback for legacy payloads.
7. Change pending-upsert verification in `libraryReplica`/`cardCreation` to query and reconcile by canonical logical identity when metadata exists. A same-word different-sense match must not be classified as already existing, deleted from local backup/mirror, or acknowledged.
8. Keep stored document IDs stable for legacy cards; never rewrite ambiguous records or merge across language/POS/sense.
9. Implement the chosen daily pivot in `cardQuery.ts`. Define the production timezone authority: persisted IANA learner profile, or documented per-device timezone with accepted cross-device/travel behavior. Do not infer it only from the test host.

## Scenario matrix

| Input | Expected |
|---|---|
| `lead` English noun sense A vs verb sense B | Two cards |
| Same lemma English vs Vietnamese | Two cards |
| Same exact V3 identity from two catalogs | One adopted card |
| Legacy card without metadata plus its compatible English entry | Existing card reused without ID mutation |
| Mirror/device reconciliation with distinct senses | Neither card overwrites the other |
| Shared and spreadsheet round trip | Identity tuple survives; distinct senses remain distinct |
| Callable create and Firestore reservation | Same-word senses get separate canonical reservations; legacy word reservations remain readable |
| Offline same-word second sense reconnects | It is written as its own canonical card and is not deleted/acknowledged as the first sense |
| 23:30 then 00:30 in configured learner timezone | Pivot changes exactly at local midnight if local-time decision wins |

## Validation

- Focused: `npx vitest run src/lib/cardIdentity.test.ts src/lib/cardUniqueness.test.ts src/lib/cardRepositoryUniqueness.test.ts src/lib/deviceStore.test.ts src/lib/cardMirror.test.ts src/lib/cardMutationProtocol.test.ts src/lib/cardCreation.test.ts src/features/librarySession/libraryReplica.test.ts src/features/catalogWorkspace/catalogLearningFlow.test.ts src/features/catalogWorkspace/catalogWorkspacePresenter.test.ts src/features/importExport/spreadsheetModel.test.ts src/features/intake/cardIntakeController.test.ts src/features/intake/cardIntakePipeline.test.ts src/lib/pendingCardOverlay.test.ts src/features/dailyLearning/dailyPlan.test.ts src/features/dailyLearning/placementEngine.test.ts src/lib/cardQuery.test.ts`.
- Authoritative: `npm --prefix functions test -- cardPersistence.test.ts && npm run test:rules`.
- Broaden: `npm run lint && npx vitest run`.

## Success criteria

- [x] All consumers produce the same logical identity for the same card.
- [x] Language/POS/sense collision tests pass through catalog, daily, placement, device, mirror, reconnect, share, and spreadsheet flows.
- [x] No bulk migration, ID replacement, or destructive merge is introduced; the established V3 lexeme/membership ID format is unchanged.
- [x] Functions, mutation protocol, and rules accept canonical fields and reject forged/mismatched identity tuples.
- [x] The daily pivot retains the selected UTC contract and existing boundary coverage.

## Completion evidence

- Focused client/source suite: 20 files, 256 tests passed.
- Functions identity/input validation: 42 tests passed.
- Firestore rules plus integration suites: 61 rules tests and 19 Functions integration tests passed.
- Root TypeScript lint and `git diff --check` passed.
- Independent review rejected two earlier implementations; the final pass verified established-ID compatibility, case-preserving normalized lemmas, canonical reconnect safety, shared/spreadsheet round trips, legacy catalog reuse/UI state, and variable-length reservation IDs.

## Risks and rollback

- Risk: a fallback may split a legacy card from its catalog equivalent. Mitigate with mixed legacy/V3 fixtures before changing consumers.
- Rollback: stop writing new optional metadata while continuing to tolerate it; retain old IDs and data.
