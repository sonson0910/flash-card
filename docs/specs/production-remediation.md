# Production remediation specification

Status: approved for implementation from the 2026-08-04 product audit.

## Objective

Make the core learning journey reliable and honest: the app must start even when
browser storage or Firebase is unavailable, authentication must not leave the UI
waiting indefinitely, a trusted catalog entry must be addable to the learner's
library and daily plan, and Progress must reflect actual learning activity.

## Required outcomes

1. Storage failures degrade to a recoverable in-memory session. No supported
   route may reach the application error boundary solely because Web Storage is
   unavailable, full, or contains invalid JSON.
2. Identity discovery and interactive sign-in have bounded waiting states. A
   cached sync epoch never authorizes cloud mutations until the adapter verifies
   it for the current authenticated owner.
3. Catalog publication is fail closed. Draft, generated, or unreviewed content
   cannot be relabelled as reviewed by application code or build tooling.
4. Published catalog entries expose a clear add-to-library action. Adding an
   entry is idempotent, survives navigation, appears in Today, and can produce a
   review event that is reflected in Progress.
5. Empty Progress is based on learning activity, not merely card count, and
   avoids loading the chart bundle before activity exists.
6. Language options advertise only catalog releases that actually exist and
   pass the same integrity and editorial gates. Unsupported languages remain
   visibly unavailable instead of silently falling back to English.
7. Catalog releases use immutable, content-derived identifiers. Generation is
   scoped to its own target and cannot recursively delete unrelated public
   assets. Manifests are served with revalidation/no-cache semantics.
8. CI covers storage denial, bounded auth, stale-epoch write blocking, catalog
   provenance, and the Catalog -> Today -> Progress critical path.
9. The functions dependency audit has no known high/critical issue and any
   reachable moderate issue with a supported fix is upgraded.
10. Production deployment remains an explicit operator action with quality
    gates and environment approval; this change does not claim that an absent
    Firebase Hosting site has been deployed.

## Acceptance evidence

- Unit and integration tests reproduce each reported failure before the fix and
  pass afterward.
- The complete repository verification command and production build pass.
- Browser smoke tests cover guest startup, denied storage, catalog add, Today,
  Progress, and an auth timeout/error path without uncaught exceptions.
- Generated catalog manifests and checksums are deterministic across two builds.
- No learner-facing artifact claims human/editorial review without traceable
  evidence. Content still awaiting a human editor stays out of published feeds.

## Work ownership

- Reliability lane: session state, authentication timeouts, mutation gating,
  gamification/library storage adapters, and regression tests.
- Catalog lane: provenance rules, release generation, language availability,
  immutable manifests, and semantic quality tests.
- Learning-flow lane: catalog actions, library/Today integration, Progress
  activity semantics, accessibility, and critical-flow tests.
- Integration lane: configuration, dependency audit, CI/release safeguards,
  cross-lane review, browser verification, and final evidence.

## Non-goals and safety constraints

- Do not weaken Firestore ownership rules, App Check, rate limits, or catalog
  editorial policy to make a test pass.
- Do not invent human reviewers, definitions, pronunciations, or source
  provenance. Human editorial approval is an external content dependency.
- Do not deploy, rotate credentials, or change production data as part of this
  implementation without separate authorization.
