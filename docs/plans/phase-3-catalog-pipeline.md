# Phase 3 — Catalog pipeline, editorial workflow and offline delivery

Date: 2026-08-03

Status: Implemented and verified locally; no production import, publication or deployment performed.

## Objective

Build a deterministic and bounded catalog pipeline on top of schema v3. The
pipeline validates source candidates, provenance and licenses; enforces editorial
and version transitions; produces immutable chunked releases; plans trusted
imports; and installs complete releases into an indexed offline cache without
mixing shared catalog content with learner-owned progress.

The English pilot contains exactly 300 IELTS, 300 TOEIC and 300 General Track
Membership candidates. Because no licensed corpus or human reviewer is present
in the repository, these candidates remain explicitly draft, unreviewed and
non-publishable. Phase 3 must never manufacture review or licensing evidence.

## Assumptions

- A “300-item track” means 300 Track Memberships. Lexemes may be shared across
  tracks so one learner keeps one Learning State per lexeme.
- Catalog candidates and published releases are separate. Editing published
  content creates a new candidate version and cannot withdraw the active release.
- Same-origin manifests are the current trust source. SHA-256 detects corruption
  but does not authenticate the publisher.
- Phase 4 will expose catalog browsing and learning-path UI. Phase 3 provides a
  production composition seam and a tested cache/query API, not new UI.
- No new runtime dependency is required.
- No production import, deployment or destructive migration is authorized.

## Architecture decisions

- Source candidates use an explicit bounded manifest; no filesystem globs or
  importer-controlled network fetches.
- Release manifests are immutable and sequence-versioned independently from
  entity `schemaVersion` and `contentVersion`.
- Candidate provenance evidence lives beside source records. Published Lexeme
  and Track Membership snapshots retain the public provenance projection.
- The editorial state machine permits `draft → reviewed → published → archived`
  and `reviewed → draft`. Archived snapshots are terminal.
- Publication requires an approved license, named reviewer, review timestamp,
  content-bound review evidence and compatible published references.
- Trusted publication writes an append-only audit event atomically with the
  snapshot/release mutation. Clients retain zero catalog write capability.
- Offline delivery uses a dedicated global IndexedDB database. Installation is
  staged by release generation and activates only after all chunks, counts,
  hashes and references validate. The previous complete release is retained.

## Shared contracts and bounds

- Maximum release: 10,000 memberships, 100 chunks and 50 MiB encoded.
- Maximum chunk: 100 memberships and 512 KiB encoded.
- Fetch concurrency: 3; IndexedDB write batch: 100 records.
- Manifest paths are same-origin relative paths without traversal.
- Every parser rejects unknown fields, overlong values, duplicate IDs, duplicate
  canonical identities, broken references and count/hash mismatches.
- A pilot release must contain exactly 300 memberships for each `ielts`, `toeic`
  and `general` track.

## Threat model

Trust boundaries are source JSON/JSONL, generated or AI-assisted content,
provenance/license claims, reviewer fields, release manifests, fetched chunk
bytes and IndexedDB state. Abuse cases include path traversal, oversized input,
hash/count forgery, duplicate identity collision, broken references, reviewer
spoofing, status skipping, stale version replay, partial cache activation and
quota failure. All are handled at a pure validation/planning seam before writes.

## Project structure

```text
src/features/catalogPipeline/  strict contracts, validation, build and import plan
src/features/catalogCache/     staged IndexedDB installation and indexed queries
catalog/                       provenance registry and draft pilot sources
public/catalog/                deterministic immutable release artifacts
scripts/                       catalog validation/build/verification CLI
docs/architecture/             catalog release ADR
```

## Code style

```ts
export type CatalogValidationResult =
  | { readonly status: 'accepted'; readonly catalog: ValidatedCatalog }
  | { readonly status: 'quarantined'; readonly issues: readonly CatalogIssue[] };
```

Prefer pure functions, readonly contracts, explicit discriminated results and
injected ports. No parser performs network, filesystem, Firestore or IndexedDB
work. Runtime I/O adapters call the same pure validators.

## Task plan

### Task 1 — Contracts, source manifest and strict parser

- Define bounded source/release/chunk/provenance/review contracts.
- Expose strict Phase 2 leaf parsing for Lexeme and Track Membership reuse.
- Reject unknown fields, bad IDs, duplicates and broken references.
- Verify with RED/GREEN unit tests and TypeScript.

### Task 2 — Editorial, licensing and version workflow

- Implement license registry policy and content-bound review evidence.
- Implement the complete allowed/denied transition table and trusted audit event.
- Reject `non-publishable`, `NOASSERTION`, `unreviewed` and reviewer spoofing at
  publication.
- Verify with table-driven unit tests and Firestore Rules source tests.

### Checkpoint A

- Catalog pipeline tests and lint pass.
- No client catalog mutation becomes possible.

### Task 3 — Deterministic release builder and import plan

- Produce stable ordering/canonical bytes and SHA-256 chunk descriptors.
- Enforce exact counts, global identity/reference integrity and release sequence.
- Plan create/update/archive/conflict/unchanged with compare-and-set semantics;
  dry-run is the only default.
- Verify byte-identical rebuilds, stale conflicts and replay idempotency.

### Task 4 — Offline staged cache and indexed query API

