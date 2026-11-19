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
| `--sf-book-terracotta`, `-ink`, `-ochre`, `-moss`, `-violet`, `-teal`, `--sf-book-foil` | light: PathsScreen `lightCloth` and title foil; dark: `darkHue` tints and `textStrong` | AnimePaths `hue.*.tint` (crimson, cyan, gold, navy, pink, holo) and `textStrong` |
| `--nk-chamfer`, `--nk-chamfer-sm`, `--nk-snap`, `--nk-stars`, `--nk-wing-opacity` | normalized defaults | `chamfer`, `chamferSm`, `snap`, `stars`, `wingOpacity` |

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
