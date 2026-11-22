# Theme token mapping

The four source sets are `classic-dark`, `classic-light`, `crystal-dark`, and
`crystal-light` in `docs/design/sonflash-redesign/canvas/tokens.json`.

| CSS token | Classic canvas token | Crystal canvas token |
| --- | --- | --- |
| `--sf-canvas`, `--sf-surface`, `--sf-surface-raised`, `--sf-surface-muted` | `pageBg`, `surfaceSolid`, `chipBg`, `chipBg` | `pageBg`, `panelSolid`, `chip`, `chip` |
| `--sf-text`, `--sf-text-muted`, `--sf-border` | `text`, `text2`, `line` | `text`, `text2`, `line` |
| `--sf-brand`, `--sf-brand-hover`, `--sf-brand-text` | `accent`, `accentText`, `accentText` | `crimson`, `crimsonDeep`, `crimsonText` |
| `--sf-on-brand`, `--sf-reward`, `--sf-success`, `--sf-danger` | `primaryText`, `gold`, `good`, `danger` | `primaryText`, `gold`, `good`, `crimsonText` |
| `--sf-second`, rating tokens | `second`, `again` / `hard` / `good` / `warn` | `holo`, `again` / `hard` / `good` / `easy` |
| `--sf-rim-new`, `--sf-rim-learning`, `--sf-gold-rim` | `rimNew`, `rimLearning`, `goldRim` | `tier.new.rim`, `tier.learning.rim`, `tier.mastered.rim` |
| `--sf-card-bg`, `--sf-dialog-bg`, `--sf-scrim` | `cardBg`, `dlgBg`, `scrim` | `cardFront`, `panel`, `scrim` |
| `--sf-heat-*`, `--sf-confetti-*` | `heat[*]`, `confetti[*]` | the AnimeProgress `heatScale` (empty, two teal steps, two crimson steps) and `crimson` / `holo` / `gold` / `flare` / `pink` |
| `--sf-text-tertiary` | `text3`, darkened to AA (`#71675a`, `#7d8e98`) | `text3`, `#58698a` in light for AA |
| `--sf-second-text` | `secondText` | `holoText`, `#08708a` in light for AA |
| `--sf-card-front` | `cardBg` | `cardFront` |
| `--sf-metal` | flat `textStrong` gradient | `metal` |
| `--sf-tier-bud`, `--sf-tier-bloom`, `--sf-tier-star` | New `lineStrong`, Learning `accent`, Mastered `gold` (ProgressScreen legend) | `tier.new.color`, `tier.learning.color`, `tier.mastered.color` |
| `--sf-avatar-bg` | `avatarBg` | the ANAV account hexagon gradient |
| `--sf-book-terracotta`, `-ink`, `-ochre`, `-moss`, `-violet`, `-teal`, `--sf-book-foil` | light: PathsScreen `lightCloth` and title foil; dark: `darkHue` tints and `textStrong` | AnimePaths `hue.*.tint` (crimson, cyan, gold, navy, pink, holo) and `textStrong` |
| `--sf-text-strong`, `--sf-text-body`, `--sf-text-subtle` | `textStrong`, `body`, `text3` (`#746b5f` in light for AA) | `textStrong`, `body`, `text3` |
| `--sf-holo-text` | `accentText` (light) / `#7ee6fa` (dark) | `holoText`, `#08708a` in light for AA |
| `--sf-warm`, `--sf-warm-bg`, `--sf-warm-line` | `warm`, `warmBg`, `warmLine` (streak chip) | `gold`, the `warn` fill and gold line |
| `--sf-warn`, `--sf-warn-bg`, `--sf-warn-line`, `--sf-info`, `--sf-info-bg`, `--sf-info-line` | `warn`, `warnBg`, `info`, `infoBg` | `warn`, `warnBg`, `info`, `infoBg` |
| `--sf-success-text`, `--sf-success-soft`, `--sf-success-line`, `--sf-danger-soft`, `--sf-danger-line` | `ok`, `okBg`, the ok line, `dangerBg`, the danger line | `holoText`, `okBg`, `panelEdge2`, `dangerBg`, `panelEdge` |
| `--sf-primary-bg`, `--sf-on-primary`, `--sf-primary-shadow` | `primaryBg`, `primaryText`, `primaryShadow` | `primaryBg`, white, `primaryGlow` |
| `--sf-crimson-gradient` | the accent gradient | `crimsonGrad` |
| `--sf-logo-bg`, `--sf-logo-text`, `--sf-logo-shadow`, `--sf-avatar-text` | `logoBg`, `logoText`, the dark logo glow, `avatarText` | `primaryBg`, white, none, white |
| `--sf-star-face`, `--sf-star-shade` | accent and its deep shade | the brand star's rose face and blood shade |
| `--sf-panel-edge`, `--sf-panel-edge-2` | `line` and a stronger line | `panelEdge`, `panelEdge2` |
| `--sf-space` | `none` | `space` (the starfield gradients behind the canvas) |
| `--sf-dialog-shadow` | `dlgShadow` | the dialog shadow of the Anime dialog boards |
| `--sf-tab-bg`, `--sf-tab-shadow`, `--sf-tab-active`, `--sf-tab-active-text` | `tabBg`, `tabShadow`, the active pill fill and text | `tabBarBg`, the `panelEdge` top edge, `primaryBg`, white |
| `--nk-chamfer`, `--nk-chamfer-sm`, `--nk-snap`, `--nk-stars`, `--nk-wing-opacity` | normalized defaults | `chamfer`, `chamferSm`, `snap`, `stars`, `wingOpacity` |
| `--sf-flare`, `--sf-umbra`, `--sf-shadow-tint` | white, black, the warm `rgb(60 40 20)` of the panel shadows (black in dark) | `flare`, black, the `rgb(20 70 130)` panel shadow (black in dark) |
| `--sf-tone-1` to `--sf-tone-4` | LangCard / LangReview `tone` (light tone 3 kept at `#8a5a0c`: the board's `#a8781f` misses AA) | the Anime language boards' tone hues; light tones 1 and 2 deepened to `#086a82` and `#19672f` for AA on the glass chips |
| `--sf-switch-on`, `--sf-switch-on-text`, `--sf-switch-knob` | LangCard `romajiTrack` (accent), the accent label, `romajiKnobBg` | the holo cyan reading switch with its `#031820` label (light uses `#7ff6ff` to `#2bc4e0` so the dark label keeps AA); no knob is drawn (`--sf-surface`) |
| `--sf-pink-text` | not drawn; follows `--sf-holo-text` | `pinkText` |
| `--sf-gold-line`, `--sf-gold-paper`, `--sf-gold-ink`, `--sf-gold-shadow` | the Progress shelf and Achievements gold medal: rim line, paper, ink, warm shadow (`#ffe6a8` ink in dark) | not drawn: `--sf-reward`, `--sf-surface`, `--sf-warn`, `--sf-shadow-tint` |
| `--sf-medal-face`, `--sf-medal-star-face`, `--sf-ring-core`, `--sf-shelf-bg`, `--sf-foil-sheen` | the Achievements earned and star medal faces, level ring core, the Progress shelf fill and the star badge sheen | not drawn: `--sf-surface`, and `none` for the sheen |
| `--sf-hero-sky`, `--sf-hero-glow`, `--sf-hero-text`, `--sf-hero-title`, `--sf-hero-body`, `--sf-hero-muted`, `--sf-hero-cta-text`, `--sf-hero-shadow` | PathsScreen `hero` (light: the moss cloth hero; dark: the aurora hero) | AnimePaths hero fill (its base gradient and tinted glow); the hero text uses the text tokens and the panel shadow |
| `--sf-book-face` | the dark Paths book face (`cardBg`) | AnimePaths book fill |
| `--sf-holo-light`, `--sf-holo-pale`, `--sf-holo-deep`, `--sf-holo-ink`, `--sf-gold-light`, `--sf-gold-deep`, `--sf-blush`, `--sf-rose-light`, `--sf-pink-light` | not drawn: `--sf-second`, `--sf-holo-text`, `--sf-reward`, `--sf-brand`, `--sf-tier-bloom` | the holo, gold, crimson and pink stops of the Anime boards (AnimePaths `hue.*.spine`, `metal`, `holoText`, AnimeProgress tomorrow bar) |
| `--sf-mark-crimson`, `--sf-mark-navy`, `--sf-veil` | not drawn: `--sf-crimson-gradient`, `--sf-primary-bg`, `--sf-scrim` | AnimeWebWords source marks and the locked-badge veil |

`--sf-grain-*` has no Crystal source equivalent, so Crystal uses a neutral no-grain
fallback. `public/theme-crystal.css` is loaded from a stylesheet link before paint
for saved Crystal choices and on demand for later changes. Only `classic.css`
belongs in the initial stylesheet.

Fonts are theme tokens defined in `src/styles/app-bootstrap.css`:
`--sf-font-display` (Fraunces / Kanit), `--sf-font-body` (Geist / Nunito) and
`--sf-font-mono` (Geist Mono in both families). Tailwind's `--font-sans` and
`--font-mono` point at the body and mono tokens, and `font-serif` / `font-display`
at the display token. The classic body stack starts with `Geist Variable`, the name
registered by the self-hosted Fontsource import: requesting only `Geist` silently
selects different system fonts across Linux versions. Fraunces ships an upright and
an italic face (`src/styles/themes/fraunces-fonts.css`).

The tier rims are the existing `--sf-rim-new` (bud), `--sf-rim-learning` (bloom)
and `--sf-gold-rim` (star). Ink & Paper has no bud or bloom rim (`none`), as on the
boards.

Crystal keeps its Canvas crimson fill for `--sf-brand`, but uses `#04060c` for
`--sf-on-brand` and `--sf-on-brand-hover`: Canvas `primaryText` is white, which
does not meet AA contrast for the app's 12px button text on that crimson.

Translucent variants of a token are written as
`color-mix(in srgb, var(--sf-<token>) <alpha>%, transparent)`, which renders the same
colour as the `rgb(<r> <g> <b> / <alpha>)` literal it replaces.

A token marked "not drawn" for a family has no board value there: it aliases the
nearest token so every family and mode defines the same set.
