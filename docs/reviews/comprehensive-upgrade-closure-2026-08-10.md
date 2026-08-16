# Comprehensive upgrade closure acceptance record

Date: 2026-08-10

Status: locally controllable closure accepted; not a staging or production acceptance

## Decision summary

The current worktree contains a coherent reliability, security, accessibility and
performance hardening batch. Every locally controllable closure task is implemented,
the available broad gates have been rerun, and three independent final reviews have
no unresolved Critical or Required findings. This record deliberately separates
historical baseline evidence, fixture evidence, local execution, CI configuration
and external rollout proof.

No production deploy, catalog publication, migration apply, destructive cleanup,
traffic change, secret rotation or billing change is authorized or claimed here.
The ordered work and definition of done are in the
[closure plan](../plans/comprehensive-upgrade-closure-2026-08-10.md).

## Evidence vocabulary

| Term | Meaning in this record |
| --- | --- |
| Implementation evidence | Source and focused tests exist in the worktree. This is not proof that a broad suite passed. |
| Fixture evidence | A deterministic test payload exercised a contract. It is not licensed/reviewed catalog content. |
| Local proof | The named command actually ran on this host and its result is recorded below. |
| CI gate | A workflow is configured to run the command. Configuration alone is not proof for this revision. |
| Staging proof | The retained revision was probed against an authorized real staging origin. None exists for this record. |
| Production approval | A human-approved deployment/promotion with retained evidence. None exists for this record. |

## Hardening batch represented by the candidate

- deterministic card IDs and full-SHA-256-addressed, transactional, immutable
  identity reservations;
- revision, library-epoch and tombstone preconditions across create, patch, review,
  delete, mirror and offline replay paths;
- duplicate-race convergence, owner-safe device-operation acknowledgement and
  fail-closed preservation of unknown-owner or malformed local backups;
- stale owner/session guards across intake, practice, media and learning state;
- rebased gamification operations rather than stale full-state overwrites;
- bounded catalog scans, cancellable transactions and stale paging protection;
- public unlisted shared decks with private owner metadata and atomic create/revoke;
- bounded callable input/model output and recoverable user-facing failures;
- accessible missing-media behavior, destructive confirmation and status feedback;
- dependency-free charts and truthful loading/debounced catalog search states.
- sealed candidate promotion with materialized Functions runtime dependencies,
  protected KMS-key-version rollback binding, and verified evidence restricted to
  a clean matching Git HEAD.

### Shared-deck trust-boundary update

The current implementation closes direct client access to `shared_decks`: Firestore
Rules deny reads, queries, and writes, while `shared_deck_owners` remains server-only.
The browser loads an unlisted link through the unauthenticated but App Check-enforced
`loadSharedDeck` callable. Trusted Functions reject malformed or expired Admin-written
documents unless the stored top-level schema, Timestamp/TTL values, card-count and
payload bounds, exact public-card projection, bounded string/list values, and allowed
HTTPS media hosts all pass; only canonical `{ category, cards }` data is returned.
Authenticated, App Check-protected create/revoke callables still use atomic Admin
transactions and private ownership metadata. This addendum updates the trust-boundary
description for the current worktree; it records implementation and focused-test
evidence only, does not rewrite the historical gate results, and does not claim
 staging or production validation.

The architecture rationale and current shared-deck trust boundary are recorded
in [ADR-006](../architecture/adr-006-transactional-card-identity-and-private-share-ownership.md).

## Catalog and rollout truth

- `public/catalog/english-core/` contains no release artifact.
- English, Japanese, Korean and Chinese are all registered as `unavailable` in
  [`catalogWorkspaceRegistry.ts`](../../src/features/catalogWorkspace/catalogWorkspaceRegistry.ts).
- Catalog download, offline activation, query and browser journeys use generated
  or in-test fixtures. Those tests prove the runtime contract, not catalog
  availability, licensing, editorial review or publication.
- The Phase 6 smoke transport and canary policy have local deterministic tests.
  They do not prove App Check, Auth, Firestore, AI or image integration in staging.
- No staging origin, canary sample, production traffic or rollback exercise was
  used for this acceptance record.

## Pre-closure baseline captured on 2026-08-10

This table is the reproducible baseline observed before the closure slices were
completed. It is retained rather than silently rewriting history with later runs.

| Command | Observed result |
| --- | --- |
| `npm run lint` | Passed. |
| `npm test -- --run` | 1,037/1,038 passed; the only failure was the `src/App.tsx` analyzer count, 613 against the maximum 600. |
| `npm run build` | Passed. |
| `npm --prefix functions run lint` | Passed. |
| `npm --prefix functions test` | 35/35 passed. |
| `npm --prefix functions run build` | Passed. |
| `npm run verify:release-config` | Passed. |
| `npm run verify:secrets` | Passed. |
| `npm run verify:bundle` | Passed with initial JavaScript 274,082/280,000 bytes gzip and total JavaScript 698,341/700,000 bytes gzip. This is the pre-chart-removal baseline, not the final bundle claim. |
| `npm run verify:audit` | Passed; root and Functions reported zero vulnerabilities. |
| `npm run test:e2e:chromium` | 44/44 passed. |
| `npx playwright test --project=webkit` | 42 passed; two accessibility-policy cases were intentionally skipped for this engine. |
| `npx playwright test --project=firefox` | Blocked before app assertions by the local macOS sandbox/SWGL launch environment; no pass is claimed. |
| `npm run test:rules` | Historically blocked when this host had no Java runtime; superseded by the final retained 41/41 compatible-Java result below. |

## Final local acceptance evidence

