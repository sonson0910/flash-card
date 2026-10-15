# Language golden-set input rubric

This file defines the staging-run and human-review protocol for
`language-golden-set-input-261001.csv`. The CSV is input-only: it contains no
provider output, deterministic-reading answer, score, or cost result.

## Input contract

Each row maps to one `generateVocabulary` word request:

```json
{
  "action": "word",
  "operationId": "<unique UUID v4>",
  "input": {
    "term": "<term>",
    "context": "<context, only when context_stratum is context-present>",
    "language": { "source": "<source_language>", "target": "vi" },
    "partOfSpeech": "<part_of_speech, only when nonblank>"
  }
}
```

Omit `context` when the CSV context is blank. Omit `partOfSpeech` when the CSV
field is blank; otherwise it must be an accepted callable hint. Use a unique
operation ID for every staging invocation. Do not call the real provider from
CI or substitute fixture outputs for this gate.

Use the owner-approved `gemini-3.1-flash-lite` model only; do not use a fallback
model. Record the actual model and prompt version for each staging result.

## Required staging ledger

Capture one ledger record per input row outside the input CSV, with these
columns:

```text
case_id,staging_run_id,operation_id,requested_at_utc,provider,model,prompt_version,
request_hash,provider_request_id,response_schema_valid,provider_latency_ms,
input_tokens,output_tokens,cost_currency,cost_amount,pricing_source_ref,
output_artifact_ref
```

`output_artifact_ref` must point to access-controlled captured output. Keep the
output separate from the input set so later reviewed fixtures have clear
provenance.

## Human review sheet

One qualified native-language reviewer records one row per captured output:

```text
case_id,reviewer_id_or_alias,reviewed_at_utc,accepted_senses,selected_output_sense,
sense_correct,reference_reading,reference_source_id,reference_source_version,
pronunciation_matches_source,schema_valid,notes,fixture_approved,
approved_fixture_ref,approved_fixture_sha256
```

The reviewer records the selected output sense and all acceptable senses for
each case. For a context-free case, accept a valid common sense consistent with
any supplied part-of-speech hint; do not invent one required answer before the
model runs. Record the reference reading and its source/version where a
deterministic source exists; mark the pronunciation comparison inapplicable
otherwise. Promote only reviewed output to a regression fixture, and retain
its source output reference and SHA-256 digest.

For each pack, report context-present and context-absent sense correctness
separately. The planned gate is schema validity 100%, deterministic-source
pronunciation 100% where such a source exists, sense correctness at least 90%
with context and 80% without. The 80 input rows intentionally contain 10 rows
in each stratum per source language; they do not assert an expected answer.
Record a separate run-level owner decision with `staging_run_id`, reviewer
summary, threshold results, approval time, and approved release scope before
enabling a language pack.

## Coverage and selection rules

- Four source packs: `en`, `ko`, `ja`, `zh`; all target Vietnam-pilot native
  language `vi`.
- Each pack has 20 rows, split 10 `context-present` and 10 `context-absent`.
- `coverage_tags` identify reading, script, polysemy, homograph, heteronym,
  tone, or compound cases for reviewer sampling. They are selection metadata,
  not expected model output.
- Re-run only after recording a new `staging_run_id`; retain prior ledgers so
  cost and quality regressions are comparable.
