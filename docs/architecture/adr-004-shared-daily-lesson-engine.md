# ADR-004: Shared daily lesson engine

Date: 2026-08-04

Status: Accepted for Phase 5 local implementation

## Context

SonFlash has separate Study, Quiz, Spelling and Story flows, but Phase 5 needs a
daily plan, placement check and six exercise types without duplicating scheduling,
progress or answer semantics. The initial bundle is already close to its limit,
and only Study currently owns proven FSRS review writes.

## Options considered

| Option | Benefits | Costs |
| --- | --- | --- |
| Add independent React state to each exercise | Fast per screen | Six inconsistent state machines; duplicated bounds and accessibility behavior |
| Shared pure lesson reducer plus thin mode views | One tested lifecycle; script-aware scoring; lazy UI | Requires an explicit exercise contract |
| Replace all existing Practice flows | Uniform end state | High regression risk; duplicates proven Phase 1 behavior |

## Decision

Add a shared pure daily-learning domain and reducer. Reuse the existing Practice
Pool as its bounded source and preserve the existing `learning.reviewCard` command
as the sole FSRS write path. Recognition, active recall, listening, spelling,
cloze and sentence building show answer feedback, then require an explicit learner
rating; the reducer persists once before advancing. Placement is diagnostic-only.
New presentation loads only when Today starts an exercise or placement session.

## Trade-offs

- Existing Quiz/Spelling remain available while the new engine establishes a
  stable contract; some presentation overlap is accepted temporarily.
- Placement can recommend a tier but cannot unlock or persist it in Phase 5.
- Placement and plans use learner-owned cards. Placement requires valid CEFR
  evidence and clearly exposes insufficient-data states rather than draft content
  or inferred tiers.

## Consequences

- Learning State and catalog ownership remain separate.
- All new typed modes share explicit language/script scoring.
- Phase 6 can add validated catalog lesson groups or placement persistence behind
  the same ports without rewriting the UI lifecycle.

## Revisit triggers

- Published lesson groups become available for multiple scripts.
- Placement outcomes gain an approved persistence schema.
- Existing Quiz/Spelling can be retired without product regression.
