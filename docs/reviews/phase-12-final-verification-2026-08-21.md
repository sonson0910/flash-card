# Phase 12 final verification and acceptance record

Date: 2026-08-21 (ICT)

Status: **not accepted for release**. Local product gates are green, but this is
not an exact-revision acceptance: the working tree is dirty, Firefox cannot
launch in this macOS host, no clean commit has been pushed, and no CI run exists
for the resulting revision. No deployment or publication was performed.

## Snapshot and environment

- Git base revision: `c494d39421386d70ea8aec675323860b1dadf2a6`
- Branch: `codex/stable-extension-selector`
- Working tree: 142 modified or untracked entries at the re-review closure.
  Therefore
  the source verified below is **not** represented exactly by the Git SHA.
- Host: macOS 27.0 (26A5416b), Node 22.23.2, npm 10.9.8, Playwright 1.61.1.
- Rules wrapper resolved Homebrew OpenJDK 21.0.12 from its explicit Java-home
  candidates; the usable OpenJDK binary is not on the interactive `PATH`.

## Observed local evidence

| Gate | Observed result |
| --- | --- |
| `npm run extension:check` | Passed; package/release checks passed, including the terminal-claim regression |
| `npm run verify:core` | Root: 191 files, 1,587 tests passed; Functions: 75 passed, 2 integration tests skipped; Functions build passed |
| `npm run test:rules` | Rules: 48/48 passed; Firestore integration: 2/2 passed |
| `npm run build` | Passed |
| `npm run verify:secrets` | Passed; 86 production files scanned |
| `npm run verify:bundle` | Passed; initial JS 203,446 B raw / 64,529 B gzip; initial CSS 54,782 B raw / 10,005 B gzip |
| `npm run verify:audit` | Root and Functions: 0 vulnerabilities |
| Architecture analyzer | 19/19 passed; production graph acyclic and no forbidden feature-to-app dependency |
| Chromium E2E | 61/61 passed |
| WebKit E2E | 53 passed; 8 Chromium-only tests skipped |
| `git diff --check` | Passed |

The initial JavaScript bundle is 64,529 B gzip, leaving about 75.3% headroom
against the unchanged 261,000 B Phase-11 target (and 290,000 B enforced
budget).

`npm run verify` was started, but cannot be recorded as passed: its Firefox
browser stage cannot launch in this host. Its preceding local stages were
re-run individually and are listed above. The command was stopped before it
could generate or overwrite a release/readiness artifact.

## Browser and security review

- Chromium and WebKit reached application assertions and passed every test.
  WebKit initially exposed that Safari-style keyboard navigation needs
  `Option+Tab` to advance across buttons when full keyboard access is not
  enabled. The RTL regression now uses that browser-equivalent gesture while
  preserving the same focus-order assertion; its focused WebKit test passed
  3/3 before the full 61/61 run.
- Firefox launch probe fails before an application assertion with macOS
  `plugin-container.app: Operation not permitted` and a SwiftShader framebuffer
  mapping error. This is host-sandbox evidence, not a product pass or fail.
- The workflow-dispatch values used by deploy verification commands now pass
  through quoted environment variables rather than GitHub expression
  interpolation in `run:`. The regression workflow contract passes 6/6.
- A supplemental Semgrep scan no longer reports deploy workflow shell-input,
  extension-parser dynamic-regex, or runtime log-format findings. Its remaining
  five findings are three test-only helpers and two bounded dynamic regexes
  whose interpolated card text is escaped by local `escapeRegExp()` functions;
  they were reviewed as non-exploitable false positives, not P1/P2 findings.
- Landing truth test passed 6/6: unsupported catalog, Oxford, illustration,
  pronunciation-accuracy and synthetic-provenance claims are absent. ADRs
  002–006 were rechecked against the current seams; no new contradiction was
  found.

## Acceptance blockers and required next action

1. Freeze the current changes into a reviewed clean commit and push it. This
   requires explicit authorization because it mutates repository and remote
   state.
2. Run the Quality workflow for that exact SHA. It provisions Java 21 and all
   three Playwright browsers on Linux, which is the authoritative Firefox
   evidence. Record its run URL, SHA and retained artifacts here.

The five orphan candidates were resolved after this initial record: four unused
`src/` modules were deleted; the Vite-dev-only merge helper moved to `dev/`,
where its adapter owns it. The analyzer now reports no production orphan.

Until both external actions are complete, this document is a truthful local
verification record, not a release acceptance. No deploy, Firestore Rules
promotion, migration, catalog publication, commit, push or CI dispatch was
performed while creating it.
