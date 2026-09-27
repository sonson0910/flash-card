---
title: "Contract — card edit sheet mutations: headword, part of speech, tags/deck, difficulty/scheduling, image (08.7)"
status: implemented
---

# Contract: card edit sheet mutations

Written before code, per the 08.7 split from 04.7. `EditCardDialog.tsx` now
renders a live control for every field this contract scopes in (headword,
legacy part-of-speech, category, image remove/replace); the sections below
are kept as the historical spec.

## Implementation notes (2026-09-27)

- **Rules**: no `firestore.rules` text changes were needed, matching this
  contract's own "Rules allowlist impact summary" below. `firestore.rules.test.ts`
  gained regression tests locking in the already-correct allowlist
  (`describe('card edit-sheet mutation allowlist', ...)`): legacy-card
  part-of-speech edit allowed, canonical-card part-of-speech edit rejected,
  category/customDeck edits allowed, image remove/replace-with-trusted-domain
  allowed, replace-with-untrusted-domain rejected, and a direct client
  `word`/`normalizedWord` update rejected (confirming the new callable below
  is actually required). These need the Firestore emulator
  (`npm run test:rules`) and were not run by the implementing agent.
- **Headword**: implemented as a new trusted Admin-SDK callable
  `renameCardHeadword` (`functions/src/cardPersistence.ts`,
  `renameCardHeadwordForOwner` + `parseRenameCardHeadwordRequest`; exported in
  `functions/src/index.ts`), mirroring `createCard`'s Rules-bypass pattern
  exactly as specified. It commits as its own action in the sheet (separate
  input + save button), independent from the rest of the draft, since it is a
  different write transport (Admin-SDK transaction vs. the client `updateDoc`
  patch) and Rules cannot express identity changes at all for an identified
  card.
- **Part of speech**: implemented only the UI-gating half this contract itself
  scoped as the correct interim UI (`canEditPartOfSpeech` in
  `editCardModel.ts`, hiding the control for a `lexemeId` card). The "new
  callable to switch to a different published sense" for a canonical card
  stays explicitly out of scope, per this contract's own text, and was not
  built.
- **Category**: patched through the existing `updateCard` path as specified,
  plus a facets-delta call. The dialog has no reference to the
  `learningStateController` instance that owns the higher-level
  `updateCategoryFacets` hook method the "Write count" section below points
  at, and threading a new prop through `EditCardDialogProps` →
  `LibraryCardGrid.tsx` → `LibraryScreen.tsx` would cross this phase's file
  ownership. `EditCardDialog.tsx` instead calls the same underlying primitives
  that hook calls internally — `applyCategoryDeltas` +
  `deriveLibraryFacetOperationId` from `src/lib/cardRepository.ts` — directly,
  fire-and-forget, after a successful save, with the same idempotent
  `operationId` shape the delete path already uses. Functionally equivalent:
  exactly one facets-delta call per category-changing save, never gating the
  save itself.
- **`customDeck`**: no new UI control was added. This contract's own
  field-by-field section below only asks for a `category` control in this
  sheet — `customDeck` is already wired elsewhere
  (`LibraryScreenActions.grid.assignDeck`) and stays that way; the Rules
  regression test above only re-confirms the allowlist row still holds.
- **Image**: "remove" patches `{ imageUrl: null, imageSearchQuery: '' }`, not
  `{ imageUrl: null, imageSearchQuery: undefined }` as the field-by-field table
  below literally says — **correction**: the Firestore JS client SDK rejects
  an explicit `undefined` field value before the write ever reaches Rules
  (`updateDoc() called with invalid data. Unsupported field value: undefined`),
  so that literal phrasing was never actually implementable. An empty string
  is this codebase's existing convention for "no value" on every other
  optional bounded string field (`phonetic`, `explanation`, etc.) and is what
  `firestore.rules`' existing bounds already accept. "Replace" reuses the
  existing `fetchImageUrl` search (same three-provider trusted-domain
  allowlist as card creation) and patches `imageUrl`/`imageSearchQuery`
  together in the same `updateCard` call.

## What already works (baseline, unaffected)

`src/features/cardEdit/editCardModel.ts` (`EDIT_CARD_FIELDS`) already edits
`translation`, `explanation`, `explanationTranslation`, `exampleSentence`,
`exampleTranslation`, `phonetic`, `mnemonic` through
`LibraryScreenActions.grid.updateCard` → `learningStateController.patch()` →
one `updateDoc` on `users/{uid}/cards/{cardId}`, gated by `firestore.rules`
`canPatchOwnedCard`. Every field below reuses this exact pipeline; only the
Rules allowlist and the UI form change.

## Client-side plumbing is already generic

