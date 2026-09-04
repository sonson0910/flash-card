## Task 5: Restore flashcard compositing mitigation

### TDD evidence

1. RED: the new source contract failed because `.flashcard-panel` and `.zen-glass-slab` were absent from the tablet mitigation selector.
2. GREEN: extending the existing mitigation selector lists made all five tests pass.

### Changed files

- `src/index.css`
- `src/themeTokens.test.ts`
- `.superpowers/sdd/ui-review-fixes/task-5-report.md`

### Verification

- `npx vitest run src/themeTokens.test.ts` — 5 passed.
- `npm run verify:bundle` — passed; 63 JavaScript chunks within budget.
- `git diff --check` — passed.

### Decisions and remaining risk

- Added both flashcard classes to the existing tablet/coarse-pointer, Save Data, unsupported-backdrop, reduced-transparency, and dark fallback selector lists.
- Kept normal and dark desktop declarations unchanged; no browser E2E was added because the source contract covers the selector regression.
- Runtime browser compositing behavior was not independently exercised.

### Follow-up review fix

- Strengthened `src/themeTokens.test.ts` to inspect each light rule's declarations and each dark rule's fallback background; backdrop-capable paths now require both `-webkit-backdrop-filter: none` and `backdrop-filter: none`.
- Mutation check: temporarily changing the tablet vendor-prefixed declaration to `blur(1px)` failed the contract test; the CSS was restored unchanged.
- Follow-up verification: `npx vitest run src/themeTokens.test.ts` — 5 passed; `npm run verify:bundle` — passed; `git diff --check` — passed.

### Follow-up review fix 2

- Replaced the unprefixed `backdrop-filter` substring assertion with a property-boundary regex, so it cannot match inside `-webkit-backdrop-filter`.
- Mutation check: temporarily changing the tablet unprefixed declaration to `blur(1px)` failed the contract test; the CSS was restored unchanged.
- Verification: `npx vitest run src/themeTokens.test.ts` — 5 passed; `npm run verify:bundle` — passed; `git diff --check` — passed.
