# SonFlash reliability baseline — 2026-09-05

## Scope and revision

- Worktree: `sonflash-reliability`, branch `feat/sonflash-reliability`.
- Baseline revision: `2c03315d42574de382f07e6861d7012df6ba7309`.
- `git status --short --branch` at baseline: clean (`## feat/sonflash-reliability`).
- Runtime: Node `v22.23.2`; npm `10.9.8`; package manager declaration `npm@10.9.8`.
- Lockfile: root `package-lock.json`, lockfile version 3.
- Baseline commands were run sequentially. The baseline report is evidence for M0 only; it is not release verification.

## Baseline checks

| Command | Result | Duration | Evidence / limitations |
| --- | --- | ---: | --- |
| `npm run lint` | PASS | 8.38s real | Root TypeScript check. |
| `npm test -- --run` | PASS | 16.03s real; Vitest 15.45s | 211 files passed; 1,890 tests passed. Expected stderr from simulated recovery/error paths and one React `act(...)` warning are emitted by existing tests. |
| `npm --prefix functions run lint` | PASS | 1.29s real | Functions TypeScript check. |
| `npm --prefix functions test` | PASS | 3.75s real; Vitest 2.77s | 19 files passed, 2 skipped; 242 tests passed, 19 skipped. Skips are the existing Firestore integration tests. |
| `npm run build` | PASS | 4.53s real | Vite transformed 1,990 modules and wrote `dist/health.json`. Existing dynamic-import/static-import warning for `reviewScheduler.ts` was emitted. |
| `npm run verify:bundle` | PASS | 0.69s real | 70 JavaScript chunks; metrics below. |

The command durations are `/usr/bin/time -p` wall-clock `real` values. A timeout or non-zero command would be recorded as a failure; none occurred in this baseline.

## T01 catalog CLI smoke

The targeted command was run independently from the full suite:

```sh
npm test -- --run scripts/catalog-operator.test.ts
```

It passed 13/13 tests in 5.11s real (Vitest 4.54s). The deterministic child-process case was also measured independently:

```sh
npm test -- --run scripts/catalog-operator.test.ts -t \
  'builds deterministically and verifies every artifact without writes'
```

It passed 1 test with 12 skipped in 2.07s real; the test body/child process took 1.078s. The bounded execution and artifact assertions are healthy at this revision, so T01 made no source change and did not add a retry or deadline.

## T02 dependency audit and decision

Before the lock change, `npm audit --json` reported 9 moderate vulnerabilities, all in the root development tree:

- `qs` 6.15.3, reached through `body-parser`/`express`;
- `@opentelemetry/core`, `@google-cloud/pubsub`, `gaxios`, `stream-json`, and `uuid`, reached through `firebase-tools@15.29.0`.

The root production audit (`npm audit --omit=dev --json`) and Functions audit (`npm --prefix functions audit --json`) both reported zero vulnerabilities. `npm explain qs` showed the shared `qs@6.15.3` node was selected by the Firebase CLI's Express/body-parser graph.

The official [qs advisory GHSA-x5fp-wj9c-mxmx](https://github.com/ljharb/qs/security/advisories/GHSA-x5fp-wj9c-mxmx) lists versions `>=6.14.2, <=6.15.3` as affected and `6.16.0` as patched. The smallest compatible remediation is therefore the root override below; it does not change the Firebase CLI version or the Functions lockfile:

```json
"overrides": {
  "qs": "6.16.0"
}
```

`package-lock.json` now resolves the shared `qs` node to `6.16.0`. After installing the lockfile, `npm explain qs` reports `qs@6.16.0 dev overridden`; the dependency tree remains on `firebase-tools@15.29.0`.

Post-change evidence:

| Command | Result | Evidence |
| --- | --- | --- |
| `npm audit --json` | 6 moderate remain | Only the Firebase CLI development subtree; npm offers only the breaking `firebase-tools@10.1.1` downgrade for those paths. |
| `npm audit --omit=dev --json` | PASS | 0 vulnerabilities. |
| `npm --prefix functions audit --json` | PASS | 0 vulnerabilities. |
| `npm run verify:audit` | PASS | Root and Functions have no high or critical vulnerabilities. Duration 1.52s real. |
| `npm run lint` | PASS | Duration 7.10s real. |
| `npm run build` | PASS | Duration 4.25s real; same existing dynamic-import warning. |

The remaining Firebase CLI findings are documented rather than hidden by a broad major downgrade/upgrade. Recheck them when a compatible Firebase CLI release supplies patched transitive versions. No production/runtime advisory remains.

## T03 bundle measurement

Fresh build metrics at the baseline revision (after the dependency-only lock update; the application artifact is unchanged) are:

| Metric | Actual | Budget | Headroom |
| --- | ---: | ---: | ---: |
| Initial JavaScript raw | 207,168 B | 224,000 B | 16,832 B |
| Initial JavaScript gzip | 65,803 B | 71,000 B | 5,197 B |
| Initial CSS raw | 198,147 B | 206,000 B | 7,853 B |
| Initial CSS gzip | 28,162 B | 29,500 B | 1,338 B |
| Total JavaScript raw | 2,759,607 B | 2,760,000 B | 393 B |
| Total JavaScript gzip | 875,057 B | 880,000 B | 4,943 B |
| Total media raw | 19,186,502 B | 20,000,000 B | 813,498 B |

The 70 JavaScript chunks remain within the 650,000 B raw / 180,000 B gzip per-chunk budgets; the largest is `assets/xlsx-DknvlXm4.js` at 499,865 B raw / 161,339 B gzip. Media is 214,997 B images, 16,772,254 B video, and 2,199,251 B audio.

The plan's earlier measurement recorded 2,759,941 B raw / 875,237 B gzip total JavaScript at `2c03315d`; this fresh run is 334 B raw and 180 B gzip lower. The current scanner already measures initial assets, all JavaScript chunks, CSS, recursively discovered media, and aggregate/per-chunk limits. No evidence-backed cleanup is worth changing product code, and budgets were not raised. Top-level service-worker accounting is intentionally deferred to T04, where the worker is introduced.

## Verification notes

- T00–T03 contain no behavior change requiring a RED/GREEN cycle; TDD RED/GREEN commands are therefore not applicable.
- No Rules/schema, Functions lockfile, deploy, publish, or production verification was performed.
- This checkpoint does not establish app-shell offline behavior, real network loss, browser cold reopen, staging headers, or release rollback.
- The existing test stderr/warning output above is not a newly introduced failure, but should remain visible in later release review.
