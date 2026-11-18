---
title: "Approved contract — Paths and Progress Canvas data"
status: approved by owner 2026-09-28; local implementation pending
---

# Paths and Progress Canvas data

## Verified gap

Paths currently has three published tracks and tier totals, but no declared unit title/order, active-unit source, unit progress, or unit action. Catalog membership has `lessonGroup` and `rank`; a production writer for `users/{uid}/learning_states` was not found, although Paths currently reads up to 10,000 such documents. The Canvas example's six shelves and twelve units cannot be presented as real catalog data.

Progress currently uses XP history for its activity heatmap. XP is not a count of reviews. The approved implementation has added a due forecast and recent-mastery timestamp; the remaining gap is a range-sensitive review series. No client scan of all card histories or invented Canvas values is allowed.

## Proposed bounded sources

| Canvas datum | Proposed source | Incremental Firestore document I/O |
|---|---|---|
| Unit title/order/count and preview | Versioned unit descriptors in the downloaded catalog artifact; validate against membership at build time and cache with the catalog | 0 reads, 0 writes |
| Active unit and unit completion | A maintained, server-owned progress projection | +1 write per canonical create/review/delete with a real lexemeId; 1 query and P document reads per Paths open |
| Unit ETA | `dailyPacePreference` only if owner defines it as new words per day; otherwise unavailable | 0 reads, 0 writes if device-local |
| Reviews by day and recall buckets | Bounded 182-day, target-language-scoped projection inside the already-read/written `profile/stats` document, updated in the strict-review transaction | 0 additional reads, 0 additional writes per review or hydration |
| Due forecast, today through day 13 | Reuse due-today aggregate; 13 bounded aggregate count queries for future days, cached by owner/language/local date | 13 aggregate query reads on first daily hydration, 0 on same-day cache hit; 0 writes. When a 24-hour stats cache crosses local midnight, refresh only the due-today count with 1 aggregate query; an expired or missing full stats cache still uses its existing 8 aggregate queries. |
| Four recently mastered cards | Server-owned `masteredAt` on each card's existing review write, then a bounded indexed query | 0–4 document reads per hydration; 0 additional writes on review; schema/Rules/index change |

History and mastery begin on the date the new projection becomes authoritative. Legacy XP and capped card histories cannot reconstruct complete review counts. The UI must label older coverage as partial unless a separately approved backfill exists. Existing card writes are counted as existing writes; added fields increase document/index bytes.

## Owner decisions

1. **Approved 2026-09-28:** Catalog V2 unit descriptors and server-owned progress projection. Continue opens a unit preview, requests explicit card creation for missing words, then starts that unit's study session. The current `learning_states` reader is not sufficient without a proven writer.
2. **Approved 2026-09-28:** `dailyPacePreference` means new words per day for a device-local ETA.
3. **Approved 2026-09-28:** match Library's Mastered definition: `difficulty=easy` or `interval` ≥21 days (`fsrs.scheduledDays` is a fallback only when `interval` is absent). Clear `masteredAt` when a later review falls below that threshold.
4. **Approved 2026-09-27:** 13 cached aggregate count queries for the due forecast on the first Progress open per owner/target language/local date. A same-day cache hit uses no forecast queries.
5. **Approved 2026-09-27:** add server-owned `masteredAt` on the existing card write, Rules/index changes, and a bounded 0–4 document read query per Progress hydration.
6. **Approved 2026-09-28:** forward-only activity/mastery coverage and target-language scope. Account-wide XP remains separately labelled.
7. **Approved 2026-09-28:** the wave uses the real catalog's three tracks with 15 units each; six shelves and 12 units in the Canvas are illustrative, not the content authority.
8. **Approved 2026-09-28:** Clear Library must delete catalog progress through the trusted callable. For each catalog card deleted, the owner accepts one additional canonical card read, one projection read to guard a concurrent recreation, and one conditional projection delete write beyond the existing card listing read and card delete. Each page of at most 249 cards adds three fixed reads (account deletion guard, rate limit, and `library_state`) and one rate-limit write. Advancing `libraryEpoch` alone is insufficient because stale projection documents would still incur reads on each Paths open.

The forecast cache uses one browser-storage key per owner/language with the
local date inside its value. It stores counts only, validates all 13 dates and
counts before reuse, and is removed on account deletion. If browser storage
cannot reserve the daily query budget, forecast remains unavailable and no
forecast queries run; the bounded recent-mastery read still runs. A failed
count leaves the daily reservation in place to avoid repeated billed queries.

The due-today count carries the local date used when its aggregate query starts.
Progress hides that count, its action, and the combined 14-day chart after a
midnight rollover until the current day's count succeeds. This prevents a saved
count from being relabelled as today's count during an offline/error state.

