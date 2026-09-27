---
title: "Pending decision — Japanese pitch accent in practice"
status: pending-owner-decision
---

# Japanese pitch accent in practice

## Current verified behavior

Japanese cards store a kana reading in `phonetic`. The language pack uses it
for furigana and the practice drill accepts that kana as the answer. The drill
now hides the answer until Hint or Check. Neither `CardData`, the card write
allowlist, the generation response, nor the language-pack reading plan stores
pitch accent. Kana alone cannot establish a reliable pitch contour: the same
reading can have different accents by word, meaning, dialect, and context.
The Canvas `LangPractice` artboard shows a kana-with-pitch state, but its sample
contour is visual reference, not verified card data.

## Decision required

1. **Add verified Tokyo pitch metadata in wave 1.** Define an optional
   `japanesePitchAccent` card field with a normalized kana reading, mora count,
   downstep index (0 for heiban), and provenance. Only a source approved for
   redistribution and review may populate it. Server validation must reject
   inconsistent kana/mora/downstep and owner mutation paths must preserve it.
   The UI displays a contour only when validated metadata matches the card's
   current reading; otherwise it displays the verified kana without claiming
   pitch. The source, license, coverage target, and review gate must be chosen
   before implementation. This is an additive card schema and data contract.
2. **Accept kana-only in wave 1.** Keep the current card contract and record
   the Canvas pitch panel as an explicit deferred exception. Pitch remains a
   separate backlog item; the wave-1 Japanese drill does not claim it exists.

## Firestore cost if option 1 is approved

Storing optional metadata inside the existing card document adds **0 new
document reads, writes, subscriptions, or queries** to the existing create,
review, hydration, and practice operations. Document bytes and index storage
increase for cards that have the field. A server-side dictionary lookup, a
separate source document, a backfill, or an extra AI request is **not included**
in this cost and requires a separately stated cost and approval. Existing
cards remain without pitch until a separately approved source/backfill supplies
verified metadata. No production migration or deployment is authorized here.

## Approval boundary

Do not add the field to `CardData`, Functions validation, Firestore Rules,
generation output, import/export, or a callable until the owner chooses an
option and, for option 1, approves the provenance and coverage contract.
The kana answer-disclosure fix is independent of this decision.
