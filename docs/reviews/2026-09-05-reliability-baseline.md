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
| `npm run test:rules` | PASS with Homebrew OpenJDK 21 | 16.19s real | Firestore emulator compatibility smoke: 2 rules files passed, 61 tests; 2 Functions integration files passed, 19 tests. The first plain invocation stopped before emulator startup because the macOS `/usr/bin/java` shim could not locate a runtime; rerun with `PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH`. |
| `npm run build` | PASS | 4.53s real | Vite transformed 1,990 modules and wrote `dist/health.json`. Existing dynamic-import/static-import warning for `reviewScheduler.ts` was emitted. |
| `npm run verify:bundle` | PASS | 0.69s real | 70 JavaScript chunks; the pre-review scanner undercounted media outside `dist/assets`, and the corrected measurement is recorded in T03 below. |

The command durations are `/usr/bin/time -p` wall-clock `real` values. The table records successful invocations; the initial default-environment Java setup failure is called out in the smoke row.

## T01 catalog CLI smoke

The targeted command was run independently from the full suite:

```sh
npm test -- --run scripts/catalog-operator.test.ts
```

It passed 14/14 tests in 4.80s real (Vitest 4.25s), including the finite-timeout child-process case. The catalog CLI helper applies a 15-second child deadline; the synthetic hung-child assertion uses a 25ms deadline. The deterministic child-process case was also measured independently:

```sh
npm test -- --run scripts/catalog-operator.test.ts -t \
  'builds deterministically and verifies every artifact without writes'
```

It passed 1 test with 13 skipped in 1.90s real; the test body/child process took 995ms. The bounded execution and artifact assertions are healthy at this revision.

## T02 dependency audit and decision

Before the lock change, `npm audit --json` reported 9 moderate vulnerabilities, all in the root development tree:

- `qs` 6.15.3, reached through `body-parser`/`express`;
- `@opentelemetry/core`, `@google-cloud/pubsub`, `gaxios`, `stream-json`, and `uuid`, reached through `firebase-tools@15.29.0`.

The root production audit (`npm audit --omit=dev --json`) and Functions audit (`npm --prefix functions audit --json`) both reported zero vulnerabilities. `npm explain qs` showed the shared `qs@6.15.3` node was selected by the Firebase CLI's Express/body-parser graph.

