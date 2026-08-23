# Security Remediation Design

## Status

Approved by the repository owner on 2026-08-23.

## Objective

Resolve all 21 validated findings from Codex Security scan
`11b6aff7-ca90-4866-8106-bd9bdb1e7a94` without changing the product's visual
interface or animation behavior. Preserve all valid user data, including every
legacy shared deck owned by the repository owner.

## Constraints

- Keep the existing UI, layout, copy hierarchy, and effects unchanged. Security
  work may reject unsafe inputs or show existing error states, but must not
  redesign components.
- Treat all valid legacy shared decks as owner data. Preserve their cards and
  identifiers whenever the current schema permits.
- Delete only records proven to be empty, malformed, or exact duplicates after
  a verified backup and dry run.
- Never perform an irreversible production mutation without a manifest, counts,
  checksums, a rollback procedure, and explicit operator confirmation.
- Reuse existing validation, release-artifact, migration, and test patterns.
  Add no dependency unless existing platform capabilities cannot enforce the
  required boundary.
- Keep changes deployable and reversible in small waves. Firestore Rules must
  never be deployed before required data and server writers are compatible.

## Chosen Approach

Use a staged, security-first rollout. Establish reusable limits and trusted
server controls first, migrate and verify data second, tighten authorization
third, then harden operational and client-only boundaries. Each wave must leave
the repository buildable and production behavior recoverable.

Rejected alternatives:

- A single large release couples data migration, Rules, Functions, CI, and
  client changes, making rollback unsafe.
- Fixing only medium findings leaves known low-severity trust-boundary defects
  and does not satisfy the requirement to resolve every finding.

## Architecture

### 1. Server-enforced resource budgets

Keep existing per-UID limits, and add durable aggregate budgets for paid AI,
image-provider, sharing, and migration work. Budget consumption must happen
atomically before expensive work. Provider-side quotas remain the final safety
net. Storage failures must fail closed for paid or persistence-expanding paths;
the current in-memory allowance may remain only for operations whose cost and
blast radius are explicitly bounded.

Firestore allocation must be bounded by trusted code rather than wildcard
client creation. Profile document names and shapes become explicit. New card
identity/reservation allocation and public-share retention receive per-owner
count or byte ceilings.

This addresses:

- Per-UID quota multiplication.
- Unbounded profile and card identity creation.
- Rate-limit fallback allowances during storage degradation.
- Roughly 10 GB of retained public shares per account.

### 2. Canonical validation at the data boundary

Mirror existing client limits in Firestore Rules for every canonical card
string, list item, history entry, and nested gamification value. The Rules are
the authoritative direct-client boundary; Functions reuse matching constants
where they write the same shapes. Existing ownership, identity, media, and
learning-state checks remain intact.

This addresses:

- Unbounded descriptive fields and list items on canonical cards.
- Oversized gamification stats and history values.

### 3. Lossless shared-deck transition

Run an operator-only inventory before changing Rules. The inventory records
each legacy share ID, content digest, card count, schema, inferred owner, and
classification. All valid records are assigned to the repository owner's
canonical Firebase UID, receive bounded `expiresAt` and private ownership
metadata, and retain their current public identifier where possible.

The migration sequence is:

1. Export a restorable backup and seal its manifest.
2. Dry-run classification and publish counts without exposing card content.
3. Stop if any valid record cannot be attributed to the configured owner.
4. Migrate valid records idempotently and verify content digests.
5. Quarantine, rather than immediately delete, malformed, empty, or duplicate
   records.
6. Deploy Rules that require expiry and revocable ownership.
7. Delete quarantined records only after a post-cutover verification window.

Owner UID must remain private. Public documents contain only the fields needed
to render a shared deck; ownership and revocation metadata live in an
owner-private companion document. Firestore TTL is configured and verified for
both public and private share records.

This addresses:

- Indefinitely public, non-revocable legacy shares.
- Stable Firebase UID disclosure through transitional shares.
- Excessive retained shared-deck data.

### 4. Bounded, concurrency-safe library migration

Move the batch boundary into Firestore queries. Each invocation reads one
stable page under hard document and byte limits, persists a trusted cursor, and
loads reservations only for that page. An owner-scoped lease prevents parallel
jobs from duplicating work.

Apply records the exact source version or digest used to build each backup.
Rollback restores only when the live value still matches the applied output;
otherwise it stops and reports a conflict. Dry-run uses the same bounded query
path and cannot scan an entire library in one invocation.

This addresses:

- Whole-library scans before applying a batch limit.
- Rollback restoring stale snapshots over newer updates.

### 5. Trusted release and catalog provenance

Production workflows accept only a full immutable SHA reachable from the
protected default branch or an explicitly approved immutable tag. Credentialed
jobs execute scripts from the verified candidate artifact or a separately
checked-out trusted revision. GitHub environment branch restrictions and
reviewer approval remain required external controls and must be verified in the
runbook.

Install the pinned Firebase CLI dependency tree with lifecycle scripts disabled
before cloud authentication, verify the installed version, and invoke the local
binary during authenticated deployment.

Catalog approval cannot be asserted by candidate data. A protected operator
input supplies trusted reviewer authority and binds approval to a canonical
content digest, reviewer identity, and timestamp. The existing deterministic
catalog artifact and digest checks remain unchanged.

This addresses:

