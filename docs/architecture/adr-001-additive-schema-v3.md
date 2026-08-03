# ADR-001: Additive schema v3 with compatibility projections

## Status

Accepted for Phase 2.

## Context

Schema v2 stores shared vocabulary content and learner progress in one per-user
card. Its identity is word-based, so languages and senses can collide. A direct
in-place rewrite would risk FSRS and offline progress and would make rollback
ambiguous.

## Options considered

| Option | Benefits | Costs |
| --- | --- | --- |
| Rewrite v2 documents in place | Fewer collections initially | High data-loss and rollback risk; old clients break |
| Add v3 fields to the existing card | Smaller code diff | Content/progress remain coupled; identity remains ambiguous |
| Add Lexeme, Track Membership and Learning State entities | Correct ownership and reusable progress | Requires dual-read and migration manifests |

## Decision

Adopt separate schema v3 entities and retain v2 during the compatibility window.
Consumers receive a compatibility projection. Migration produces a deterministic
bundle plus the normalized v2 rollback snapshot; it does not delete the source.

## Consequences

- Positive: language/sense-safe identity, shared track progress and safe rollout.
- Negative: temporary dual schema and additional validation/projection code.
- Mitigation: isolate version branching at one seam, add architecture tests and
  retire v2 only after the Phase 6 migration/rollback gate succeeds.

## Revisit trigger

Revisit after canary migration proves rollback and all supported clients read v3.
