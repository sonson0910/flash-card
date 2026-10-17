---
title: "Approved source — Japanese pitch accent in practice"
status: approved
---

# Japanese pitch accent in practice

## Prior behavior and data gap

Japanese cards store a kana reading in `phonetic`. The language pack uses it
for furigana and the practice drill accepts that kana as the answer. The drill
now hides the answer until Hint or Check. Neither `CardData`, the card write
allowlist, the generation response, nor the language-pack reading plan stores
pitch accent. Kana alone cannot establish a reliable pitch contour: the same
reading can have different accents by word, meaning, dialect, and context.
The Canvas `LangPractice` artboard shows a kana-with-pitch state, but its sample
contour is visual reference, not verified card data.

## Proposed source and conservative mapping

Wave 1 uses the official **UniDic Kana Accent 2.1.2 source dictionary** from
the National Institute for Japanese Language and Linguistics (NINJAL):

- Archive: `unidic-mecab_kana-accent-2.1.2_src.zip`, released 2013-03-14.
- Canonical archive URL:
  `https://clrd.ninjal.ac.jp/unidic_archive/cwj/2.1.2/unidic-mecab_kana-accent-2.1.2_src.zip`
- Expected SHA-256:
  `70793cacda81b403eda71736cc180f3144303623755a612b13e1dffeb6554591`.
  Verified against the complete 144,116,102-byte archive on 2026-09-28. The
  extraction step must verify it before accepting or changing the shipped subset.
- Licence selected: the New/modified BSD option of UniDic's
  GPL v2.0/LGPL v2.1/New BSD triple licence. NINJAL explicitly permits
  commercial use for contemporary written UniDic under this licence family.
- Attribution: retain the UniDic `AUTHORS` and BSD notice with the extracted
  subset, credit “The UniDic Consortium / NINJAL, UniDic Kana Accent 2.1.2”,
  include the archive URL and state that the data is under the BSD option.

The source exposes `kana`, `aType` (accent type), `aModType` (accent
modification type), and `aConType` (accent connection type). `aType` can be
multi-valued (for example `1,2`) and `aModType` can alter a contour in a
connected phrase. Therefore the application must only create a pitch record
when one source row has all of the following: exact headword match, normalized
hiragana `kana` match, one decimal `aType` from `0` through the reading's mora
count, and `aModType` equal to `*`. It stores `aConType` as provenance only;
the UI must not infer a phrase contour from it. All other rows are kana-only.

The shipped subset is a version-pinned, manually selected static asset rather
than a browser lookup or a Firestore collection. `japanesePitch.ts` records the source
archive version/checksum and the one-based `lex.csv` line in each provenance
record. The checked-in rows were verified against the complete archive with
the checksum above. The source rows include two `面白い` entries with identical accent data;
the current subset rejects that pair because it does not have one source row.
This keeps existing card reads, writes, subscriptions and queries unchanged.

## Implementation boundary

Add verified Tokyo pitch metadata in wave 1 as an optional
`japanesePitchAccent` card field with a normalized kana reading, mora count,
downstep index (0 for heiban), and the UniDic provenance above. Server
validation rejects inconsistent kana/mora/downstep. The create callable derives
metadata from its pinned subset; trusted headword rename recomputes or removes
it inside the existing card write. Client updates cannot change the field.
The create callable rejects inconsistent supplied metadata. If an existing
card's reading changes through a permitted client edit, review validation
ignores its now-stale pitch record so the review can proceed; the UI hides the
contour until a trusted update can replace the record.
The UI displays a contour only when validated metadata matches
the card's current reading; otherwise it displays verified kana without claiming
pitch. This is an additive card schema and data contract.

## Firestore cost

Storing optional metadata inside the existing card document adds **0 new
document reads, writes, subscriptions, or queries** to the existing create,
review, hydration, and practice operations. Document bytes and index storage
increase for cards that have the field. A remote dictionary lookup, a
separate source document, a backfill, or an extra AI request is **not included**
in this cost and requires a separately stated cost and approval. Unmodified
existing cards remain without pitch until a separately approved source/backfill supplies
verified metadata. No production migration or deployment is authorized here.

## Approval boundary

The owner approved this specific source and optional card field on 2026-09-28.
The coverage contract remains deliberately narrow:
only exact, unambiguous static-subset entries populate the field. Existing
cards and any unmatched/compound/context-dependent word remain kana-only.
The kana answer-disclosure fix is independent of this decision.
