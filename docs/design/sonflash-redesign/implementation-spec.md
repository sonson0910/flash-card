# Implementation Spec · Focused Momentum v2

## Objective

Apply the approved SonFlash redesign to the production React views without changing learning, persistence, sync, catalog, authentication, or navigation behavior. The result should make the next honest learning action obvious, use a shared visual grammar across Today, lesson/placement, Paths, Progress, and Practice, and preserve Vocabulary as the product's established visual authority.

## Product and data rules

- Keep the primary navigation as Today, Paths, Vocabulary, and Progress. Lesson and placement remain focused subflows.
- Render only data already present in each presentation model. Do not invent study time, streaks, mastery percentages, explanations, or curriculum labels.
- Keep personal Library progress separate from reviewed catalog tracks.
- Preserve offline, loading, empty, error, short-plan, placement, provenance, download, URL-state, answer, feedback, FSRS rating, completion, focus, and live-region contracts.
- XP means XP. An empty XP history stays empty and must not receive a fabricated zero-value entry.

## Visual and interaction rules

- Use Geist, SonFlash cyan, neutral canvas/surfaces, restrained depth, and one visually dominant action per screen state.
- Use a compact learning hero, ordered plan, focused session column, large answer targets, and clear in-flow feedback.
- Keep controls at least 44 CSS pixels, visible `:focus-visible` treatment, semantic controls, light/dark parity, responsive reflow, and reduced-motion behavior.
- Avoid nested glass-card decoration, `transition-all`, bare `outline-none`, inaccessible scroll regions, and automatic focus without navigation intent.

## Project structure and style

- Production views: `src/features/dailyLearning`, `src/features/catalogWorkspace`, `src/features/practice`, `src/components/stats`.
- Shared visual tokens stay in `src/index.css`; feature behavior remains in its owning feature package.
- Use typed React function components and existing CSS variables/Tailwind utilities. Do not add dependencies.

## Commands and testing

- Targeted component tests: `npx vitest run <test files>`
- Type check: `npm run lint`
- Build: `npm run build`
- Full local gate: `npm run verify`
- Browser review: desktop/mobile and light/dark, with keyboard and accessibility checks.

## Boundaries

- Always: add or strengthen behavior-focused tests before behavior changes; keep every slice buildable; preserve existing dirty user files.
- Ask first: dependency additions, navigation taxonomy changes, domain/Firestore contract changes, push, or deployment.
- Never: fabricate user metrics, delete user work, weaken accessibility tests, or expose secrets.

## Success criteria

1. Today exposes an ordered due → weak → new plan and one honest primary action while all six lesson modes remain reachable.
2. Lesson and placement share a focused 760–880px session grammar and preserve every answer/feedback/rating/diagnostic state.
3. Progress has an actionable hero, honest empty XP history, real memory groups, lower-priority partial category data, and no inaccessible scroll region.
4. Paths clearly separates personal Library progression from reviewed catalog exploration while retaining all existing data, URL, offline, download, and provenance contracts.
5. Practice screens use the same visual grammar without regressing focus management or announcements.
6. Targeted tests, type checking, build, and feasible acceptance gates pass; desktop/mobile light/dark output is manually reviewed.

## Open questions

None. The product direction and scope were approved in the preceding design review; implementation should proceed incrementally.
