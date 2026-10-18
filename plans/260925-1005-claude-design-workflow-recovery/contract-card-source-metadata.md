---
title: "Contract — bounded source metadata for web-captured cards (07.3)"
status: accepted
---

# Contract: card `source` metadata

Written before code, per the 07.3 staleness note. Supersedes the "offline/export"
wording in the original acceptance line; the acceptance for this task is
"reload/export/import round-trip", per the staleness audit.

## Shape

```ts
export interface CardSourceMetadata {
  /** Origin + pathname of the page the word was captured from. http/https only. */
  url?: string;
  /** Page <title> at capture time. */
  title?: string;
  /** Sentence-level context around the captured selection (existing 500-char bound, now persisted instead of prompt-only). */
  context?: string;
  /** When the capture happened. Defaults to the card's creation instant if the client omits it. */
  capturedAt?: string;
}

// CardData gains one optional field:
source?: CardSourceMetadata;
```

Every field is independently optional. A `source` object with all-empty fields is
never stored — `canonicalCard`/the client normalizer both collapse an all-empty
result to `undefined` so a card never carries an empty `{}` marker.

## Bounds and validation rules

| Field | Bound | Rule |
|---|---|---|
| `url` | ≤ 2048 chars after sanitization | `http`/`https` only. Credentials (`user:pass@`), the query string, and the fragment are **stripped** before persistence — see "Why the query is dropped" below. Anything that fails `new URL()` or isn't http/https is rejected (server) or dropped (client read-normalizer, defense in depth). |
| `title` | ≤ 256 chars | Plain text, trimmed. No HTML; rendered as text only, never `dangerouslySetInnerHTML`. |
| `context` | ≤ 500 chars | Reuses the existing `BROWSER_EXTENSION_IMPORT_MAX_CONTEXT_LENGTH` bound already enforced client-side in `browserExtensionImport.ts`. Previously this text reached the Gemini prompt and was then discarded; it is now also persisted on the card. |
| `capturedAt` | valid ISO-parseable date, stored as ISO 8601 | If omitted, the server (`canonicalCard`) does not fabricate one from thin air the way `createdAt` does with `now`; the *client* intake pipeline fills it from the moment the card is generated (`new Date().toISOString()`) whenever any other source field is present, so `capturedAt` is always populated together with the rest of `source`, but the value is a real timestamp of an actual client action, not a guess about the page. |

### Why the query string is dropped, not kept

Query parameters on an arbitrary third-party web page routinely carry session
tokens, magic-link/auth codes, tracking/UTM identifiers, or search state — none
of which help answer "which word came from which page," but all of which are
exactly the kind of private, replay-risky data the task instructions call out
("treat the source URL as private user data"). Origin + pathname is already
enough to recognize or revisit the page for the vast majority of sites (article
slugs, wiki paths, dictionary entries). The fragment is dropped for the same
reason and because this app's own extension protocol already uses the URL
fragment as a covert channel (`#lf-import=...`), so a captured fragment could
even collide with or spoof that channel if kept verbatim.

This mirrors the existing `trustedUrl`/`trustedHttpsUrl` precedent in
`functions/src/cardPersistence.ts` and `functions/src/inputValidation.ts`, which
already normalize and re-serialize URLs rather than storing client input
verbatim.

### Language pair

The task list mentions "cặp ngôn ngữ khi có" (the language pair, when known).
This is **not** a new field inside `source`. `CardData.language` /
`CardData.translationLanguage` already exist at the top level and are already
validated end-to-end by `parseCardLanguagePair` (`functions/src/inputValidation.ts`)
and `canonicalCard`. Duplicating them inside `source` would be redundant and
would create two places that could disagree about the same fact. The browser
extension does not currently determine a target language at capture time (it
hardcodes the legacy English path), so it does not populate `language`/
`translationLanguage` today; wiring the extension to a real target language is
07.5/10 scope (course-aware routing), tracked separately and explicitly marked
NEEDS REWRITE in the staleness audit. No new work is added here for this.

