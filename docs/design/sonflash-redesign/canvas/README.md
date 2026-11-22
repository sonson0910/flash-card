# SonFlash design canvas

Captured on 2026-09-24 from the approved session canvas at
`/tmp/claude-1000/-mnt-Projects-startup-flash-card/5e520499-5fed-45db-bd78-9a938ff7db56/scratchpad/canvas/`.
The original archive is `~/Downloads/sonflash-codex-handoff/canvas-full-backup-20260924.tgz`.
This directory is the design reference; application UI lives under `src/` at the repository root.

## Sources and rebuild

- `src/*.dc.html` are the editable component boards (112 from the original capture, 116 after the phase-14 additions). `src/boards-*.py` declare the comparison boards and their sizes.
- `src/tokens.js` defines the classic `sfTokens`; `src/anime-tokens.js` defines the Crystal Star `nkTokens` and the Lumi paths. Edit these sources, then regenerate `tokens.json`.
- `assets/blob/MAP.txt` maps the original canvas blob IDs to local files. All source and seed references now use relative `../assets/blob/...` paths. The ten transparent Lumi WebP files used by the app are also copied to `src/assets/lumi/` at the repository root.
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

## Crystal Star shared tokens and partials

Every Crystal Star board inlines `src/anime-tokens.js` and the partials in `src/partials.html`, so a change there changes all of them: re-render every reference with `--force` afterwards. The rules below keep both themes readable.

- Display text on the page or on a panel uses `t.metal` (white metal on Starry Night, navy-to-crimson ink on Prism Day). Gold reward numbers use `t.metalGold`, emphasis words inside a headline use `t.metalEm`. `t.metalHot` is white metal for text that sits fully on an opaque crimson fill in both themes. Do not hardcode the white gradient: it disappears on the pale Prism Day page.
- Tier chips smaller than about 30 px use `t.tier.<tier>.flat` with a `t.tier.<tier>.flatShadow` text shadow. `t.tier.<tier>.rim` is for large frames only.
- `t.easy` is gold in both themes; its label colour is `t.easyInk`. The Prism Day `t.scrim` is a blue-to-rose dusk veil, not a grey film.
- The `ABG` partial draws three background flares. A board hides one that would sit under its copy by setting `--nk-flare1`, `--nk-flare2` or `--nk-flare3` to `none` on its root element.
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