`src/lib/cardMutationProtocol.ts:10-13` types `CardMutableField` as "every
`CardData` key except `id`/`schemaVersion`/`revision`/`libraryEpoch`/
`createdAt`/`updatedAt`", and `mutableCardFields` (same file, ~line 15) already
includes `word`, `partOfSpeech`, `category`, `difficulty`, `imageUrl`. The
`learningStateController.patch(cardId, fields, fieldMask, operationId)` path
(`src/features/learning/learningStateController.ts:401-409`, `buildPatch` at
320-359) is field-agnostic: it builds one `MutationPlan` with `fields`/
`fieldMask` filtered through `selectMutableCardPatch`, and
`useLearningStatePersistence.ts` turns that into exactly one Firestore
`updateDoc` call. **No new client mutation plumbing is needed** — every field
below can already be requested through `updateCard(cardId, { ...patch })`,
`LibraryScreenActions.grid.updateCard`, the same way the 7 existing fields
are. The gap is entirely in (a) `EditCardDialog.tsx` not exposing a form
control for these fields yet, and (b) `firestore.rules` actively rejecting
some of them today (see per-field tables below) — verified by reading the
current rule bodies, not assumed.

## Write count and conflict behavior (applies to every field below)

- **One card-document write per save, plus one bounded facets-mirror write
  only when `category` actually changes value.** A save always produces
  exactly one `updateDoc` on the single `users/{uid}/cards/{cardId}` document,
  whatever subset of fields changed — `buildPatch` already coalesces the
  whole dirty-field set from one form into one `MutationPlan`/one publication
  (`learningStateController.ts:347-358`). That covers headword,
  part-of-speech, `customDeck`, difficulty/scheduling, and image.
  - **Exception: `category`.** There is a real second document,
    `users/{uid}/profile/library_facets` (`src/lib/cardRepository.ts:458-459`,
    `loadLibraryFacets`), a per-owner category→count mirror used to render
    category chips/counts without a collection scan. Today it is only kept in
    sync from the *delete* path — `useLearningStatePersistence.ts:291-294`
    calls `current.updateCategoryFacets({ [stableSource.category || 'Other']: -1 }, ...)`
    after a card is deleted, through `applyCategoryDeltas` →
    `callLibraryFacetMutation` (`src/lib/cardRepository.ts:476-491`), a
    trusted-callable-backed, operationId-keyed, idempotent counter update
    (`functions/src/libraryFacetPersistence.ts`). No caller updates it on a
    plain field patch today, because no patch has ever been able to change
    `category` before now.
  - **Contract for the new category-edit path:** when a save changes
    `category` from *old* to *new*, the edit flow must call the same
    `updateCategoryFacets` (via `appDependencies.library.updateCategoryFacets`,
    already wired at `src/app/appDependencies.ts:49-58`, or the
    `LearningPersistenceOptions.updateCategoryFacets` hook already threaded
    into `useLearningStatePersistence`) with `{ [old]: -1, [new]: +1 }` in the
    **same call** (one delta object, one facets-doc write), using a
    deterministic operationId derived from the card-patch operationId (same
    pattern as `deriveLibraryFacetOperationId(mutation.operationId, 'delete')`
    at line 293, e.g. `deriveLibraryFacetOperationId(operationId, 'category-edit')`)
    so a retried save cannot double-count. This is fire-and-forget relative to
    the card write (`void current.updateCategoryFacets(...)`, matching the
    existing delete-path call), not a blocking second phase of the save, and
    it is skipped entirely (no second write) when `category` is unchanged or
    when the new value equals the old value. No fan-out exists for any other
    field in this contract — headword, part-of-speech, `customDeck`,
    difficulty/scheduling, and image all stay single-write
    (see "Headword" below for the one further exception: a *rename*
    additionally needs a reservation-document swap, which is a second
    document in the same transaction, not a second card write).
- **Optimistic concurrency, not last-write-wins.** Every update must supply
  `schemaVersion: 2`, `revision: <previous + 1>`, and the current
  `libraryEpoch`; Rules enforce this with `isNextCardRevision`
  (`firestore.rules:118-129`) and `canUpdateCurrentCard`
  (`firestore.rules:151-162`). A save built from a stale in-memory card (one
  whose `revision` no longer matches the server) is **rejected outright** by
  Rules (`permission-denied`), not merged — the existing `updateCard` caller
  already surfaces this through `LearningStateOutcome.status` (`stale-owner`,
  or a thrown/caught write failure mapped to an error status); `EditCardDialog`
  must show a "this card changed elsewhere, reload before saving" message and
  refuse to resubmit the same stale draft, exactly like the 7 existing fields
  already require today. No new conflict primitive is introduced for the new
  fields.

## Field-by-field contract

### Headword (`word`, `normalizedWord`) — keep lexeme identity

