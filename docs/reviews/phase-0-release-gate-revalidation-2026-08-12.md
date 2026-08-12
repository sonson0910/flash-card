# Phase 0 release-gate revalidation — 2026-08-12

## Decision

The Phase 0 gates pass locally against the exact artifacts identified below.
The repository is ready for an exact-revision Quality workflow, but release
remains blocked until these changes are committed, pushed and the resulting
GitHub Actions run is green. This review does not claim CI success for an
uncommitted working tree.

## Verification target

- Base revision: `9e0b256bb2ecac06c1da6efd27697aedb65da5f9`
- Verification date: `2026-08-12` (`Asia/Ho_Chi_Minh`)
- Node: `22.23.2` on the host and `22.23.1` in the Linux browser container
- Playwright: `1.61.1`
- Rules runtime: Homebrew OpenJDK `21.0.12`
- Linux browser image: `mcr.microsoft.com/playwright:v1.61.1-noble`
  (`sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48`)

| Artifact | SHA-256 |
| --- | --- |
| `firestore.rules` | `eaf6429224901dc1782d0ad1243f4927190b4bdcd081e4425e834eb3208c90b6` |
| `firestore.rules.test.ts` | `773d04d0f989e3abbc5f26edcee40d84abaee06c6ba3e5ce100a1d8e636114f0` |
| `e2e/flashcard-remediation.spec.ts` | `4989faa8e818acc55f0e3e0153ccba89b456d49816cbac2161e22d983b57b697` |
| `e2e/motion-remediation.spec.ts` | `921b93dd4ccfbf414f27cc0ef247f4a4089cc7e05c7a8fbc7e31f18b0f987e4c` |
| `e2e/catalog-workspace.spec.ts` | `dda4a05593a7e944e6ec02aa1c3c41dd419e180a81b36e8939a96adfb62427a3` |

The existing untracked `docs/design/` workspace is outside this verification
target and was not modified.

## Why the previous evidence was superseded

The August 10 closure retained a 41/41 Rules result and stated that Rules did
not change afterward. Commit `12a8bdb` on August 11 subsequently changed both
`firestore.rules` and `firestore.rules.test.ts`, so that statement is historical
rather than current-revision evidence.

The [Quality run on the base revision](https://github.com/sonson0910/flash-card/actions/runs/31568520759)
proved the core and Rules gates but failed because `failOnFlakyTests` detected
two transient animation assertions: a Firefox spatial-flip sample and a WebKit
reward-hover sample. It ended with 135 passed, four policy skips and two flaky
tests. The same local WebKit gate also exposed that macOS WebKit needs
`Alt+Tab` for keyboard focus traversal.

## Remediation

- The spatial-flip test installs a style observer before the interaction and
  records whether a real `rotateY`/`matrix3d` transform occurred before checking
  the crisp settled face.
- The reward-hover test samples the full animation with `requestAnimationFrame`,
  retaining the maximum scale without mutating the DOM on every frame. It still
  proves both the expressive lower bound (`> 1.02`) and restrained upper bound
  (`<= 1.07`).
- The Catalog keyboard test uses WebKit's `Alt+Tab` traversal, matching the
  existing cross-browser skip-link convention.

No production runtime behavior was changed.

## Fresh evidence

| Gate | Result |
| --- | --- |
| `npm run lint` | Passed. |
| `npm run verify:core` | Passed on the finalized test changes, including root tests, Functions lint/tests/build and Rules. Expected stderr came from explicit failure-path tests. |
| `npm run build` | Passed: 1,936 modules transformed and immutable health metadata emitted. |
| `npm run verify:secrets` | Passed: 60 production files scanned. |
| `npm run verify:bundle` | Passed: 47 JavaScript chunks; 277,225 bytes initial and 596,650 bytes total JavaScript gzip. |
| `npm run verify:audit` | Passed: zero root or Functions vulnerabilities at the configured high-severity gate. |
| `npm run test:rules` with `JAVA_HOME` set to OpenJDK 21 | Passed: 47/47. |
| Focused cross-browser repetitions | Passed: 18/18 Chromium + WebKit and 9/9 Firefox, with no retry. |
| `CI=true npx playwright test --project=chromium --project=webkit` | Passed: 92 passed, two intentional accessibility-policy skips, no flaky tests or retries. |
| `CI=true playwright test --project=firefox` in the pinned Linux image | Passed: 45 passed, two intentional accessibility-policy skips, no flaky tests or retries. |
| `git diff --check` | Passed after this evidence document was finalized. |

The host macOS Firefox binary still cannot launch because its sandbox extension
and SWGL compositor are rejected by the local OS. Firefox was therefore run in
the pinned Linux Playwright image, matching the engine and Node major used by
the Quality workflow without weakening or skipping the Firefox project.

## Remaining external gate

After this change is committed and pushed, the Quality workflow must pass on
the resulting commit SHA. Its retained `phase6-readiness.json`, browser report
and test artifacts become the authoritative release evidence. Until that run is
green, the release state is **ready for CI**, not **release accepted**.