The current phase-06 Canvas comparison checkbox remains open. UI can display honest unavailable states without additional I/O, but those states do not make the ready-state Canvas MATCH.

## Approved local implementation contract

This contract fills the remaining real-data gaps for Paths unit shelves, Continue,
unit ETA, Progress review activity, and range controls. The owner approved local
implementation only; it does not authorize a production migration or backfill.

### 1. Catalog V2 unit descriptors

Publish unit descriptors inside the already downloaded, versioned catalog artifact.
A descriptor is only `unitId` (the membership `lessonGroup`), `trackId`, `tier`,
one-based `ordinal`, and localized titles. It does not duplicate `lexemeIds`, a
preview list, or a unit count. The app derives the count and first eight preview
lexemes from published memberships matching the descriptor's `trackId` and
`lessonGroup`, ordered by membership `rank`.

The Catalog V2 schema does not hard-code a number of tracks or units. The current
pilot expectation is three tracks (`ielts`, `toeic`, and `general`) with 15 units
per track, but another release may differ only after editorial validation and owner
approval. The artifact build must reject a release with missing, duplicate,
out-of-order, cross-track, or unmatched descriptors/memberships. A unit with no
matching membership is invalid. This uses the catalog cache: **0 Firestore reads
and 0 writes**.

`unitId` and a lexeme's membership must remain stable across a compatible catalog
release. A release that moves a lexeme to another unit is a breaking catalog change
and must include a separately reviewed compatibility rule before publication;
silently remapping learner progress is disallowed.

### 2. Server-only catalog progress projection

For each canonical card with a real `lexemeId`, maintain one server-only document
at `users/{uid}/catalog_progress/{lexemeId}`. The document is an additive
projection, not a source for scheduling or mastery. Its V1 shape is:

```text
schemaVersion, ownerId, lexemeId, targetLanguage, status, cardRevision,
libraryEpoch, updatedAt
```

The trusted server derives `status` from the canonical card and stores no track,
unit, catalog, descriptor, or membership fields: a lexeme can occur in more than
one track and catalog releases can change. It does not require a server catalog
membership lookup. Only trusted create/review/delete code may write it; Firestore
Rules deny every client mutation. A manual card without a real `lexemeId` has no
projection.

| Canonical mutation | Projection mutation | Incremental document I/O |
|---|---|---|
| Create a canonical card with a real `lexemeId` | create/upsert from card status, revision, and epoch | +1 progress write |
| Strict review of that card | update projection status, revision, and epoch from the canonical server decision | +1 progress write |
| Delete that card | delete its lexeme projection | +1 progress write |
| Any other card mutation | none | 0 |

The create/review/delete projection mutation belongs in the same trusted
transaction as the canonical mutation. Its retry/replay result must be idempotent:
a failed canonical mutation leaves no projection. Single-card deletion currently
routes through a client Firestore path, so it must move to the trusted callable
before this contract can be implemented. Bulk deletion uses the same callable with
an explicit weight cap of 3. Existing canonical cards have no projection until a
forward create or review mutation; this proposal includes no backfill.

On Paths open, query this subcollection once for the active target language and
join it with cached descriptors and memberships. If the query returns `P` projection
documents, the exact incremental cost is **1 query and P document reads**; there is
no listener, page fan-out, or per-unit query. The client derives per-unit counts
from that one result: not started = no projection; active = at least one projected
lexeme but the unit is not complete; complete = every descriptor lexeme has a
projection whose server-derived status is mastered. A catalog release with no valid
descriptor/membership join is shown as unavailable.

Clear Library routes canonical card deletion through the trusted callable in pages
of at most 249 cards. A page transaction reads each requested card and each
catalog projection; it deletes an old-generation card and its projection together
only when the projection epoch is also old. A concurrent current-generation
projection remains intact. The epoch fence remains in force; an interrupted clear
must not report success. For a full catalog-card page of `N` cards, the trusted
route uses up to `2N + 3` document reads and `2N + 1` writes, including the
account guard and rate-limit record. The client listing still reads `N` cards.
The client plans smaller pages when the loaded card JSON approaches 8 MiB. If
Firestore rejects a transaction specifically for size, it splits that page and
retries; each additional callable attempt incurs its own account-guard and
rate-limit reads and rate-limit write, plus transaction reads reached by that
attempt. An aborted transaction does not delete cards or projections. A failure
for any other reason stops the clear with the advanced epoch recorded and the
operation incomplete until a successful retry.

### 3. Continue and ETA