**Currently impossible, not just unimplemented.** `firestore.rules:570-592`
(`hasValidCardIdentityUpdate`) requires, for any card that already has an
identity (`hasCardIdentity(resource.data)` true — i.e. every normal card):
`resource.data.normalizedWord == data.normalizedWord && resource.data.word ==
data.word`. A direct client `update` that changes `word` is rejected before
`isValidChangedCardFields` is even reached, regardless of what
`isValidChangedCardFields` itself would allow. This is a **hard identity
lock**, not a bounds check.

Correcting a headword while keeping "lexeme identity" (same `lexemeId`,
`normalizedLemma`, `partOfSpeech`, `senseKey` — same meaning, corrected
surface form only, e.g. fixing a typo) needs a **new trusted server path**,
not a Rules loosening:

- A new callable (parallel to `createCard`, in `functions/src/cardPersistence.ts`)
  that, in one Firestore transaction: (1) validates the new `word`/
  `normalizedWord` against the same bounds `createCard` already uses, (2)
  releases the old `normalizedWord` reservation
  (`cardReservationId`/`targetCardReservationId`, `firestore.rules:454-501`)
  and creates the new one — Rules cannot orchestrate a two-document swap
  atomically, only Admin-SDK code in a transaction can, (3) rejects if the new
  `normalizedWord` is already reserved by a *different* card (duplicate-word
  guard, same invariant `createCard` already enforces on create), (4) writes
  `word`/`normalizedWord` on the card **without** touching `lexemeId`,
  `normalizedLemma`, `partOfSpeech`, or `senseKey` — those stay byte-identical,
  which is what "keep lexeme identity" means operationally.
