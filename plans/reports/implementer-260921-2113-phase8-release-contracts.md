# Phase 8 release contracts

Status: DONE_WITH_CONCERNS

## Changed files

- `playwright.config.ts`: disables server reuse and requires Vite strict-port binding, so a process already listening on 4173 fails rather than becoming E2E evidence or causing a port hop.
- `scripts/generate-build-metadata.mjs`, `e2e/app.spec.ts`, `scripts/release-artifact.test.mjs`: emit and verify a deterministic SHA-256 build-content artifact ID; the release test proves distinct dirty local outputs retain distinct identities despite revision `local`.
- `deployGateSource.test.ts`: computes CSP hashes from executable inline source and requires the exact valid `script-src` hash set without unsafe script allowances, stale, duplicate, or malformed hash tokens.
- `package.json`, `package-lock.json`, and the three protected Firebase workflows: pin and verify `firebase-tools` 15.29.0, use the local CLI for rules tests, and resolve `js-yaml` 4.3.2.
- `scripts/release-workflows.test.mjs`: scans tracked package/config/script/workflow surfaces for Firebase version drift and checks the fixed `js-yaml` resolution.

## Validation

- PASS: `node --test scripts/release-artifact.test.mjs scripts/release-workflows.test.mjs` (31 tests); the stale HTTP-200/occupied-port regression also passed three consecutive isolated runs and left port 4173 free.
- PASS: `npx vitest run deployGateSource.test.ts` (5 tests).
- PASS: `npm run build` (including generated `dist/health.json`).
- PASS: `npm audit --audit-level=high` (no high/critical findings; moderate findings remain).
- PASS: `npx playwright test e2e/app.spec.ts --project=chromium --grep 'release health identifies'` (1 test).
- PASS: `git diff --check`.
- PASS: `npm run lint`.
- INCOMPLETE: two full `e2e/app.spec.ts` Chromium attempts were stopped by the execution harness after about 30 seconds without a final result. No 4173 server process remained afterward.

## Decisions and risk

- Removed unsafe local server reuse rather than retaining an opt-in branch requiring a separate readiness validator. This makes stale/unrelated 200 responses fail closed.
- The identity digest excludes `health.json` itself and hashes sorted output paths, sizes, and bytes, avoiding timestamp-based identity.
- Root audit remains non-clean at moderate severity; the required high/critical gate passes. Full Chromium app-spec remains unverified because of the external 30-second execution cutoff.
