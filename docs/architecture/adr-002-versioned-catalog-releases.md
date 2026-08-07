# ADR-002: Separate candidates from immutable versioned catalog releases

## Status

Accepted for Phase 3 on 2026-08-03.

## Context

Catalog source is untrusted and may be generated, malformed, incorrectly licensed
or incompletely reviewed. The current public Firestore paths intentionally expose
only published v3 snapshots. Mutating those documents through draft/review states
would temporarily withdraw live content and make offline rollback ambiguous.

The product targets up to 10,000 catalog memberships with offline queries under
100 ms and cached content visible under 500 ms on target devices.

## Options considered

| Option | Benefits | Costs |
|---|---|---|
| Mutate `/lexemes` and `/track_memberships` in place | Few collections | Can withdraw live content; weak rollback; state/version races |
| Separate candidate/revision records and immutable releases | Safe review, deterministic releases, clear rollback | More pipeline contracts and storage records |
| External CMS immediately | Mature workflow | New dependency, cost, credentials and operational scope |

## Decision

Use separate candidate/revision records and immutable release manifests. A trusted
publisher validates candidates, review evidence, licenses, versions and references,
then atomically publishes snapshots and an append-only audit event. Client catalog
writes remain denied.

Release chunks are same-origin, deterministically encoded and SHA-256 checked.
Hashes detect corruption only; publisher authenticity continues to come from the
trusted same-origin deployment boundary.

Offline installation stages a complete generation in a dedicated global
IndexedDB database, then flips one active-release pointer. It retains the previous
complete release for rollback and never stores learner progress.

## Trade-offs

- Candidate and release storage are duplicated, but published availability and
  rollback become independent from editorial work.
- Native IndexedDB and Web Crypto require more code than a new library, but avoid
  runtime dependency and bundle risk.
- Phase 3 produces non-publishable pilot candidates because source rights and
  human review evidence are unavailable. This is deliberately less immediately
  visible than falsely publishing unverified content.

## Consequences

- Phase 4 can browse one stable active catalog while editors prepare later versions.
- Every semantic edit increments content version and restarts review at draft.
- Import/apply tooling defaults to dry-run; production apply remains separately
  authorized.
- Revisit signed manifests when catalogs are delivered from a CDN or third party,
  and revisit an external CMS when real editorial staffing/workflow requires it.
