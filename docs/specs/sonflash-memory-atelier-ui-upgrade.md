# Spec: SonFlash Memory Atelier UI Upgrade

## Objective

Evolve the current SonFlash interface into a flagship learning experience for Vietnamese learners of English. Preserve the product's identity and working behavior while making the visual hierarchy, material system, typography, motion, and transitions feel deliberate and premium.

The chosen direction is **Memory Atelier**:

- Preserve the official SonFlash mark, cyan brand color, Geist body type, cinematic landing media, light/dark themes, and existing tactile motion.
- Use a cold mineral palette: mist, silver, deep ink, and controlled cyan. Amber remains a semantic reward color, not a second brand accent.
- Treat Today as the decision screen, Vocabulary as the memory collection, Paths as a learning journey, Progress as a narrative of growth, and practice as an immersive focus mode.
- Reduce nested glass cards. Use elevation only where it communicates hierarchy.
- Keep the landing cinematic, but align its controls, type rhythm, copy voice, and transition into the app with the product shell.

### Primary user outcomes

1. A returning learner identifies the next learning action within five seconds.
2. A new learner understands the Capture -> Learn -> Recall -> Master loop without reading a feature catalogue.
3. Landing and product surfaces feel like one SonFlash brand.
4. Mobile users can complete the primary flow with one hand and without content being hidden by navigation.

## Scope

### Landing

- Keep one cinematic video hero and the existing atmosphere selector.
- Replace unsupported metrics and absolute outcome claims with verified product capabilities.
- Use one canonical CTA label: `Start learning`.
- Bring all page content inside correct landmarks and fix heading order and accessible names.
- Replace repeated equal feature cards with an asymmetric story built from real product capabilities and a real product screenshot or live component preview.
- Preserve `#features` and `#methods` anchors.

### Product shell

- Flatten nested header surfaces and make sync/account/theme a quiet utility group.
- Keep Today, Paths, Vocabulary, and Progress labels and routes unchanged.
- Keep the mobile bottom-navigation model, touch targets, focus behavior, and safe-area spacing.
- Preserve the current semantic token strategy in `src/index.css`.

### Today

- Keep one dominant daily action and the due -> strengthen -> first-look sequence.
- Move the full practice catalogue behind progressive disclosure.
- Show at most three contextually useful practice shortcuts on the main screen.
- Preserve all lesson modes and behavior.

### Paths

- Turn the three path states into one visually connected learning journey.
- Preserve personal-library semantics, counts, actions, and unavailable/error states.

### Vocabulary

- Preserve create, filter, paginate, share, study, card, image, and management behavior.
- Reduce competition between the hero, summary metrics, creation tools, and card grid.
- Keep the card itself the richest visual object on the page.

### Progress

- Keep the next useful action first.
- Present summary metrics as supporting evidence, not three equal hero cards.
- Preserve charts, empty/error/offline states, and lazy loading.

### Practice

- Preserve front/back card behavior, keyboard shortcuts, rating controls, focus management, and all modes.
- Refine spacing, progress visibility, and transitions without altering study logic.

## Non-goals

- No route, navigation taxonomy, data model, Firebase, Auth, App Check, Firestore, sync, scheduler, import/export, or learning-engine changes.
- No new component library, animation library, font package, or runtime dependency.
- No logo redesign, mascot, gamification economy, pricing, analytics, or invented social proof.
- No deployment in this change unless explicitly requested later.

## Tech Stack

- React 19 and TypeScript
- Vite 6
- Tailwind CSS 4 plus semantic CSS variables
- Existing Lucide icon family
- Existing GSAP motion utilities and native CSS transitions
- Radix dialogs already installed in the repository

## Commands

```bash
# Local development
npm run dev

# Type checking
npm run lint

# Targeted component tests
npx vitest run src/features/dailyLearning/DailyLearningScreens.test.tsx src/themeTokens.test.ts

# Production build and bundle guard
npm run build
npm run verify:bundle

# Browser verification
npx playwright test e2e/accessibility.spec.ts e2e/app-shell-remediation.spec.ts e2e/motion-remediation.spec.ts e2e/flashcard-remediation.spec.ts --project=chromium
```

