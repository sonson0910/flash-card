# SonFlash world-class UI overhaul v2

Date: 2026-08-26

Status: landing implemented on feature branch, awaiting localhost approval

## Outcome

Rebuild SonFlash as a coherent premium learning product, not a collection of polished screens. Preserve routes, data, authentication, learning logic, accessibility, light and dark modes, and reduced-motion behavior.

The new visual system is called **Memory Instrument**: words feel like precise physical objects that can be captured, arranged, recalled, and mastered.

## Research synthesis

### Apple Design Awards 2026

- Apple recognized Moonlitt for intuitive controls, easy onboarding, and material that lets the subject remain the focus.
- Tide Guide won for a cohesive visual theme, crisp data presentation, and custom animation that explains rather than decorates.
- Guitar Wiz paired strong visual craft with Dynamic Type, Increased Contrast, and Differentiate Without Color.

Source: [Apple Design Awards 2026](https://www.apple.com/newsroom/2026/06/apple-reveals-winners-of-the-2026-apple-design-awards/)

Applied rule: SonFlash may feel cinematic, but the word, meaning, and next learning action must stay visually dominant.

### CapWords

- CapWords turns language learning into a tactile collectible through sight, sound, and touch cues.
- Its processing flow uses micro-animation to maintain attention while useful work happens.
- The delight comes from the core action, not from decorative motion around the product.

Sources: [Apple developer story](https://developer.apple.com/articles/capwords/), [CapWords](https://capwords.app/)

Applied rule: SonFlash cards become the signature object. Create, reveal, rate, and master transitions should feel physical and memorable.

### Duolingo product redesign

- Duolingo explored punchy, soft, modular, and flat directions before selecting a system.
- The final system balances consistency with each tab's purpose.
- It reduced forced containers, intentionally limited type styles, and used whitespace as structure.

Source: [Duolingo core tabs redesign](https://blog.duolingo.com/core-tabs-redesign/)

Applied rule: Today, Paths, Vocabulary, and Progress share tokens and navigation, but each receives a distinct composition that supports its job.

### Readwise Reader

- Reader offers a focus-first long-form view, collapsible side panels, strong keyboard navigation, theme control, and adjustable typography.
- Its interface becomes quieter when the user is reading.

Sources: [Reader appearance](https://docs.readwise.io/reader/docs/faqs/appearance), [Reader keyboard interactions](https://docs.readwise.io/reader/docs/faqs/highlights-tags-notes)

Applied rule: Study mode removes application chrome and becomes an immersive recall room with keyboard actions kept visible.

### Linear

- Linear builds its story around actual product artifacts and reserves hierarchy for real workflow states.
- Product UI, page narrative, and typography all use the same visual grammar.

Source: [Linear](https://linear.app/)

Applied rule: landing visuals must use the real product. Product surfaces and marketing cannot look like different brands.

### Awwwards pattern research

- Award-winning work commonly uses full-bleed media, strong typographic contrast, interaction design, and unusual composition.
- Novelty alone is not the target. SonFlash will use only a few memorable moments and keep navigation and learning actions conventional.

Source: [Awwwards web and interactive collection](https://www.awwwards.com/websites/web-interactive/)

### Motion benchmark 2025-2026

- Aether 1 treats the entire page as one cinematic sequence, but keeps the narrative legible from hero to footer.
- Podium turns running metrics into story beats through pacing, scale, and controlled transitions rather than a wall of effects.
- TrueKind and Gentle Rain show that premium motion comes from a consistent material language and art direction, not from effect count.
- Stefan Vitasovic and Trionn coordinate type, 3D, scroll, and sound as one system, with each layer serving a clear transition.
- Current Webby and FWA winners favor real-time depth, evolving type, and spatial transitions, while the judging criteria still prioritize content, structure, usability, and overall experience.

Sources: [Aether 1](https://webflow.com/webflowconf/2025/webflow-awards-recipient/aether1), [Podium](https://tympanus.net/codrops/2026/06/23/podium-building-a-website-where-running-becomes-storytelling/), [TrueKind](https://tympanus.net/codrops/2025/06/25/designing-truekind-a-skincare-brands-journey-through-moodboards-motion-and-meaning/), [Gentle Rain](https://tympanus.net/codrops/2025/01/16/case-study-gentle-rain/), [Stefan Vitasovic](https://tympanus.net/codrops/2025/03/05/case-study-stefan-vitasovic-portfolio-2025/), [Trionn](https://tympanus.net/codrops/2026/07/15/the-architecture-behind-trionn-coordinating-gsap-three-js-lenis-and-web-audio/), [Webby motion winners](https://winners.webbyawards.com/winners/websites-and-mobile-sites/features-design/best-use-of-animation-or-motion-graphics?sort=0), [Webby judging criteria](https://www.webbyawards.com/judging-criteria/), [FWA feed](https://thefwa.com/rss/)

Applied rules:

- Build one continuous Capture to Understand to Recall to Master story.
- Use one shared flashcard object to carry continuity between scenes.
- Let fragments resolve into a complete word or card as the signature memory motif.
- Keep one tactile material grammar across typography, cards, light, and motion.
- Give desktop and mobile distinct choreography instead of shrinking the same sequence.
- Spend the motion budget on a few GSAP sequences; keep readable content and controls in normal DOM and CSS.

Rejected patterns: scroll hijacking, perpetual marquees, cursor-only interaction, autoplay audio, preloaders, and decorative particles or blur without semantic purpose.

### Image-first visual references

Six independent keyframes were generated before implementation:

1. Asymmetric hero with the optical memory instrument.
2. Product proof using the real Study interface.
3. Four-stage Capture, Understand, Recall, Master card journey.
4. Focused Study Theater with one primary card.
5. Full-density Today, Paths, Vocabulary, Progress system preview.
6. Quiet closing scene with one action and the resolved memory object.

The extracted system is cold graphite, silver-white Geist typography, restrained cyan, upper-left light, optical glass, and transformation through scale, depth, clipping, and opacity. Generated images remain references; the shipped page uses the existing memory sculpture and real product captures.

## Design read

Redesign-overhaul for Vietnamese English learners, with a cold-luxury, tactile-memory language. The system borrows interaction discipline from award-winning native apps and visual confidence from high-end web experiences without copying a specific product.

### Dials

| Surface | Design variance | Motion intensity | Visual density |
| --- | ---: | ---: | ---: |
| Landing | 9 | 8 | 3 |
| Shell and Today | 7 | 5 | 4 |
| Paths and Vocabulary | 7 | 5 | 5 |
| Progress | 6 | 4 | 5 |
| Study | 8 | 7 | 3 |

## Visual system

### Palette

- Dark base: smoked navy-black, graphite, cold mineral surfaces.
- Light base: silver-white, blue-grey paper, graphite text.
- Brand accent: one restrained cyan.
- Semantic feedback colors remain only where meaning requires them: error, warning, success, and recall ratings.

### Typography

- Geist Variable across marketing and product.
- No decorative serif in v2.
- Display hierarchy comes from width, weight, tracking, and composition.
- Vietnamese text receives generous line height and no compressed display treatment.
- Numbers use tabular figures.

### Shape system

- Major learning objects: 24px radius.
- Fields and nested controls: 12px radius.
- Primary and compact action controls: pill.
- Floating navigation and dialogs may use refractive glass.
- Scrolling content panels use solid or translucent fills without backdrop blur.

### Material and light

- Signature material: optical glass card over satin graphite.
- One consistent light source from the upper-left.
- Tinted shadows only.
- Grain is one fixed, pointer-ignored overlay, disabled when reduced transparency is requested.

### Iconography

- Keep the installed Lucide family to avoid a dependency migration.
- Standardize visible product icons at `strokeWidth={1.6}` where touched.
- Use icons only when they improve recognition. No decorative icon circles on every row.

## Three deliberate wow moments

### 1. Landing memory instrument

- Replace the current stock-video-first hero with the generated optical-card sculpture.
- Use a restrained mask reveal and depth shift, not continuous floating motion.
- Present one product promise and one `Start learning` action.
- Connect the sculpture to a real SonFlash card during scroll.

Motion communicates the move from an unformed memory to a recalled card.

### 2. Today to Study handoff

- Today presents one dominant learning object, not a dashboard summary.
- Starting review visually hands that object into Study.
- Without motion or under reduced motion, navigation remains immediate and fully understandable.

Motion communicates continuity between choosing work and doing work.

### 3. Flashcard recall reveal

- The front face recedes, meaning and context unfold in reading order, and rating controls rise into reach.
- Audio, keyboard controls, focus order, and rating logic stay unchanged.

Motion communicates a state transition and preserves attention on the remembered meaning.

## Surface redesign

### Application shell

- Desktop: compact floating navigation rail with strong active-state geometry and no nested glass cards.
- Mobile: bottom dock optimized for thumb reach, with the current destination unmistakable.
- Theme, sync, install, and account actions remain available but visually secondary.
- Keep the existing route taxonomy: Home, Today, Paths, Vocabulary, Progress.

### Today

- One primary daily learning object occupies the first viewport.
- Due review, daily lesson, and optional practice form one clear sequence.
- Supporting evidence becomes inline and quiet.
- Empty, offline, loading, and completed states receive equally intentional compositions.

### Paths

- Replace the generic connected list with a continuous learning map.
- Current stage is a large active waypoint; completed and upcoming stages recede spatially.
- Preserve catalog filters, selection, enrollment, and progress logic.

### Vocabulary

- Treat the library as an archive of memory objects.
- Smart creation becomes a focused composer, not another utility card.
- Search, filter, import, and management remain quickly reachable.
- Collection layout gains stronger rhythm through variable card density without changing DOM order on mobile.

### Progress

- Lead with the next useful action and a narrative of recent learning.
- Metrics become supporting typographic evidence.
- Charts remain accurate and accessible but receive a quieter visual frame.

### Study

- Enter an immersive recall room with reduced shell chrome.
- Flashcard becomes the only dominant object.
- Reveal order remains meaning, explanation, memory hook, then detail.
- Rating actions stay keyboard-accessible and visible after reveal.

### Landing

Six scenes, each with a different layout family:

1. Memory Instrument hero with generated campaign visual.
2. Compact product proof using real interface crops.
3. Sticky card journey from capture to recall.
4. Full-width Study theater with real product interaction.
5. Personal learning system shown through Today, Paths, Vocabulary, and Progress.
6. Minimal closing action and legal footer.

## Motion budget

- GSAP is already installed and is reserved for landing scroll storytelling.
- Product UI uses CSS transitions and existing focused GSAP components only.
- Animate only transform and opacity.
- No global scroll listeners.
- Every animation has a reduced-motion static state.
- No motion on every card, list row, or metric.

## Performance budget

- No new UI or animation dependencies.
- Generated hero source ships as WebP or AVIF with explicit dimensions.
- Landing initial JS stays within the current bundle guard.
- Non-critical product media remains lazy.
- Avoid backdrop blur on scrolling containers.
- Preserve current code splitting.

## Accessibility contract

- WCAG AA contrast for text and controls.
- 44px minimum target for primary navigation and actions.
- Visible focus and logical heading order.
- No color-only status meaning.
- Reduced motion and reduced transparency fallbacks.
- One `main` landmark per page.
- Keyboard access preserved across Study, menus, dialogs, and library management.

## Delivery waves

### Wave 0: visual baseline and contracts

- Capture desktop and mobile snapshots for every primary route in both themes.
- Add visual hierarchy and accessibility assertions before changing components.
- Record bundle and performance baselines.

Acceptance:

```bash
npm run lint
npm run build
npm run verify:bundle
npx playwright test e2e/accessibility.spec.ts e2e/app-shell-remediation.spec.ts --project=chromium
```

### Wave 1: tokens and shell

- Rebuild semantic tokens, surface materials, type scale, spacing, radii, and focus states.
- Upgrade desktop and mobile navigation.
- Do not change route semantics or callbacks.

Checkpoint: shell unit tests, app-shell Chromium tests, light and dark screenshots.

### Wave 2: Today, Paths, Vocabulary, Progress

- Implement one surface at a time.
- Begin each surface with a failing hierarchy or interaction assertion.
- Run focused tests and a screenshot review before moving on.

Checkpoint: route-specific unit tests, accessibility checks, 320px reflow, and desktop visual review.

### Wave 3: Study theater

- Recompose Study and Flashcard without changing learning behavior.
- Preserve focus, audio, rating, keyboard, and reduced-motion contracts.

Checkpoint: Flashcard and practice unit tests plus Chromium remediation suite.

### Wave 4: landing scroll story

- Use the generated memory-object asset.
- Build only three motivated animation systems: hero reveal, card journey, product handoff.
- Use real product screenshots and real product components.
- Run the full design-taste pre-flight.

Checkpoint: landing accessibility, mobile/desktop screenshots, bundle guard, and Lighthouse.

### Wave 5: integrated QA

- Full main-source unit suite.
- All Chromium UI E2E.
- Targeted Firefox and WebKit landing, shell, and Study smoke tests.
- Independent design and regression review.
- No push or deploy until localhost receives explicit approval.

## Commit plan

1. `docs: research world-class sonflash UI`
2. `feat: establish memory instrument design system`
3. `feat: rebuild the daily learning room`
4. `feat: reshape paths and vocabulary`
5. `feat: refine progress and study focus`
6. `feat: direct the sonflash landing experience`
7. `fix: resolve final UI review findings`

## Definition of done

- The user approves localhost in desktop and mobile views.
- Every primary route reads as one SonFlash system while retaining its own purpose.
- The three wow moments are visible and meaningful.
- No route, data, auth, learning, or accessibility regression is substantiated.
- Lint, build, bundle, focused browser tests, and independent review pass.
- Nothing is pushed or deployed without explicit user approval.