- Create a dedicated forward-compatible IndexedDB database.
- Stage chunks, resume valid receipts and atomically activate only a complete
  release while retaining the previous complete release.
- Add bounded queries for language, track, tier, CEFR, topic, part of speech,
  skill, rank and normalized-lemma prefix.
- Verify interruption, bad hash, stale generation, quota and rollback behavior
  with `fake-indexeddb`.

### Checkpoint B

- A 10,000-record structural benchmark proves cursor-bounded indexed queries.
- Existing card mirror and learner progress tests remain green.

### Task 5 — Honest 900-membership pilot and CLI

- Generate exactly 300 memberships per IELTS/TOEIC/General track.
- Mark every generated candidate `ai-assisted`, `non-publishable`, `unreviewed`
  and `draft`; never call it official.
- Add `catalog:validate`, `catalog:build` and `catalog:verify` commands.
- Assert zero draft pilot candidates can enter a publishable release.

### Task 6 — Runtime seam, Rules and independent review

- Expose catalog delivery/cache ports through the composition root with lazy
  loading and no initial-bundle regression.
- Keep candidate/revision/audit collections client-write denied and non-public.
- Review correctness, readability, architecture, security and performance with
  an independent agent, then remediate every Critical/Required finding.

## Testing strategy

- Pure contracts/workflow/build/import: Vitest small tests.
- IndexedDB cache: `fake-indexeddb` medium tests with real transactions.
- CLI/artifacts: Node integration tests, deterministic byte/hash comparison.
- Rules: source invariants plus Java-backed emulator when available.
- Product regression: existing Playwright browser and accessibility suites.

## Commands

```bash
npm run catalog:validate
npm run catalog:build
npm run catalog:verify
npm run lint
npm test -- --run
npm --prefix functions run lint
npm --prefix functions test
npm run test:rules
npm run build:release
npm run verify:secrets
npm run verify:bundle
npm run verify:audit
npx playwright test --project=chromium --project=webkit
```

Real filesystem operations accept explicit arguments after `--`:

```bash
npm run catalog:validate -- --input catalog/source-manifest.json --rights catalog/rights-registry.json
CATALOG_APPROVED_DIGEST="PASTE_APPROVAL_DIGEST_FROM_VALIDATE_OUTPUT" \
CATALOG_REVIEWER_ID="trusted-reviewer" CATALOG_REVIEWED_AT="2026-08-03T00:00:00.000Z" \
npm run catalog:build -- --input catalog/source-manifest.json --rights catalog/rights-registry.json --out build/catalog-release
npm run catalog:verify -- --manifest build/catalog-release/release-manifest.json
```

Without arguments, the three commands run repository gates. In particular,
`catalog:build` proves that the draft pilot cannot produce an artifact. A real
build reads only the manifest's bounded JSONL files and the separately supplied
bounded rights registry, refuses symlinks and path traversal, writes through a
sibling temporary directory, and atomically renames the complete release.
Verification is read-only and rechecks every chunk byte,
SHA-256 digest, count and cross-reference.

## Implementation record

Completed locally on 2026-08-03:

- strict source, candidate, release and chunk contracts with deterministic
  canonical serialization and immutable release fingerprints;
- review-content digests that survive workflow status changes while still
  invalidating substantive edits, plus private `rightsEvidenceId` handling;
- dry-run-only import plans with release compare-and-set and collision detection;
- IndexedDB schema v3 with atomic staged activation, active/previous rollback,
  bounded indexed queries and release-scoped full Lexeme hydration;
- an honest 300/300/300 English pilot whose 900 memberships remain AI-assisted,
  draft, unreviewed, `NOASSERTION` and non-publishable;
- lazy production composition for install, query and hydration; and
- explicit client denial for candidate, revision and audit collections.

Independent review found four Required issues in the first implementation
(workflow digest, rights evidence, dropped offline content and test-only CLI
semantics). All four were remediated before completion. SHA-256 is used for
integrity and deterministic identity, not publisher authentication.

Operational boundaries remain unchanged: no licensed external dataset or named
human review evidence exists in this repository, so no pilot release was
published. No import apply, Firebase migration, staging/production deployment or
destructive operation was run.

## Success criteria

1. External catalog input is strictly validated and deterministically quarantined.
2. Duplicate IDs/identities and broken membership references cannot build.
3. Publication cannot skip review or use unknown/non-publishable licensing.
4. Published versions are immutable; retries are idempotent and stale writes conflict.
5. Identical input produces byte-identical chunks and manifest hashes.
6. Partial/corrupt/quota-failed installs never replace the active offline release.
7. Active and previous complete releases support atomic rollback.
8. Queries are indexed and bounded; 10,000 items require no full-store scan.
9. Pilot counts are exactly 300/300/300 and every pilot item remains draft.
10. Existing Phase 2 migration/progress compatibility remains intact.

## Boundaries

- Always: validate before I/O, preserve published and active prior versions,
  record honest provenance, use TDD, keep operations bounded and commit increments.
- Ask first: real dataset ingestion, unknown/custom license approval, named human
  reviewer assignment, production Admin credentials, import apply or deployment.
- Never: call generated content official, publish `non-publishable` content,
  trust reviewer fields from source input, activate a partial release, mix catalog
  cache with Learning State, or run production import/deploy automatically.
