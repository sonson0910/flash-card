# Canvas behavior map — partition 5

Status: DONE

## Scope and result

Mapped all 24 assigned components from `board-assignment-5.json`: 22 Canvas source components and 2 seed components. The map records each board’s product entry, declared theme/state/prop variants, actions and destinations, ready/empty fixture needs, per-region policy exceptions, required phase task IDs, and source evidence in [board-behavior-map-5.json](../260925-1005-claude-design-workflow-recovery/evidence/board-behavior-map-5.json).

Checked paired artboards from `artboard-inventory.csv`, including multi-state Checkout, LangPractice, LangExt and LangOnboarding boards, dark/light pairs, the MobileReview aggregate, and the four-state dark card comparison. AnimeLanding retains the paired AnimeLandingSales references and its required merge into the canonical landing flow.

## Runtime route evidence

Existing app entries used to distinguish current routes from Canvas-required routes:

- Landing Start opens Today; Curriculum opens Catalog; Vocabulary opens Library; pricing currently discloses pilot/no-purchase: `src/App.tsx:L42-L54`, `src/features/landing/LandingPage.tsx:L188-L197,L345-L370,L603-L629`.
- Routed app views are landing, Today, catalog, library, progress, and settings. Practice modes are internal views; Today owns lesson URL state: `src/features/navigation/useAppNavigation.ts:L11-L22`, `src/app/AppViewStage.tsx:L57-L74`.
- Library Create Card and import actions already exist; Canvas modal behavior and complete workflows remain explicit phase04 tasks: `src/features/library/LibraryOverview.tsx:L15-L20`, `src/features/library/LibraryScreen.tsx:L138-L150,L243-L246`.
- Browser extension imports currently hand off to Library. Context menu, in-page surface, course mismatch and web-word actions remain explicit phase07 tasks: `src/app/AppRuntime.tsx:L151-L165`.

## Policy and fixture notes

Sample prices, discounts, trial terms, referral rewards, XP/streaks, and progress are individually flagged as policy exceptions in the JSON. Each board has both a ready fixture requirement and a distinct empty/unavailable requirement; sample Canvas content is reserved for deterministic test fixtures. Missing or unwired actions remain assigned to phase tasks rather than excluding their boards.

## Validation

Parsed the generated JSON with Python’s standard JSON parser. No source edits, application tests, build, extraction, deploy, or commit were performed, as scoped.
