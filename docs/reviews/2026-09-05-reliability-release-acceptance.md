# SonFlash reliability release acceptance — 2026-09-05

## Scope and binding

This record is bound to the code candidate at full revision
`6671b4eda2d32d156575b67a87667d81b96508c3`.

The commit that records this document is later documentation metadata. It does
not change the runtime revision and must not be treated as retroactive evidence
for any other SHA. No production deployment was performed.

## Verdict

- **Local code-candidate verification: PASS.** The candidate is ready for
  independent review and CI sealing.
- **Release/promotion: NOT ACCEPTED.** External human gates and T09
  publication evidence remain required before staging, canary, or production
  promotion.

## Verification boundary

The initial exact command
`RELEASE_REVISION="$(git rev-parse HEAD)" npm run verify` exited 1 because the
default PATH resolved `/usr/bin/java`, which had no usable runtime. It must not
be reported as a globally passing verification run. Before that stop, the
extension check passed; app lint/unit passed with 222 files and 2,005 tests;
and Functions lint/unit passed with 19 files and 242 tests. Two Firestore
integration files containing 19 tests were skipped outside the emulator.

With the existing JDK at
`/opt/homebrew/opt/openjdk@21/bin`, `npm run test:rules` passed: Firestore
Rules 61/61 and Functions Firestore integration 19/19.

## Candidate gates

All results below are evidence for the candidate SHA in the binding section.

| Gate | Result | Evidence |
| --- | --- | --- |
| Build and Listen pilot | PASS | Build transformed 1,994 modules and produced health metadata and the service worker; the Listen pilot gate verified the unpublished pilot envelope. |
| Secrets scan | PASS | 103 files scanned; no forbidden patterns; `.env.local` absent. |
| Bundle budget | PASS | 70 chunks; initial JavaScript 65,800 B gzip; CSS 28,211 B gzip; total JavaScript 884,130 B gzip. |
| Dependency audit | PASS | No high or critical findings in the root or Functions dependency trees. |
| Phase 6 evidence | PASS | Revision matches; `localVerification=true` and `releaseEligible=true`; staging, canary, and production remain blocked by a human gate. |
| Diff and tracked state | PASS | `git diff --check` passed and tracked status was clean at the candidate verification point. |

## Browser verification

### Local macOS diagnosis

The local macOS 27 runner completed Chromium. In WebKit, one full run hit a
`page.goto` timeout after approximately 65 navigations, while an isolated
repeat passed 3/3. Firefox 153/r1538 stalled at `firefox.launch()` during a
minimal smoke, before the app was reached. These are host-runner diagnoses, not
product pass/fail results. Related upstream reports are [Playwright issue
#42082](https://github.com/microsoft/playwright/issues/42082) and [Playwright
issue #42385](https://github.com/microsoft/playwright/issues/42385).

### Authoritative Linux run

The authoritative browser evidence used an ephemeral, archive-only Linux image
`sonflash-playwright:1.62.1-node22`, image ID
`sha256:010331c20f69488cdd0910649a66ddb6a7bcf584377778083a2da88a1b32224a`.
The image contained Node 22.23.2, npm 10.9.8, and Playwright 1.62.1. The run
used strict `set -euo pipefail`; `npm ci` installed 836 packages with exit 0;
the build exited 0; and `CI=true` across all projects exited 0 in 8.5 minutes.

| Project | Result |
| --- | ---: |
| Chromium | 64 passed, 1 expected skip |
| Firefox | 58 passed, 7 expected skips |
| WebKit | 58 passed, 7 expected skips |
| **Total** | **180 passed, 15 expected skips; 0 failed, flaky, or retried** |

The container was removed after the run; the local image was retained.

## Limitations and release blockers

- The T12 published-audio happy path remains skipped/deferred because
  production `LISTEN_MVP_PILOT_LESSONS` is intentionally empty pending
  external publication evidence.
- No staging HTTPS, canary, or production environment was exercised. No sealed
  workflow run or artifact digest, promotion, or rollback drill occurred.
- No private candidate media or secret values are included in this record.
- No production deployment occurred.

Local candidate verification is therefore complete and suitable for
independent review and CI sealing, but release and promotion are not accepted
until the external human gates and T09 publication evidence are satisfied.
