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
| `--sf-heat-*`, `--sf-confetti-*` | `heat[*]`, `confetti[*]` | Crystal tier soft colors and `crimson` / `holo` / `gold` / `flare` / `pink` |
| `--nk-chamfer`, `--nk-chamfer-sm`, `--nk-snap`, `--nk-stars`, `--nk-wing-opacity` | normalized defaults | `chamfer`, `chamferSm`, `snap`, `stars`, `wingOpacity` |

`--sf-grain-*` has no Crystal source equivalent, so Crystal uses a neutral no-grain
fallback. `public/theme-crystal.css` is loaded from a stylesheet link before paint
for saved Crystal choices and on demand for later changes. Only `classic.css`
belongs in the initial stylesheet.

Body text uses the shared `--font-sans` token from `src/index.css`. Its first
family is `Geist Variable`, the name registered by the existing self-hosted
Fontsource import. Keep shell utilities, Landing and Settings on that token:
requesting only `Geist` silently selects different system fonts across Linux
versions. Display faces retain their theme-specific tokens.

Crystal keeps its Canvas crimson fill for `--sf-brand`, but uses `#04060c` for
`--sf-on-brand` and `--sf-on-brand-hover`: Canvas `primaryText` is white, which
does not meet AA contrast for the app's 12px button text on that crimson.
