# UI redesign track decision log

## 2026-09-24 — Design source capture

**Status:** complete; awaiting review before the i18n foundation.

**Decisions and scope**

- Keep the approved Canvas sources under `docs/design/sonflash-redesign/canvas/`. The generated `project/` directory stays ignored; `seed/` preserves the Canvas runtime, index, and archived boards required for a reproducible build.
- Generate `tokens.json` directly from the classic and Crystal Star token functions. Keep the four dark/light exports as design parity data, not application runtime code.
- Keep all 219 original artboards as design references, including older explorations. The pilot decisions still exclude checkout, league, referral rewards, contextual paywalls, and game copy from application implementation.
- Preserve the ten transparent Lumi WebP poses in `src/assets/lumi/`. Canvas artwork uses local `assets/blob/` paths, so references no longer depend on ephemeral blob URLs.
- Replace the banned Crystal Star terms in Canvas source and board captions; the mapping and the zero-hit audit are recorded in the Canvas README.

**Verification**

- `build.py --check`: 112 components; full build: 219 artboards.
- `generate-tokens.mjs --check`: pass; classic dark/light each have 91 keys, Crystal Star dark/light each have 60 keys.
- `render-reference.mjs --check`: 331/331 PNGs pass signature and dimension checks. Visually inspected `AnimeToday` light, `PairAnimeToday` and `Main` references.
- Local asset audit: 53 references resolve; zero `/_blob/` references in Canvas source or seed. Banned-word audit: zero unresolved exact-word hits in Anime/Lang sources and board captions.
- `npm run verify:core`: pass (203 app test files / 1,739 tests; 26 Functions test files / 264 tests; 8 emulator integration files / 35 tests). `npm run build`: pass. `npm run verify:bundle`: pass (initial JS 65,044 B gzip; initial CSS 28,403 B gzip). No extension files changed, so `extension:check` was not run.
- Axe on individual `Review` Canvas board found an unnamed progressbar and missing page heading. Paired comparison boards also report duplicate landmarks because they show two pages together. These are design-source findings to address when implementing the corresponding app screens; no application UI changed in this capture.

**Review notes**

- Reference PNGs occupy about 324 MB in Git. They are documentation assets and do not enter the web bundle.
- No deploy or Firebase change was made.