All commands below used portable Node 22.23.2 with npm 10.9.8. The downloaded
runtime archive was verified with SHA-256
`61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6`.

| Gate | Final result |
| --- | --- |
| `npm run lint` | Passed; TypeScript reported no errors. |
| `npm test -- --run` | Passed: 163 files and 1,269/1,269 tests. Expected stderr belongs to explicit failure-path tests. |
| `npm --prefix functions run lint` | Passed. |
| `npm --prefix functions test` | Passed: 6 files and 35/35 tests. |
| `npm --prefix functions run build` | Passed. |
| `npm run build` | Passed: Vite transformed 1,930 modules and emitted immutable health metadata. |
| `npm run verify:secrets` | Passed: 60 production files contained no provider secrets or private credential patterns. |
| `npm run verify:bundle` | Passed: 47 chunks; initial JavaScript 277,503/280,000 bytes gzip; total JavaScript 587,874/700,000 bytes gzip. |
| `npm run verify:audit` | Passed: root and Functions both reported zero vulnerabilities. |
| `npm run test:phase6` | Passed: 8 files and 69/69 tests. |
| Firestore Rules emulator | Historical evidence only: 41/41 passed for the August 10 closure, but Rules and tests changed later in `12a8bdb`. Current-revision evidence is recorded in [the August 12 Phase 0 revalidation](phase-0-release-gate-revalidation-2026-08-12.md). |
| `CI=true npx playwright test --project=chromium --project=webkit` | Historical evidence only: 92 passed and two intentional WebKit skips for the August 10 closure. Current cross-browser evidence is recorded in [the August 12 Phase 0 revalidation](phase-0-release-gate-revalidation-2026-08-12.md). |
| Focused ownership/device synchronization | Passed: 107/107, including unknown-owner data, guest `null`, malformed top-level JSON, inferred owners and exact preservation on conflict. |
| Focused release artifact/workflow/evidence | Passed: 35/35 distinct final targeted tests; Functions runtime dependencies, protected KMS binding, artifact sealing and clean-HEAD evidence are covered. |
| Independent review | Runtime, release and combined final reviewers all APPROVE with no Critical or Required findings. |
| `git diff --check` | Passed. |

## Commands executed for closure

The final local acceptance sequence was:

```sh
npm run lint
npm test -- --run
npm --prefix functions run lint
npm --prefix functions test
npm --prefix functions run build
npm run build
npm run verify:secrets
npm run verify:bundle
npm run verify:audit
npm run test:phase6
CI=true npx playwright test --project=chromium --project=webkit
npm run test:rules
npm run verify:release-config
npm run phase6:evidence -- --verified
npx playwright test --project=firefox
git diff --check
```

Two commands intentionally fail closed in this local worktree. `verify:release-config`
requires `.env.production`, the public App Check site key and a full immutable
revision. Verified Phase 6 evidence requires that revision to exactly match a clean
Git HEAD; supplying the actual HEAD while this implementation worktree is dirty was
rejected, and the pre-existing ignored local artifact hash remained unchanged. No
local or schema-1 `"local"` artifact is accepted as current release evidence.

## Current acceptance matrix

| Gate | Current conclusion |
| --- | --- |
| Source, unit and focused behavior | Accepted locally: all final root, Functions, ownership and release suites pass. |
| Architecture boundary | Accepted locally: the analyzer passes and `src/App.tsx` is within the enforced presentation boundary. |
| Security and dependency audit | Accepted locally: secret scan, Rules tests, KMS/release hardening and both dependency audits pass. |
| Accessibility and browser behavior | Accepted for Chromium/WebKit: the serial cross-engine run passed with only two documented engine-policy skips. Firefox remains an external host gate. |
| Bundle headroom | Accepted locally: chart removal recovered more than 112 KiB gzip of total-JavaScript headroom. |
| Catalog content | Runtime fixture proof only; no published release exists. |
| Staging | Not run and not accepted. |
| Production/canary/rollback | Not run and not accepted. |

## Known release blockers and external gates

1. Run Firefox in a compatible Playwright host or CI and retain the result.
2. Supply licensed, provenance-complete, independently reviewed catalog content,
   build a content-derived release, and explicitly register it. Test fixtures must
   never be promoted as content.
3. Obtain separate authorization and credentials for a real staging smoke across
   App Check, Auth, Firestore, AI and image fallbacks.
4. Add and separately authorize the protected
   `.github/workflows/reservation-migration.yml`; it is intentionally absent from
   this local implementation. Configure protected production project/database IDs,
   App Check configuration and `ROLLBACK_KMS_KEY_VERSION` without placing decrypt
   authority or plaintext rollback data in Actions.
5. Configure Firestore TTL on `expiresAt` for both `shared_decks` and
   `shared_deck_owners`. Current shares are capped at 100 cards and expire after
   30 days; TTL cleanup does not replace the Rules expiry check.
6. Before enabling the new reservation Rules, run the authorized dry-run,
   dedupe/canonical-card migration and rollback snapshot described in the rollout
   runbook, verify one card per normalized identity, then backfill full-digest
   reservations. No production migration is authorized or claimed by this record.
7. Retain the clean immutable candidate artifact, authorized staging/canary
   evidence, production approvals, traffic decision and rollback exercise before
   broad rollout.

## Acceptance decision

**Accepted for locally controllable closure only.** The implementation, local
verification and independent-review plan is complete. The worktree is not a clean
immutable release candidate, verified evidence correctly refuses to attest it,
and no staging, canary, production deployment, migration, traffic change or
rollback exercise occurred. The project must not be called staging-verified or
production-ready until every external gate above is satisfied with retained
revision-bound evidence and human approval.
