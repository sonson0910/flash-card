# SonFlash design canvas

Captured on 2026-09-24 from the approved session canvas at
`/tmp/claude-1000/-mnt-Projects-startup-flash-card/5e520499-5fed-45db-bd78-9a938ff7db56/scratchpad/canvas/`.
The original archive is `~/Downloads/sonflash-codex-handoff/canvas-full-backup-20260924.tgz`.
This directory is the design reference; application UI lives under `src/` at the repository root.

## Sources and rebuild

- `src/*.dc.html` are the editable component boards (112 from the original capture, 116 after the phase-14 additions). `src/boards-*.py` declare the comparison boards and their sizes.
- `src/tokens.js` defines the classic `sfTokens`; `src/anime-tokens.js` defines the Crystal Star `nkTokens` and the Lumi paths. Edit these sources, then regenerate `tokens.json`.
- `assets/blob/MAP.txt` maps the original canvas blob IDs to local files. All source and seed references now use relative `../assets/blob/...` paths. The app art is the source of truth: the 14 Lumi WebP files in `assets/blob/` are copies of `src/assets/lumi/` at the repository root, and the two painted backdrops are copies of `public/art/crystal-nebula-{dark,light}.webp`. Copy them again from there when the app art changes.
- `seed/` contains the baseline Canvas runtime, index, and ten archived artboards needed by the original builder and its index. `build.py` copies these into `project/` before compiling. `project/` is generated and ignored by Git.
- `reference/` contains one dark and one light PNG for each original source component, plus one comparison PNG for each original comparison or archived board. A comparison PNG shows its paired themes in one artboard. The original 219 artboards produced 331 reference PNGs.

Phase 14 adds four editable auth/upload sources (`AuthStates`, `AnimeAuthStates`,
`UploadStates`, and `AnimeUploadStates`) and 106 generated comparison boards in
`src/boards-phase14-workflows.py`. The current builder indexes 116 source
components and 329 artboards. Their 114 reference PNGs bring `reference/` to 445 files.

Run from the repository root:

```sh
python3 docs/design/sonflash-redesign/canvas/build.py --check
python3 docs/design/sonflash-redesign/canvas/build.py
node docs/design/sonflash-redesign/canvas/generate-tokens.mjs
node docs/design/sonflash-redesign/canvas/generate-tokens.mjs --check
node docs/design/sonflash-redesign/canvas/render-reference.mjs
node docs/design/sonflash-redesign/canvas/render-reference.mjs --check
```

The reference renderer uses Playwright Chromium, each board's fixed viewport, and reduced motion. It serves local Canvas files through Playwright request interception without opening a localhost port. Use `--board=AnimeToday` to render or check one board; use `--force` to replace existing PNGs after a source change. The reference files are review artifacts, not web bundle assets. Google Fonts in the source canvas still require network access for exact typography; the application font implementation belongs to the theme work.

The renderer needs the Playwright browser build pinned by the repository. On a machine whose host cache holds a different build, run it inside the e2e runner image, which carries the pinned build (mount the repository and a Node 22 install, then call the same commands):

```sh
docker run --rm --init --ipc=host --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD:$PWD" -w "$PWD" -v "$NODE22_DIR:/opt/node22:ro" sonflash-e2e-runner:1.64.1-noble \
  bash -c 'export PATH=/opt/node22/bin:$PATH; node docs/design/sonflash-redesign/canvas/render-reference.mjs --force'
```

## Classic motion system

Midnight Aurora (dark) and Ink & Paper (light) share one markup, so a Classic board never names a look-specific motion class. It asks for a role through `t.fx.*` in `src/tokens.js`, and each look answers with its own signature: Aurora resolves out of blur and glows on touch, Ink & Paper lays ink and presses like a stamp. The classes themselves live in the `SHARED_CSS` string of `build.py`, which writes `shared.css`.

