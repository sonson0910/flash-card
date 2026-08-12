# Implementation Plan: Phase 3 Composition Root Shrink

Date: 2026-08-12

## Overview

Implement the original Phase 3 plan by extracting app-level owner/library and
Learning/Intake/Practice coordination from `App.tsx`. Work proceeds in two
contract-first slices so each checkpoint remains type-safe and testable.

## Architecture decisions

- App retains overlay/navigation hooks, shell refs, lazy shell presentation and
  `AppViewStage` composition.
- Library runtime and learning coordination are separate hooks with explicit
  model/action/port groupings and independent size caps.
- A stable Practice Snapshot bridge breaks the existing owner-library/practice
  initialization cycle without changing publication ordering.
- `appDependencies` remains the infrastructure composition source; neither App
  nor presentation feature files import provider implementations.
- ADR-003 and ADR-004 boundaries remain unchanged.

## Task list

### Slice 3.0 - Architecture contract

- [x] Lower the executable App line gate from 600 to 450.
- [x] Add a source contract for coordinator ownership and size limits.
- [x] Prove the contract fails against the current 598-line App.

Verification: `npx vitest run src/app/appCompositionRoot.test.ts scripts/architectureAnalyzer.test.ts`.

### Slice 3.1 - Owner and Library runtime

- [x] Extract catalog query, owner/library session, cloud publications, export
  and browser capability composition into `useAppLibraryRuntime`.
- [x] Preserve the owner-current category-facet guard and Practice Snapshot
  publication bridge.
- [x] Update owner-safety characterization to assert the owning module.

Files: library runtime, App, composition contract and owner-safety test.

Verification: composition, architecture, Library Session ports/session/cloud
projection and owner-safety tests plus TypeScript.

### Checkpoint A - Library boundary

- [x] App no longer creates Library Session ports or cloud publication objects.
- [x] Library and owner race contracts remain green.

### Slice 3.2 - Learning coordination

- [x] Extract Practice, Learning State, media hydration, custom deck and Intake
  wiring into `useAppLearningCoordination`.
- [x] Move Library screen contract adapters and mutation error handling with the
  coordination they consume.
- [x] Update Practice composition characterization to assert the new owner.

Files: learning coordinator, App, composition contract and Practice source test.

Verification: coordination contract, Learning, Intake, Practice, custom-deck,
media hydration and Library screen tests plus TypeScript.

### Checkpoint B - Thin App

- [x] App contains shell, navigation, overlays and view rendering only.
- [x] App is at most 450 lines; both extracted modules remain within their caps.
- [x] Dependency graph has zero cycles and ADR-003/004 source boundaries pass.

### Slice 3.3 - Final acceptance

- [x] Run full core verification with Java 21.
- [x] Run production build, bundle budget and focused Chromium journeys.
- [x] Run correctness, readability, architecture, security and performance review.
- [x] Retain exact local evidence without claiming deployment or CI acceptance.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Hook extraction changes call order | Critical | Preserve original hook order inside the two sequential app hooks; focused owner-race tests after each slice |
| Library callbacks access an uninitialized Practice snapshot | Critical | Stable no-op bridge ref replaced synchronously after Practice workspace composition |
| Refactor merely moves one giant monolith | High | Two ownership-specific modules with 300/350-line caps and source contracts |
| Catalog leaks into Library | High | Keep Catalog/Today/Progress imports in `AppViewStage`; source contract plus graph analyzer |
| Late owner result mutates the next owner | Critical | Retain active-owner ref guard and its characterization test |
| Existing dirty work is overwritten | High | Patch only Phase 3 files and preserve Phase 0-4 changes plus `docs/design/` |

## Dependencies

Slices are sequential: 3.0 -> 3.1 -> Checkpoint A -> 3.2 -> Checkpoint B ->
3.3. No slice authorizes schema, migration, Rules, dependency or rollout changes.
