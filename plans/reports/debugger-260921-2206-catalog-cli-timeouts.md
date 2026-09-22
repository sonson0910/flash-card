# Catalog CLI timeout diagnosis

## Outcome

The three failures were test-budget failures under full-suite contention, not functional hangs. The real CLI subprocesses completed successfully but took 3.8–4.7 seconds in the initial focused run, leaving too little margin under Vitest's default 5-second timeout.

## Evidence and eliminated hypotheses

- Functional hang: eliminated. The affected subprocesses returned correct status and JSON output in repeated focused runs.
- Catalog validation defect: eliminated. The same catalog inputs passed direct and subprocess validation, and all catalog assertions remained unchanged.
- Full-suite resource contention: confirmed. The slow tests launch independent Vite/TypeScript processes, and their focused durations were already close to the default timeout.

## Fix

Each CLI subprocess now has a 25-second hard timeout, while its Vitest integration test has a 30-second budget. This matches the catalog gate's existing 30-second slow-CI allowance and ensures a real subprocess hang still terminates and fails rather than being hidden.

## Verification

- Focused catalog tests: 13/13 passed in three consecutive runs.
- Scripts suite: 95/95 passed.
- Full root Vitest suite: 1703/1703 passed.
- TypeScript lint and `git diff --check`: passed.

## Unresolved questions

None.
