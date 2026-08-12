# Spec: Thin Application Composition Root

## Objective

Reduce `src/App.tsx` from 598 lines to at most 450 lines while preserving all
current behavior. App remains responsible for shell refs, overlay/navigation
composition, view selection and rendering. Owner/library publications and
Learning/Intake/Practice coordination move behind explicit app-level hooks.

## Commands

```sh
npx vitest run src/app/appCompositionRoot.test.ts scripts/architectureAnalyzer.test.ts
npm run lint
task_jdk_home="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home"
JAVA_HOME="$task_jdk_home" PATH="$task_jdk_home/bin:$PATH" npm run verify:core
npm run build
npm run verify:bundle
git diff --check
```

## Project structure

- `src/App.tsx`: shell, view selection and composition only.
- `src/app/useAppLibraryRuntime.ts`: catalog query, owner/library lifecycle,
  cloud publications, export and browser capability composition.
- `src/app/useAppLearningCoordination.ts`: Learning State, Practice, Intake,
  media hydration, custom deck and Library screen coordination.
- `src/app/AppViewStage.tsx`: existing Catalog, Today and Progress view boundary.
- `src/features/**`: existing feature controllers and ports remain authoritative.
- `scripts/architectureAnalyzer.test.ts`: executable line and dependency gates.

## Code style

Use explicit model/action/port groups instead of a flat bag of callbacks:

```ts
return {
  model: { cards, user, cloud },
  actions: { updateCategoryFacets, exportLibrary },
  ports: { session: sessionPorts.ports.session },
};
```

App-level hooks may compose feature modules but must not reimplement feature
protocols. Public contracts use product/domain types and do not expose Firebase
handles.

## Testing strategy

- Start with a failing source/architecture contract for the 450-line App gate
  and coordinator ownership.
- Keep existing Library Session, Learning Workspace, Intake, Practice and app
  source contracts green after each extraction slice.
- Run the production architecture analyzer to prove the full dependency graph
  remains acyclic.
- Run the complete core/build/bundle gates and focused Chromium shell/practice
  journeys after the refactor.

## Boundaries

### Always

- Preserve owner isolation, monotonic session generations, epoch/revision/
  tombstone ordering and acknowledgement-last behavior.
- Keep Catalog Workspace separate from Library UI per ADR-003.
- Keep Daily Learning as a consumer of the shared practice/learning ports per
  ADR-004.
- Preserve existing UI, copy, URLs, focus behavior and storage schemas.

### Ask first

- Schema, migration, Rules, dependency, CI or deployment changes.

### Never

- Import Catalog Workspace into Library feature files.
- Move Daily Learning engine logic into App or Library.
- Replace the current coordinators with one unbounded facade that merely moves
  the same monolith.
- Modify or remove the user-owned `docs/design/` directory.

## Success criteria

1. `src/App.tsx` has at most 450 physical lines, providing at least 25% headroom
   below the former 600-line gate.
2. App does not directly import Library Session ports, Learning Workspace,
   Intake Sharing, Practice Workspace, media hydration or custom-deck hooks.
3. `useAppLibraryRuntime.ts` owns owner/library lifecycle and cloud publication
   wiring and remains at most 300 lines.
4. `useAppLearningCoordination.ts` owns Learning/Intake/Practice coordination and
   remains at most 350 lines.
5. `AppViewStage` remains the only app view boundary importing Catalog/Today/
   Progress workspaces; Library feature files do not import them.
6. The production dependency graph remains acyclic and all verification gates
   pass without behavior or data-contract changes.

## Assumptions

- This is a behavior-preserving architecture refactor; no UI redesign belongs
  to Phase 3.
- The existing feature controllers and the Phase 2-4 deep modules are retained,
  not replaced.
- The worktree stays uncommitted unless the user separately requests a commit.

## Open questions

None. The user supplied the target boundary and acceptance gate explicitly.