- `firestore.rules` then needs one narrow addition: the client-update path
  stays exactly as locked as it is today (`hasValidCardIdentityUpdate`
  unchanged), and the new callable writes via the Admin SDK, which bypasses
  Rules entirely (same as `createCard`'s `allow create: if false`) — so no
  Rules change is strictly required for this path, only a new callable.
- **Reject-partial stays true**: if the caller supplies a new `word` but the
  card is canonical (V3, has `lexemeId`) and any of `lexemeId`/
  `normalizedLemma`/`partOfSpeech`/`senseKey` would need to change too (a
  *different* lexeme, not a typo fix), the callable must reject with a
  validation error — that is a re-identify, not an edit, and out of this
  contract's scope.

### Part of speech (`partOfSpeech`)

Split by whether the card is canonical (V3, has `lexemeId`):

| Card kind | Today | Contract |
|---|---|---|
| Legacy (no `lexemeId`) | Already a free bounded string, ≤ 64 chars (`firestore.rules:747-758`, `isValidChangedCardFields`); no lock. | **Editable now** — add a form control in `EditCardDialog.tsx`, add `partOfSpeech` to `EDIT_CARD_FIELDS`-equivalent, reuse the existing `updateCard` path. No Rules change needed. |
| Canonical (has `lexemeId`) | `firestore.rules:831-839`: whenever `lexemeId`/`senseKey`/`normalizedLemma` are present and a `previousFields` already had `lexemeId`, the update must keep `data.partOfSpeech == resource.data.partOfSpeech` (it is one leg of the 4-tuple that names the lexeme). Changing it while keeping the tuple internally consistent means pointing at a *different* published `lexemes/{id}` document. | **Not a plain edit.** Treat as "switch to a different sense/lexeme", which needs the same trusted-callable treatment as a headword re-identify (validate the new tuple against a real `lexemes/{id}` doc via `hasValidCanonicalLexemeMetadata`'s server-side equivalent, same as `createCard` already does). Do not expose a free-text/POS-picker control for canonical cards until that callable exists — showing one for legacy cards only, and disabling/hiding it for canonical cards, is the correct interim UI. |

### Tags / deck (`category`, `customDeck`)

- `category` is already a free bounded string (≤ 128 chars,
  `firestore.rules:706-714`) with no identity coupling — the app has no
  separate multi-value "tags" field (confirmed: no `tags` key anywhere in
  `src/types/card.ts`); `category` is the closest existing concept and is what
  "tags" in the phase-08 task list maps to.
- `customDeck` is already editable (`firestore.rules:724-733`,
  `LibraryScreenActions.grid.assignDeck` already wired end-to-end today).
- **No Rules gap**, but `category` is not a plain single-write field — see
  "Write count" above: changing it must also call `updateCategoryFacets` with
  a `{old: -1, new: +1}` delta so the `library_facets` mirror used for
  category chip counts does not drift out of sync with the actual per-card
  `category` values. `customDeck` has no such mirror and stays a plain single
  write. Both reuse `updateCard` as-is for the card document itself; the
  facets call is additive, not a Rules or Functions change.

### Difficulty / scheduling (`difficulty`, `fsrs`, `nextReviewDate`, `reviews`, `interval`, `easeFactor`, `correctStreak`, `reviewHistory`)

**Currently impossible, not just unimplemented, and should stay that way for
a manual edit sheet.** `firestore.rules:853-865` (`canPatchOwnedCard`)
explicitly blocks a client update from touching any of `difficulty`,
`nextReviewDate`, `reviews`, `interval`, `easeFactor`, `correctStreak`,
`fsrs`, `reviewHistory`, `appliedReviewOperationIds` — the **only** exception
is `canInitializeLegacyDifficulty` (`firestore.rules:164-169`), a one-shot
"this card never had a `difficulty` at all; set it to `unrated`" bootstrap
that touches no other scheduling field. Every other scheduling mutation is
required to go through the server-side `reviewCard`/`reviewCardV2` callables,
which recompute FSRS state server-side from a rating, not from an arbitrary
client-supplied difficulty/date.

Contract: **do not add a free-form difficulty/scheduling editor.** Manually
setting `difficulty` or `nextReviewDate` from an edit sheet would let a client
fabricate SRS state the server never computed (e.g. mark a card "easy" with a
10-year `nextReviewDate` without ever reviewing it), which breaks the
review-evidence invariant this whole phase enforces everywhere else (08.6:
"course progress phải đến từ review evidence"). If a "reset scheduling"
action is wanted later, the safe shape is a **narrow trusted callable**
("reset this card's SRS state to new/unrated", not an arbitrary field
setter) — same pattern as `canInitializeLegacyDifficulty` already establishes,
just exposed as an explicit user action instead of an automatic backfill. That
callable is new scope, not covered by this contract, and needs its own
review of what "reset" should mean for `reviewHistory` (truncate vs keep).

### Image (`imageUrl`, replace/remove)

| Action | Today | Contract |
|---|---|---|
| Remove (set `null`) | Already allowed: `firestore.rules:716-723` accepts `imageUrl == null` unconditionally. | **No gap.** Add a "remove image" control that patches `{ imageUrl: null, imageSearchQuery: undefined }` through the existing `updateCard` path. |
| Replace with a new image | `isTrustedImageUrl` (`firestore.rules:29-33`) only accepts `https://images.pexels.com/...`, `https://images.unsplash.com/...`, or `https://upload.wikimedia.org/...` — a fixed allowlist of the same stock-photo providers card creation already searches. No arbitrary upload is possible through a direct client write. | **Editable now, scoped to "search again, pick a different stock photo."** Reuse the existing image-search flow already used at card creation (same provider allowlist, same trusted-domain check) to let the user pick a replacement from the same three domains, then patch `imageUrl`/`imageSearchQuery` through `updateCard`. A genuine user-uploaded custom image is a different feature (Storage bucket + upload endpoint + a new Rules domain/path), explicitly out of this contract. |

## Rules allowlist impact summary

| Field(s) | Rules change required |
|---|---|
| `word`, `normalizedWord` (rename, same lexeme) | None to `firestore.rules` itself — a new Admin-SDK callable bypasses Rules the same way `createCard` does. |
| `partOfSpeech` on legacy cards | None — already allowed. |
| `partOfSpeech` on canonical (V3) cards | Out of scope for a plain edit; would need the same new-callable treatment as headword, validating against a real `lexemes/{id}` doc. |
| `category`, `customDeck` | None — already allowed. `category` additionally needs a client-side call to `updateCategoryFacets` (existing hook, no Rules change) to keep the `library_facets` mirror correct; see "Write count" above. |
| `difficulty`, `fsrs`, `nextReviewDate`, `reviews`, `interval`, `easeFactor`, `correctStreak`, `reviewHistory` | Deliberately **not** loosened. Any future "reset scheduling" action is a new trusted callable, not a Rules allowlist change. |
| `imageUrl` remove | None — already allowed. |
| `imageUrl` replace (same provider allowlist) | None — already allowed. |
| `imageUrl` arbitrary upload | Out of scope; would need a new Storage + Rules surface. |

## What this contract does not do

- It does not implement any of the above. `EditCardDialog.tsx` keeps
  `data-edit-contract-note` until each row above is built by whichever lane
  owns `src/features/cardEdit/**`, `functions/**`, and `firestore.rules`.
- It does not re-litigate 08.2's R10 decision (`language`/`translationLanguage`
  independent of lexeme identity, already implemented — see
  `src/features/multilingual/lexemeIdentity.ts:3-8`); this contract only adds
  the headword/part-of-speech/tags/scheduling/image surface on top of it.
- It does not add a multi-value "tags" field. "Tags" in the 08.7 task item is
  covered by the existing `category` field; a real multi-tag list would be a
  schema change (`src/types/card.ts`) and is explicitly not this contract's
  scope.
