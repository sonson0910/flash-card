# SonFlash design canvas

Captured on 2026-09-24 from the approved session canvas at
`/tmp/claude-1000/-mnt-Projects-startup-flash-card/5e520499-5fed-45db-bd78-9a938ff7db56/scratchpad/canvas/`.
The original archive is `~/Downloads/sonflash-codex-handoff/canvas-full-backup-20260924.tgz`.
This directory is the design reference; application UI lives under `src/` at the repository root.

## Sources and rebuild

- `src/*.dc.html` are the 112 editable component boards. `src/boards-*.py` declare the comparison boards and their sizes.
- `src/tokens.js` defines the classic `sfTokens`; `src/anime-tokens.js` defines the Crystal Star `nkTokens` and the Lumi paths. Edit these sources, then regenerate `tokens.json`.
- `assets/blob/MAP.txt` maps the original canvas blob IDs to local files. All source and seed references now use relative `../assets/blob/...` paths. The ten transparent Lumi WebP files used by the app are also copied to `src/assets/lumi/` at the repository root.
- `seed/` contains the baseline Canvas runtime, index, and ten archived artboards needed by the original builder and its index. `build.py` copies these into `project/` before compiling. `project/` is generated and ignored by Git.
- `reference/` contains one dark and one light PNG for each source component, plus one comparison PNG for each generated comparison or archived board. A comparison PNG shows its paired themes in one artboard. The 219 artboards produce 331 reference PNGs.

Run from the repository root:

```sh
python3 docs/design/sonflash-redesign/canvas/build.py --check
python3 docs/design/sonflash-redesign/canvas/build.py
node docs/design/sonflash-redesign/canvas/generate-tokens.mjs
node docs/design/sonflash-redesign/canvas/generate-tokens.mjs --check
node docs/design/sonflash-redesign/canvas/render-reference.mjs
node docs/design/sonflash-redesign/canvas/render-reference.mjs --check
```

The reference renderer uses Playwright Chromium, each board's fixed viewport, and reduced motion. Use `--board=AnimeToday` to render or check one board; use `--force` to replace existing PNGs after a source change. The reference files are review artifacts, not web bundle assets. Google Fonts in the source canvas still require network access for exact typography; the application font implementation belongs to the theme work.

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
