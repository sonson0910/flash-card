# Functions source-contract failures

## Outcome

The two failures were brittle source-slicing assertions introduced by the recent review-handler extraction, not missing authorization or service-budget enforcement. The tests now exercise the handler behavior through a narrow dependency seam.

## Evidence and timeline

- `23:18`: Focused Vitest run reproduced exactly two failures. Both assertions searched only the one-line `reviewCard` export and could no longer see logic in `createReviewCardHandler`'s predecessor.
- Commit `5349dbd` extracted the shared legacy/V2 review handler while retaining owner validation before budget consumption and persistence, including `card-review-service`.
- `23:19`: Focused tests passed: 11/11.
- `23:19`: Functions lint and build completed with exit code 0.
- `23:19`: Full Functions suite passed: 271 tests passed, 21 integration tests skipped by their existing environment gates.

## Hypotheses tested

1. Aggregate review budgeting was removed. Eliminated: `functions/src/index.ts` still passed `card-review-service` and its service ceiling to `consumeBudget`.
2. Authorization moved after quota or persistence. Eliminated: the handler checked `expectedOwnerId` before both calls, and the behavioral test proves rejected owners invoke neither dependency.
3. Tests assumed callable logic remained inline in the exported wrapper. Confirmed by both failure slices and commit history.

## Fix and prevention

`createReviewCardHandler` now accepts defaulted production dependencies. Tests inject spies to verify unauthorized requests consume no quota or persistence, authorized review mutations use the aggregate service scope, and budget consumption precedes persistence. This preserves production behavior while making future handler extraction or naming changes irrelevant to these contracts.

Unresolved questions: none.