Proposed Continue behavior: select the first active unit, otherwise the first not
started unit, and open its descriptor preview. If it has unintroduced lexemes, the
preview presents an explicit confirmed add-to-library action for that unit's
membership-ordered lexemes. After successful canonical creates, it starts a
unit-scoped study session using only that unit's projected cards. If every lexeme is
already introduced, Continue starts the same unit-scoped study directly. It never
creates cards in the background and it never labels a unit complete merely because
its cards were added.

Owner approved a wave cap of **20 lexemes per unit** and at most **20 card
document reads** when the learner confirms Continue and the unit study session
needs to hydrate existing cards. The confirmation is the read trigger; opening
Paths or preview does not perform these card reads. The client must reject a
unit over this cap instead of silently truncating it. The owner will provide
the reviewed 3-track × 15-unit catalog content, localized titles, and rights
evidence separately; the current AI-assisted pilot is not a publishable release
and must remain inactive.

ETA is only the descriptor's remaining, unintroduced lexeme count divided by the
existing device-local `dailyPacePreference` (5/10/15/20 new words per day), rounded
up and labelled as an estimate. It is unavailable when local storage is unavailable
or no positive pace is selected. It is a device preference, so ETA adds **0
Firestore reads and 0 writes** and is not synchronized between devices.

### 4. Review activity V1 in existing stats

Add `reviewActivityV1` to the existing server-owned
`users/{uid}/profile/stats` document. It contains `coverageStartedOnByLanguage` and
a target-language-scoped map of local review day (`YYYY-MM-DD`) to
`{ reviewed, again, hard, good, easy }`. On each strict review, the server uses its
receipt time and the already validated reward time zone, increments that day's
counters, and trims each language to its latest 182 calendar days in the same
transaction. It never derives reviews from XP or scans card history. Its
forward-only coverage begins when this field becomes authoritative; the UI marks
earlier selected ranges as partial.

The strict-review transaction already reads and writes this stats document for
verified gamification. Folding this bounded map into that existing document adds
**0 incremental document reads, 0 incremental document writes, and 0 hydration
documents** for review activity. It does add bounded document/index bytes, which
must remain under Firestore's document limit and be covered by tests at the 182-day
boundary. The existing strict gamification parser rejects unrecognized stats fields,
so that parser/schema must explicitly accept and validate `reviewActivityV1` before
the field is written. A review without a resolved server time zone does not
fabricate a day: the established stats time zone must be used, otherwise review
activity is unavailable for that mutation until the owner approves a compatible
bootstrap rule.

Progress range controls read the already hydrated stats field; they issue no query.
The activity chart's reviewed count is `reviewed`; recall buckets are the four
stored rating counters and must retain their explicit labels. Existing account-wide
XP remains a separate metric and cannot be presented as course or review activity.
The contract supports only the 30-day and 26-week ranges. All time is unsupported
until the owner funds and approves a separate lifetime-activity contract.

### Approved scope and costs

Approve or amend all of the following as one Phase 06 contract:

1. The Catalog V2 descriptor shape, validation, and compatible-release rule above.
   Confirm the current pilot's three tracks × 15 units independently; do not bake
   that count into the schema.
2. `users/{uid}/catalog_progress/{lexemeId}` is server-only, canonical card
   create/review/delete each add exactly one projection write, and Paths accepts
   one query and `P` projection-document reads per open.
3. Continue opens an explicit unit preview, adds only through confirmed canonical
   card creation, then starts unit-scoped study; it has no silent bulk add.
4. ETA uses only local `dailyPacePreference` as new words/day and is explicitly
   device-local.
5. `reviewActivityV1` stores 182 days per target language inside `profile/stats`,
   with coverage-start dates, the stated receipt-time/time-zone rule, parser change,
   30-day/26-week ranges, and no incremental documents.
6. Paths uses the real three tracks and 15 units per track in this wave. This
   content count is validated editorially and is not hard-coded into the schema.

### Rollout and rollback

Roll out additively: publish and validate Catalog V2 first; deploy the trusted
projection and review-activity writers with Rules that deny clients; route
single-card and capped-weight bulk deletes through the trusted callable; then enable
the new Paths and Progress readers only for V2 releases. There is no backfill of
`catalog_progress` or review activity, so legacy units/activity remain unavailable
or partial until new canonical mutations occur. Test create/review/delete,
transaction retry, duplicate receipt, failed mutation, 182-day trimming, parser
compatibility, one-query hydration, and release incompatibility in emulators before
any rollout.

Rollback disables the V2 readers/Continue surface and stops writing the additive
fields in a later trusted release. It does not delete cards, existing stats,
projection documents, or catalog artifacts; these remain inert for a future,
reviewed recovery. No production deployment or data operation follows from this
proposal.
