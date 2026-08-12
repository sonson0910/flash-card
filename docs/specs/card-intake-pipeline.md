# Spec: Session-safe Card Intake Pipeline

## Objective

Deepen Card Intake into one session-safe pipeline that owns exact duplicate
lookup, generated-card assembly, optimistic local publication, authoritative
cloud settlement, duplicate compensation and deferred media application.
`useCardIntakePort` should retain only React lifetime wiring while the existing
controller continues to own user-facing draft/import/share workflow state.

This is a behavior-preserving refactor. Generated words, spreadsheet rows and
shared-deck entries must continue through the same normalization, deduplication
and persistence rules without changing storage schemas or visible UX.

## Tech stack

- React 19 and TypeScript
- Firebase Firestore and callable generation services
- IndexedDB mirror and Shared Device Store adapters
- Vitest contract, controller and integration tests

## Commands

```bash
npx vitest run src/features/intake/cardIntakePipeline.test.ts
npx vitest run src/features/intake/useCardIntakePort.test.ts src/features/intake/cardIntakeController.test.ts src/features/intake/useCardIntake.test.ts src/features/intake/useIntakeSharingSession.test.tsx src/features/importExport/spreadsheetImportService.test.ts
npm run lint
JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home" npm run verify:core
npm run build
git diff --check
```

## Project structure

- `src/features/intake/cardIntakePipeline.ts` — session guard, lookup,
  generation, optimistic publication and settlement orchestration.
- `src/features/intake/cardIntakePipeline.test.ts` — contract tests through the
  pipeline interface with adapter boundaries mocked.
- `src/features/intake/useCardIntakePort.ts` — React ref/lifetime adapter only.
- `src/features/intake/cardIntakeController.ts` — draft, import, share and busy
  state machine; unchanged ownership.
- `src/features/intake/cardIntakePortContract.ts` — vendor-free application
  context consumed by the pipeline.

## Code style

Callers express intake intents through one stable session pipeline:

```typescript
const pipeline = createCardIntakePipeline({
  getContext: () => latestContext,
});

pipeline.replaceOwner(latestContext.ownerId);
await pipeline.persistCards(cards, 'shared');
```

Storage ordering, epoch checks, concurrency bounds and late-session publication
guards remain internal to the pipeline.

## Testing strategy

- Start with failing pipeline contracts before moving implementation.
- Preserve helper-level owner/epoch/revision and duplicate-settlement coverage.
- Keep controller tests for generation, shared adoption and spreadsheet flows.
- Keep React composition tests for stable port identity and owner replacement.
- Run the full core suite and production build after all slices.

## Boundaries

- Always: queue before optimistic publication completes; reconcile durable local
  stores before acknowledging; keep cloud settlement bounded to concurrency 6;
  invalidate A operations across A→B and A→B→A transitions; treat media as best
  effort after durable card creation.
- Ask first: schema changes, production migration, Rules changes, dependencies,
  catalog publication or production operations.
- Never: expose one owner's cards to another session, drop a queued operation on
  failed cleanup, award duplicate XP permanently, or block card creation on
  optional media settlement.

## Success criteria

1. React hook code does not coordinate lookup, generation, storage or cloud
   settlement protocol.
2. Exact lookup keeps active cards authoritative and scopes cache, mirror and
   cloud reads to the current owner and verified epoch.
3. Optimistic cards publish before background cloud settlement while durable
   reconciliation still precedes acknowledgement.
4. A late A operation cannot publish after A→B or A→B→A, but safe durable
   settlement may still finish for A.
5. Duplicate convergence compensates XP/stats/facets at most once.
6. Existing intake, import, sharing, sync and full core tests remain green.
7. No persisted schema, Rules, dependency or user-visible behavior changes.

## Open questions

None for this behavior-preserving phase.