- Production workflows executing non-protected refs.
- Dependency resolution after production authentication.
- Candidate-controlled reviewer approval.
- Release packaging following symlinks outside reviewed roots.

### 6. Browser, import, extension, and local-development boundaries

Spreadsheet import validates archive entry count, declared expansion, worksheet
dimensions, and cell count before eager conversion where the installed parser
supports it. Parsing moves off the UI thread when a pre-parse limit cannot be
guaranteed. Both import paths share one bounded parser, avoid duplicate
materialization, and retain current visible UI behavior.

Account-sensitive import work captures the initiating UID and aborts before
mutation if the active UID changes.

Extension fragments are length-checked before decoding. Job results are bound
to a one-time nonce, expected origin, tab/frame, and pending job. Existing
extension screens and animations do not change.

The loopback development API uses a random session token, strict request-body
limits, capped leases/event queues, and idle cleanup. It continues binding only
to loopback. Development Gemini access moves behind the existing backend path;
no billable provider secret is embedded in browser code.

This addresses:

- XLSX resource exhaustion.
- Import completion under a newly active account.
- Oversized extension fragments and forged extension job results.
- Unauthenticated loopback state access and unbounded loopback resources.
- Development Gemini key exposure in browser code.

## Data Flow And Failure Behavior

- Every resource-expanding request follows: authenticate and validate App
  Check, validate shape, atomically reserve budget, perform bounded work,
  persist result, then finalize budget/accounting.
- Budget or authorization storage unavailable: reject safely with the current
  generic error contract; do not grant a new paid allowance.
- Shared-deck migration mismatch: stop the current owner batch, retain backup
  and quarantine, and produce a redacted conflict report.
- Migration apply or rollback conflict: leave live data untouched and require
  operator review.
- Import/extension/local API limit violation: reject before decoding, parsing,
  or mutation and preserve the current screen state.
- Release provenance or dependency verification failure: terminate before any
  cloud credential is made available.

## Rollout Waves

### Wave 1: Guardrails and regression tests

Add failing tests for all findings, centralize existing bounds where necessary,
and add deployment/data-inventory preflight checks. No production behavior is
changed until each intended boundary has a reproducible regression test.

### Wave 2: Backend budgets and validation

Deploy Functions-compatible budget accounting and bounded migration APIs, then
deploy matching Firestore validation rules. Use emulator tests for direct SDK
bypass attempts and Functions tests for storage failure and concurrency.

### Wave 3: Shared-deck data migration and Rules cutover

Back up, dry-run, migrate, verify, and quarantine legacy records. Deploy the
expiry/revocation Rules only after all valid decks are represented in the new
schema. Retain rollback artifacts through the verification window.

### Wave 4: Production workflow and catalog hardening

Lock trusted revisions, move dependency installation before authentication,
reject unsafe symlinks, and bind catalog approvals to protected authority.
These changes are verified without contacting production first.

### Wave 5: Client and development boundaries

Unify bounded spreadsheet parsing, bind imports to identity, harden extension
messages, authenticate/cap the loopback service, and remove client-side Gemini
secrets. UI snapshots and motion tests must remain unchanged.

### Wave 6: Full assurance verification

Run focused tests after every task, then the repository's full verification,
Firestore emulator suite, extension checks, migration integration tests, and
release workflow contract tests. Perform independent correctness and security
reviews after implementation. Re-run the Codex Security scan and resolve every
substantiated regression before completion.

## Verification Strategy

- Functions: unit tests for aggregate budgets, fail-closed behavior, bounded
  pagination, owner leases, and rollback conflicts.
- Firestore Rules: emulator tests for oversized fields, invalid document IDs,
  allocation ceilings, private owner metadata, expiry, and revocation.
- Migration: fixture-based backup/dry-run/apply/verify/rollback tests, including
  concurrent edits and idempotent restart.
- Release: static workflow contract tests proving trusted-ref reachability,
  pre-auth installation, version verification, and symlink rejection.
- Catalog: tests proving candidate content alone cannot authorize publication.
- Import: adversarial archive metadata and account-switch tests without
  allocating dangerous payloads.
- Extension: nonce, origin, tab/frame, encoded-size, replay, and expiry tests.
- Development API: missing/invalid token, oversized body, lease cap, event cap,
  and cleanup tests.
- Regression: TypeScript checks, production build, existing E2E, accessibility,
  visual, and motion suites. No intentional screenshot or animation delta is
  accepted.

## Definition Of Done

- All 21 findings map to a merged code change and a focused regression test.
- All valid legacy shared decks are preserved and attributable to the owner's
  canonical UID; card-content digests match the sealed backup.
- No Rules or migration cutover can strand old data or overwrite a concurrent
  edit.
- Production credentials are unavailable until revision, artifact, dependency,
  and operator checks pass.
- Full repository verification passes, followed by independent reviewer and
  security-reviewer approval.
- A repeat Codex Security scan reports no remaining validated instance of the
  21 findings.
- UI and animation behavior are unchanged.

## Operational Preconditions

Before execution reaches production, the owner must provide or confirm the
canonical Firebase UID that owns all valid legacy shares. Repository tests may
use fixtures, but production migration must not infer or hard-code that value.
External Firebase TTL/App Check settings, provider quotas, GitHub environment
reviewers, and protected-branch restrictions require an operator checklist
because repository source alone cannot prove their deployed state.