The official [qs advisory GHSA-x5fp-wj9c-mxmx](https://github.com/ljharb/qs/security/advisories/GHSA-x5fp-wj9c-mxmx) lists versions `>=6.14.2, <=6.15.3` as affected and `6.16.0` as patched. The smallest remediation is therefore the root override below; it does not change the Firebase CLI version or the Functions lockfile:

```json
"overrides": {
  "qs": "6.16.0"
}
```

`package-lock.json` now resolves the shared `qs` node to `6.16.0`. This is outside the `~6.15.1` range requested by `body-parser@1.20.6` and `express@4.22.2`, so the override is intentionally limited to the root development tree and its compatibility risk remains explicit. After installing the lockfile, `npm explain qs` reports `qs@6.16.0 dev overridden`; the dependency tree remains on `firebase-tools@15.29.0`.

Post-change evidence:

| Command | Result | Evidence |
| --- | --- | --- |
| `npm audit --json` | 6 moderate remain | Only the Firebase CLI development subtree; `qs` is no longer in the audit's vulnerable range. npm offers only the breaking `firebase-tools@10.1.1` downgrade for the remaining paths. |
| `npm audit --omit=dev --json` | PASS | 0 vulnerabilities. |
| `npm --prefix functions audit --json` | PASS | 0 vulnerabilities. |
| `npm run verify:audit` | PASS | Root and Functions have no high or critical vulnerabilities. Duration 1.52s real. |
| `npm run lint` | PASS | Duration 7.10s real. |
| `npm run build` | PASS | Duration 4.25s real; same existing dynamic-import warning. |

Representative request-parser smoke:

- `timeout 15s node --input-type=commonjs - <<'NODE'` started a local Express server resolved from the installed `firebase-tools@15.29.0` graph, attached `body-parser.urlencoded({ extended: true, parameterLimit: 3 })`, and posted an over-limit form. It passed with HTTP 413, resolving `express@4.22.2`, `body-parser@1.20.6`, and overridden `qs@6.16.0` (the expected parser rejection also logs the existing `PayloadTooLargeError` stack to stderr).
- `env PATH=/opt/homebrew/opt/openjdk@21/bin:$PATH npm run test:rules` passed with Rules 61/61 and Functions integration 19/19, exit 0. The default Java shim could not locate a runtime, so the explicit Homebrew JDK path is part of the command.
- A pinned Hosting emulator attempt started on a temporary port but `GET /` returned 404; it is not counted as parser evidence. The direct dependency-graph smoke above is the bounded fallback, with no deployment or publish.

The remaining Firebase CLI findings are documented rather than hidden by a broad major downgrade/upgrade. Recheck them when a compatible Firebase CLI release supplies patched transitive versions. No production/runtime advisory remains.

## T03 bundle measurement

The first M0 measurement exposed a coverage defect: the scanner only inspected direct children of `dist/assets` for images/videos. Its reported total of 19,186,502 B was therefore an undercount and is not an acceptance baseline. A focused regression test now covers root, nested image, video, and audio files, and the scanner walks the complete `dist` artifact recursively.

The corrected pre-cleanup build measured 21,135,650 B raw media and correctly failed the existing 20,000,000 B budget:

| Metric | Corrected pre-cleanup actual | Budget |
| --- | ---: | ---: |
| Total media raw | 21,135,650 B | 20,000,000 B |
| Images / video / audio | 2,164,145 B / 16,772,254 B / 2,199,251 B | — |

The excess was traced to three documentation-only brand files copied from `public/brand/`: `sonflash-logo-source.png`, `sonflash-logo.png`, and `sonflash-readme-hero.webp`. They were moved to `docs/assets/`, and README, brand specification, and asset tests were updated; runtime/public assets and accessibility references remain unchanged. The resulting build is:

| Metric | Actual | Budget | Headroom |
| --- | ---: | ---: | ---: |
| Initial JavaScript raw | 207,168 B | 224,000 B | 16,832 B |
| Initial JavaScript gzip | 65,803 B | 71,000 B | 5,197 B |
| Initial CSS raw | 198,147 B | 206,000 B | 7,853 B |
| Initial CSS gzip | 28,162 B | 29,500 B | 1,338 B |
| Total JavaScript raw | 2,759,607 B | 2,760,000 B | 393 B |
| Total JavaScript gzip | 875,057 B | 880,000 B | 4,943 B |
| Total media raw | 19,578,775 B | 20,000,000 B | 421,225 B |

The 70 JavaScript chunks remain within the 650,000 B raw / 180,000 B gzip per-chunk budgets; the largest is `assets/xlsx-DknvlXm4.js` at 499,865 B raw / 161,339 B gzip. Corrected media is 607,270 B images, 16,772,254 B video, and 2,199,251 B audio. The cleanup removed 1,556,875 B from the built runtime artifact without raising the budget or deleting documentation assets.

The plan's earlier measurement recorded 2,759,941 B raw / 875,237 B gzip total JavaScript at `2c03315d`; this fresh run is 334 B raw and 180 B gzip lower. The current scanner already measures initial assets, all JavaScript chunks, CSS, recursively discovered media, and aggregate/per-chunk limits. No evidence-backed cleanup is worth changing product code, and budgets were not raised. Top-level service-worker accounting is intentionally deferred to T04, where the worker is introduced.

## Verification notes

- TDD RED/GREEN evidence for the review fixes:
  - Bundle scanner RED: `npm test -- --run scripts/bundle-budget.test.mjs -t 'discovers supported media recursively across the complete dist artifact'` failed because root/nested media was not discovered. GREEN: the same command passed 1/1 after recursive discovery.
  - Catalog timeout RED: `npm test -- --run scripts/catalog-operator.test.ts -t 'terminates a hung CLI child at a finite timeout'` initially failed with `ReferenceError: runCatalogCli is not defined`. GREEN: the same command passed 1/1 after adding the shared 15,000 ms timeout helper.
- The plain `npm run test:rules` invocation initially stopped before emulator startup because the macOS Java shim could not locate a runtime; with Homebrew OpenJDK 21 on `PATH`, the Firestore rules and Functions integration smoke passed as recorded above. No schema migration, deploy, publish, or production verification was performed.
- This checkpoint does not establish app-shell offline behavior, real network loss, browser cold reopen, staging headers, or release rollback.
- The existing test stderr/warning output above is not a newly introduced failure, but should remain visible in later release review.