| Role | Midnight Aurora | Ink & Paper | Use |
| --- | --- | --- | --- |
| `fx.enter`, `enter2`, `enter3`, `enter4` | `au-in` … `au-in-4` | `ip-in` … `ip-in-4` | Blocks arriving in reading order |
| `fx.title` | `au-in` | `ip-ink` | The one headline of a screen |
| `fx.stagger` | `au-stagger` | `ip-stagger` | A list or grid whose children arrive one after another |
| `fx.dialog` | `au-dialog` | `ip-dialog` | A dialog panel; `DLGOPEN` applies it with `sf-scrim` |
| `fx.lift` | `au-lift` | `ip-lift` | A card that can be opened |
| `fx.press` | `au-press` | `ip-press` | Any button or link |
| `fx.pressDanger` | `au-press-danger` | `ip-press` | A destructive button, so it does not glow in the accent |
| `fx.glint` | `au-glint` | none | The one hero progress bar of a screen |
| `fx.correct` | `au-correct` | `ip-correct` | A right answer; add `sf-late` to play it after the answer settles |
| `fx.reward` | `au-pop` | `ip-stamp` | XP, combo and badge moments |

Look-neutral classes are written directly: `sf-scrim`, `sf-sheet-r`, `sf-sheet-b` and `sf-toast` for overlays; `sf-ease` for state changes; `sf-tick` for a number that changed; `sf-bars`, `sf-cells`, `sf-grow`, `sf-draw` and `sf-draw-to` for data (`sf-draw` and `sf-draw-to` need `pathLength="1"` on the shape, and `sf-draw-to` needs the resting `stroke-dashoffset` inline); `sf-drain` for an undo countdown; `sf-shake` for a wrong answer; `sf-focus` for a keyboard focus ring.

Rules that keep the boards calm and the stills stable:

- Entrances use the individual `translate` property and fill backwards, so they pin nothing and the same element can still lift or press. The older `sf-rise`, `sf-deal-*`, `sf-pop`, `au-reveal*` and `nk-*` entrances end on `transform:none` and hold it: never put one on an element that has its own `transform` or a hover transform; wrap it instead.
- `fx.stagger` sets `animation` on every child, so it overrides `sf-shake` or `fx.correct` on that child. Lists whose items give answer feedback do not stagger.
- One loop per screen at most, and only for something live (a recording dot, a timer, a sound wave). A call to action does not pulse.
- Nothing moves inside a card while the learner is reading it.
- `fx.glint` sets `position:relative` and `overflow:hidden`; use it on a bar fill, not on an element whose shadow must show.
- One reduced-motion rule switches all of these off. References are rendered with reduced motion, so a motion-only change leaves every still identical.

## Crystal Star shared tokens and partials

Every Crystal Star board inlines `src/anime-tokens.js` and the partials in `src/partials.html`, so a change there changes all of them: re-render every reference with `--force` afterwards. The rules below keep both themes readable.