## Project Structure

```text
src/features/landing/              Landing composition and marketing copy
src/components/shell/              Desktop and mobile application navigation
src/features/dailyLearning/        Today and Progress presentation
src/features/catalogWorkspace/     Paths presentation
src/features/library/              Vocabulary presentation and tools
src/components/Flashcard.tsx       Vocabulary card experience
src/features/practice/             Focused learning modes
src/index.css                      Shared semantic tokens and material rules
src/lib/motion.ts                  Existing motion language
e2e/                               Responsive, accessibility, and motion checks
docs/design/sonflash-redesign/     Existing brand and product design evidence
```

## Code Style

Reuse semantic tokens and existing presentation boundaries. Do not introduce a generic design-system abstraction for one redesign.

```tsx
<section aria-labelledby="daily-plan-heading" className="sf-focus-panel">
  <div className="min-w-0">
    <h2 id="daily-plan-heading" className="text-balance text-3xl font-black tracking-tight">
      Your daily plan
    </h2>
    <p className="mt-2 max-w-2xl text-pretty text-[var(--sf-text-muted)]">
      Review what is due, strengthen weak memories, then meet new words.
    </p>
  </div>
  <button type="button" className="brand-action min-h-11" data-primary-learning-action="true">
    Continue review
  </button>
</section>
```

Rules:

- One `h1` per view, then sequential heading levels.
- Use existing CSS variables instead of new raw colors in product surfaces.
- Animate only transform and opacity; every automatic motion honors reduced motion.
- Radius roles: panels 24-28px, controls 12-16px, primary actions full-pill.
- No visible em dash, unsupported metric, duplicate CTA intent, decorative status dot, or placeholder-as-label.

## Testing Strategy

### Automated

- Extend the smallest existing component test when DOM hierarchy or visible choices change.
- Keep current keyboard, focus restoration, 44px target, responsive reflow, reduced-motion, and accessibility tests passing.
- Axe must report no serious or critical violation on Landing, Today, Paths, Vocabulary, Progress, and Study.
- Bundle verification must pass without increasing the initial JavaScript budget.

### Visual runtime checks

- Capture light and dark screenshots at 390x844 and 1440x900.
- Check 320px, 768px, and 1024px for overflow and navigation wrapping.
- Inspect landing hero, mobile menu, Today populated/empty/error, Paths, Vocabulary populated/empty, Progress populated/empty, Study front/back, and practice dialog.
- Confirm the primary CTA remains visible in the first useful viewport.
- Confirm no content is obscured by mobile bottom navigation or safe-area insets.

## Boundaries

### Always

- Preserve behavior, accessibility, data safety, authentication boundaries, theme support, and reduced-motion fallbacks.
- Reuse existing dependencies, components, tokens, and motion helpers.
- Keep each implementation slice runnable and visually verified.

### Ask first

- Changing route URLs, primary navigation labels, form field names/order, official logo, brand cyan, or landing video content.
- Removing a learning mode or changing which algorithm chooses the daily plan.
- Adding any dependency or changing production configuration.

### Never

- Invent product metrics, testimonials, retention claims, user counts, or scientific outcomes.
- Weaken Auth, App Check, Firestore rules, offline protection, accessibility, or reduced-motion behavior.
- Commit secrets, user data, generated archives, or unrelated workspace changes.

## Success Criteria

- Landing and app share one recognizable SonFlash visual grammar while retaining the cinematic hero.
- Today exposes one dominant learning action and no more than three direct practice shortcuts.
- Every view has a distinct composition without relying on repeated equal-card grids.
- Light and dark themes retain equivalent hierarchy and WCAG AA contrast.
- No horizontal overflow at 320px, 390px, 768px, 1024px, or 1440px.
- All visible controls meet the existing 44px target standard.
- Landing has valid landmarks, sequential headings, and accessible names for icon-only buttons.
- Unsupported marketing claims are absent.
- Targeted unit tests, production build, bundle guard, and Chromium UI checks pass.
- Before/after screenshots show a material visual improvement without behavior or content loss.

## Open Questions

No blocking product question remains under the preserve-first assumption. Human approval of this spec is required before implementation.
