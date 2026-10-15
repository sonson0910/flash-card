# Increment 3 — no-fetch Listen MVP seam

## Scope

Build the first Immerse presentation seam without downloading or publishing
external media. The feature accepts already validated `CatalogMediaClipV1`,
`CatalogContentChunkV1`, and trusted source-registry data, then presents an
accessible audio lesson when a reviewed release supplies a same-origin path.

The repository currently has no reviewed VOA derivative and the existing
publication evaluator remains fail-closed for required attribution. This slice
therefore provides an injectable lesson model and a truthful unavailable state;
it does not add VOA bytes, external fetches, catalog release wiring, Firestore,
or learner-data writes.

## Tasks

1. Reject sparse arrays centrally in the existing catalog parser and cover
   content lexeme/cue regressions.
2. Add a feature-local lesson contract that:
   - reuses the Increment 2 parsers and trusted-reference check;
   - requires a secure source link and renders license/attribution metadata;
   - bounds comprehension prompt/options and requires one answer.
3. Add a focused presentational player with native audio controls, replay,
   `0.75x`/`1x` speed, sentence captions, local comprehension state, and an
   optional save-chunk callback. The callback is an integration seam only; this
   increment supplies no learner persistence implementation.
4. Keep the feature unmounted until a reviewed release supplies the lesson;
   no navigation or catalog-cache schema changes are required.

## Acceptance

- Sparse arrays cannot satisfy non-empty or ordered-array parser invariants.
- A lesson cannot be built from a missing trusted source, missing HTTPS source
  link, checksum mismatch, unknown chunk lexeme, malformed choices, or an
  answer outside the choices.
- Player markup has labels, keyboard controls, captions toggle, visible source
  link/license/attribution, and an honest no-lesson state.
- Comprehension and playback controls remain local; no FSRS, SkillEvidence,
  Firestore, IndexedDB, or learner-library mutation occurs.
- No external asset is fetched, copied, or published.

## Verification

```bash
npx vitest run src/features/catalogPipeline/catalogValidation.test.ts src/features/listenMvp
npm run catalog:verify
npm run lint
npm test -- --run
npm run build
git diff --check 1099ef5f60cfa824b6ffb2292b9f95cc37e198e1...HEAD
```

Real VOA ingestion remains a separately authorized follow-up after per-asset
rights evidence and an attribution delivery/release path exist.
