# Canvas behavior map — partition 2

## Coverage

Mapped all 25 assigned boards in [board-behavior-map-2.json](../260925-1005-claude-design-workflow-recovery/evidence/board-behavior-map-2.json). Each row records the source and paired inventory evidence, current/proposed product entry, props and state variants, actions with exact phase task IDs, ready and empty fixture needs, and per-board policy exceptions.

The map distinguishes existing app routes (`/`, Today, library, catalog, progress and practice modes) from proposed Canvas states/dialogs and calls out separate sibling boards such as `LandingSales`, `RecapNext` and `TodaySession` rather than treating them as variants of the assigned component. It preserves all assigned states; sample metrics, prices, rewards and progress are identified as test-only where the source presents them.

## Validation

- Read the assigned Canvas source files and applicable inventory declarations, including both seed files.
- Checked current route ownership in `src/App.tsx`, `src/app/AppViewStage.tsx`, `src/app/useAppLearningCoordination.ts` and `src/features/navigation/useAppNavigation.ts`.
- Parsed the JSON and confirmed 25 unique boards, all required row fields, and a `phase_task` on every action.
- No source files, global checks, builds, extraction, deployment or commits were changed/run.

Status: DONE
Summary: The 25 assigned boards and paired variants are mapped with route/action destinations, fixture needs and policy discrepancies.
Concerns/Blockers: None. Several Canvas interaction states are intentionally recorded as required behavior because the source markup is static or has inert controls.
