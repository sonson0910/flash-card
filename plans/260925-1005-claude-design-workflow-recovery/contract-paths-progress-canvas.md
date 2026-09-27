---
title: "Pending decision — Paths and Progress Canvas data"
status: pending-owner-decision
---

# Paths and Progress Canvas data

## Verified gap

Paths currently has three published tracks and tier totals, but no declared unit title/order, active-unit source, unit progress, or unit action. Catalog membership has `lessonGroup` and `rank`; a production writer for `users/{uid}/learning_states` was not found, although Paths currently reads up to 10,000 such documents. The Canvas example's six shelves and twelve units cannot be presented as real catalog data.

Progress currently uses XP history for its activity heatmap. XP is not a count of reviews. The current stats model also has no 14-day due forecast, recent-mastery timestamp, or range-sensitive review series. No client scan of all card histories or invented Canvas values is allowed.

## Proposed bounded sources

| Canvas datum | Proposed source | Incremental Firestore document I/O |
|---|---|---|
| Unit title/order/count and preview | Versioned unit descriptors in the downloaded catalog artifact; validate against membership at build time and cache with the catalog | 0 reads, 0 writes |
| Active unit and unit completion | A maintained, server-owned progress projection; its write path must be designed against create/review/delete/import before implementation | Cost not approved or estimated yet |
| Unit ETA | `dailyPacePreference` only if owner defines it as new words per day; otherwise unavailable | 0 reads, 0 writes if device-local |
| Reviews by day and recall buckets | Bounded 182-day, target-language-scoped projection inside the already-read/written `profile/stats` document, updated in the strict-review transaction | 0 additional reads, 0 additional writes per review or hydration |
| Due forecast, today through day 13 | Reuse due-today aggregate; 13 bounded aggregate count queries for future days, cached by owner/language/local date | 13 aggregate query reads on first daily hydration, 0 on same-day cache hit; 0 writes |
| Four recently mastered cards | Server-owned `masteredAt` on each card's existing review write, then a bounded indexed query | 0–4 document reads per hydration; 0 additional writes on review; schema/Rules/index change |

History and mastery begin on the date the new projection becomes authoritative. Legacy XP and capped card histories cannot reconstruct complete review counts. The UI must label older coverage as partial unless a separately approved backfill exists. Existing card writes are counted as existing writes; added fields increase document/index bytes.

## Decisions required before implementation

1. Approve a versioned catalog unit contract and a maintained active-unit/progress source. Define whether Continue starts existing review, adds unit words, or performs another action. The current `learning_states` reader is not sufficient without a proven writer.
2. Define `dailyPacePreference` as new words per day for ETA, or omit ETA until a separate pace model exists.
3. Choose the canonical mastery threshold and whether a lapse clears `masteredAt`.
4. Approve or reject 13 cached aggregate count queries for the due forecast. This is new Firestore I/O and must not be implemented without approval.
5. Approve the `masteredAt` card field, Rules/index changes, and 0–4 reads per Progress hydration, or keep Recently mastered unavailable.
6. Approve forward-only activity/mastery coverage and target-language scope. Account-wide XP remains separately labelled.

The current phase-06 Canvas comparison checkbox remains open. UI can display honest unavailable states without additional I/O, but those states do not make the ready-state Canvas MATCH.