## Who writes `source`

- **Only `canonicalCard`, at card creation time**, via the `createCard` callable
  (`functions/src/cardPersistence.ts`). The client-side intake pipeline
  (`src/features/intake/cardIntakePipeline.ts`) attaches `source` to the card
  object it builds when the generation request carries `context`, `sourceUrl`,
  `pageTitle`, or `capturedAt` (i.e., when the request came from the browser
  extension's capture flow, via `browserExtensionImportRuntime.ts`).
- **Immutable after creation.** `firestore.rules` denies any client `update`
  that changes `source` (same pattern as `origin`): the field is allowed to
  keep existing in the document's field set across an update (so an unrelated
  patch like `bookmarked` doesn't get rejected by the `hasOnly` allowlist), but
  `changed.hasAny(['source'])` on update is always false.
- **No other write path touches it.** The single-card edit path
  (`editCardModel.ts` / `EditCardDialog.tsx`) only ever patches
  `EDIT_CARD_FIELDS` (translation, explanation, explanationTranslation,
  exampleSentence, exampleTranslation, phonetic, mnemonic) — `source` is not in
  that list, so the app UI has no code path that could set or edit it even
  before Rules are checked. Bulk mutation (`bulkCardMutationPersistence.ts`)
  only patches `customDeck`/`bookmarked`. Spreadsheet import
  (`spreadsheetModel.ts`) does not read or write `source` — see "Spreadsheet
  export/import" below.
- Because `allow create: if false` on `users/{userId}/cards/{cardId}` (all
  card creation is server-only via the Admin SDK, which bypasses Rules), Rules
  do not need — and do not have — a shape validator for `source`; they only
  need the immutability guard on `update`, which is the only path a client can
  reach.

## Legacy cards never get a guessed source

A card created before this change, or created through any path other than the
extension capture flow (manual creation, AI generation from the search bar,
spreadsheet import, shared-deck adoption), simply has no `source` field.
Nothing in `canonicalCard`, `normalizeCardData` (client read normalizer), or
the display code in `EditCardDialog.tsx` infers, backfills, or displays a
guessed source for such a card. The field is additive and optional exactly
like `mnemonic`/`wordFamily`/`fsrs` already are.

## Spreadsheet export/import: excluded, by design

`src/features/importExport/spreadsheetModel.ts` (`cardsToSpreadsheetRows`,
`parseStructuredCardRows`) already exports/imports a small, curated column set
(word, translation, explanation, phonetic, part of speech, category, emoji,
audio/image URL, canonical lexeme identity). Many existing `CardData` fields —
`mnemonic`, `wordFamily`, `exampleSentence`, `register`, `commonMistake`,
`collocations`/`synonyms`/`antonyms`, `fsrs`, `reviewHistory` — are *already*
excluded from this round trip; it is not a general-purpose serializer.

`source` is excluded for the same reason plus one more: `source.url` is
private user data. Adding it to a spreadsheet column that a learner might
export and paste elsewhere (a chat, a doc, a shared sheet) is a real exposure
increase for no learning benefit, and it would require accepting a second,
unauthenticated write path for a field the rest of this contract deliberately
keeps single-writer and immutable (a spreadsheet importer would have to either
silently drop a `source` column on import — the value it already provides for
every other unsupported field — or open a new validation surface). Excluding
it is the smallest coherent choice and needs no code change to
`spreadsheetModel.ts`/`spreadsheetWorkbook.ts`.

## Rendering

Display is plain text only. `title` renders as text; `url` renders as an
`<a>` with `rel="noopener noreferrer"` and `target="_blank"`, only when it
parses as `http`/`https` (defense in depth on the read side, mirroring the
write-side check). No `dangerouslySetInnerHTML` anywhere in this path. A
minimal read-only block is added to `EditCardDialog.tsx`; the WebWords page
(07.4) is out of scope and is not touched.
