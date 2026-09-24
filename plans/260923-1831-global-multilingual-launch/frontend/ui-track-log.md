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

## 2026-09-24 — i18n foundation

**Status:** implementation complete; moving to the next step under the owner's updated instruction to finish the whole track.

**Decisions and scope**

- Chose Lingui 5.9.5 after measuring the same real landing strings against react-i18next plus ICU. The landing chunk added 3,357 B gzip with Lingui versus 25,614 B with the other candidate; measurements are in the phase specification.
- Ship only English and Vietnamese UI catalogs. Other locale metadata remains disabled until the multilingual rollout. Stable message IDs, area catalogs, extraction, strict compilation, and a migrated-file string scanner are in place.
- Resolve locale from QA query, stored choice, profile, browser, then English. Pseudo localization is limited to local and preview hosts. The pre-paint script sets `lang`, `dir`, dark mode, and theme family before React; production and staging CSP hashes follow that script.
- Keep persisted XP date keys in the existing `en-US` format while UI number formatting follows the active locale. The integrated spike revealed a mixed-language landing when Vietnamese auto-selection was enabled, so the whole landing surface now has English and Vietnamese messages. Later screen redesign steps still own their own copy extraction.
- Refresh the existing library keyboard test's menu order to match privacy, terms, and account controls added before this track. No menu behavior changed.

**Verification**

- `npm run i18n:check`: pass; 11 area catalogs for each of en, vi, and pseudo, with 49 translated landing messages.
- Focused Vitest for locale resolution, formatters, pseudo expansion, CSP, composition, CountUp, and persisted XP key: pass.
- Playwright Chromium: 8/8 targeted landing, locale, storage sync, accessibility, and performance tests pass. Browser checks confirmed `lang=vi` with Vietnamese CTA and `lang=en-XA` with expanded pseudo CTA; cross-tab locale change updates without reload.
- `npm run verify:core`: pass on final source (207 app test files / 1,752 tests; 26 Functions test files / 264 tests; 2 rules files / 64 tests; 8 emulator integration files / 35 tests). `npm run build`, `npm run verify:secrets`, and `npm run verify:bundle`: pass. Integrated initial JS is 70,200 B gzip (limit 71,000 B); initial CSS is 28,408 B gzip (limit 29,500 B).

**Review notes**

- The integrated JS has 800 B headroom. Subsequent screen work must preserve the initial bundle gate; Crystal Star CSS and fonts remain lazy.
- No deploy was made.