- Display text on the page or on a panel uses `t.metal` (white metal on Starry Night, navy-to-crimson ink on Prism Day). Gold reward numbers use `t.metalGold`, emphasis words inside a headline use `t.metalEm`. `t.metalHot` is white metal for text that sits fully on an opaque crimson fill in both themes. Do not hardcode the white gradient: it disappears on the pale Prism Day page.
- Tier chips smaller than about 30 px use `t.tier.<tier>.flat` with a `t.tier.<tier>.flatShadow` text shadow. `t.tier.<tier>.rim` is for large frames only.
- `t.easy` is gold in both themes; its label colour is `t.easyInk`. The Prism Day `t.scrim` is a blue-to-rose dusk veil, not a grey film.
- Board tokens carry the values the app ships, including the ones changed for WCAG AA or by an owner decision: light `t.text3` `#58698a` and `t.holoText` `#08708a` (AA), dark `t.text3` `#9aa5bc`, and the near-opaque `t.panelWork` in both themes (owner decision 2026-11-24: panels on signed-in screens read as solid on the painted backdrop). Boards of signed-in screens draw their panels with `t.panelWork`; the landing page, onboarding, dialogs, menus, sign-in and the extension keep `t.panel`, which stays equal to the app's root `--sf-surface-glass`. The sources are `public/theme-crystal.css` and the workspace panel values in `src/styles/shell.css`. Deviations the app makes for technical reasons are not copied.
- The backdrop is the painted nebula. `t.space` is the painting (`../assets/blob/crystal-nebula-{dark,light}.webp`, cover) under a top-down tint, and `t.spaceVeil` is the radial veil that calms the centre so panels and copy sit on a quiet field while the painting shows at the edges. Both are the `--sf-space` and `--sf-space-veil` values in `public/theme-crystal.css`. A board that draws its own backdrop uses `background: {{t.spaceVeil}}, {{t.space}}, {{t.pageBg}}` and must not add beams or flares the app does not draw: the painting already holds them.
- The `ABG` partial follows what the app keeps over the painting. Flags on the board's `bg` data:
  - default: veil + painting + the twinkling `nk-starfield`, which is the signed-in app shell.
  - `bg.art: true`: the full painting with no veil and no starfield, which is the landing hero, the practice recap and the reveal. Pair it with `wings: false` unless the app screen draws its own shards.
  - `bg.flares: true` (default off): the two light beams and three lens flares, which only onboarding keeps in the app. A board hides one flare that would sit under its copy by setting `--nk-flare1`, `--nk-flare2` or `--nk-flare3` to `none` on its root element.
  - `bg.wings` (default on): the two corner crystal wings, which the app keeps on lesson, placement, the session bridge, onboarding and the review session, and not on Today.
- Text that sits directly on the painting, not on a panel, takes `text-shadow: {{t.onArtHalo}}` (the app's `--sf-on-art-halo`): page kickers and eyebrows, page subtitles and ledes, counts, back links, footer and keyboard hints, text-only links and buttons, inactive rail and segmented items, and Lumi's line when it has no bubble panel.
- Lumi has 14 poses in `t.lumi`: hero, idle, happy, hint, oops, proud, chibi, sleepy, thinking, sad, cheer, study, wave and focus. They are the redrawn app art from `src/assets/lumi/`; `assets/blob/MAP.txt` records each source.
- The `MASCOT` partial puts Lumi's glow on a wrapper around the masked sprite. A `drop-shadow` on the masked image itself is cut by the mask and shows as a box on dark panels.
- Mastery is written with the tier names Bud, Bloom and Star (labels New, Learning, Mastered), never letter grades. The learner's own level is Foundation, Core or Advanced; a CEFR tag on a word or card is card data and stays.

## Crystal Star copy audit

The original Anime and Lang board sources contained the following banned terms. The source and generated boards now have **zero unresolved exact-word hits** for `rank`, `ranks`, `kill`, `rift`, `battle`, `campaign`, `season`, `boss`, `duel`, `clash`, `strike`, `forge`, and `raid`.

| Original use | Replacement | Source |
|---|---|---|
| Rank trial; rank ladder; rank in placement caption | Level check; learning path; level | `boards-anime-lessons.py`, `boards-lang-2-onboarding.py` |
| Syllable forge; reading strike; tone duel; gender clash | Syllable builder; reading check; tone match; der / die / das sort | `boards-lang-4-practice.py` |
| `ranks` data identifier | `levelCards` | `AnimeLangOnboarding.dc.html` |
| `rank`, `rankColor` data identifiers | `place`, `placeColor` | `AnimeLeague.dc.html` |
| `rift` icon key | `trail` | `AnimeAchievements.dc.html` |
| Rank label | Study pace | `AchievementsScreen.dc.html` |

The archived comparison boards document earlier design explorations. Their presence is not approval to implement checkout, referral rewards, leagues, contextual paywalls, or game language in the application. The pilot decisions and the UI handoff govern application scope.
