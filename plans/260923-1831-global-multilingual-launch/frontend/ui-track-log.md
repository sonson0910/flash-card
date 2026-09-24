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

## 2026-09-24 — Theme system, fonts and Lumi

**Status:** complete; independent closure review passed.

**Decisions and scope**

- Implement the four combinations present in the approved Canvas tokens: classic dark/light and Crystal Star dark/light. The handoff's “six token sets” wording conflicts with the four actual exports in `tokens.json`; no undocumented variants were invented.
- Load `public/theme-crystal.css` only for Crystal, using a pre-paint stylesheet link for saved choices and an on-demand link for live switching. Keep Crystal ornaments and Kanit/Nunito font CSS lazy. Split Flashcard and Zen effect CSS into the card's lazy chunk to stay inside the initial CSS budget.
- Preserve the legacy `lingoflash_theme` key and synchronize it with the new family preference, the header toggle, storage events and the system color scheme when no choice exists. Update the production and staging pre-paint CSP hashes.
- Self-host sliced Fraunces, Geist Mono, Kanit and Nunito fonts; keep the older display fonts until landing redesign. The on-demand CJK loader uses language-specific WOFF2 subsets and `unicode-range`.
- Use ink text on the Canvas crimson button because white text failed WCAG AA at small sizes. Keep Canvas shadow lists in `--sf-panel-shadow` and a shadow color in the legacy `--sf-shadow` consumed by existing card effects. Keep Crystal stars and wings tied to defined tokens, and reject banned game terms in English and Vietnamese, including plural forms.
- Preserve the pilot rule that guests cannot report cards. AI disclosure stays visible on both standard and Zen card backs; signed-in report visibility remains covered by component tests. Exclude inactive `.worktrees` from Vite file watching after the catalog CLI tests hit the host's inotify limit.

**Verification**

- Theme preference, token parity, contrast, asset loading, Lumi and banned-word unit tests: pass. Chromium theme tests cover reload, cross-tab sync, first paint, all four desktop/mobile combinations and automated axe checks.
- `npm run verify:core`: pass on final source (217 app test files / 1,815 tests; 27 Functions files / 269 passed and 38 skipped; 2 Rules files / 64 tests; 8 emulator integration files / 38 tests).
- `npm run build` and `npm run verify:bundle`: pass on the review fixes. Initial JS 70,904/71,000 B gzip; initial CSS 28,119/29,500 B gzip. Crystal token, ornament and font CSS stay out of the classic startup asset graph.
- Combined Chromium theme, flashcard, motion and accessibility E2E: 34/34 passed on final source. This covers first paint, no Crystal request in Classic, live cross-tab theme CSS, all four desktop/mobile combinations, axe and non-`none` shared glass shadows.

**Review notes**

- The landing still uses its previous layout until the optional landing redesign. This phase establishes the theme tokens and assets; the subsequent screen phases apply them to each surface.
- Independent closure review found no remaining blockers after the computed-shadow, lazy-Crystal, rapid-switch and localized-copy fixes. Initial JavaScript has 96 B headroom, so later phases must stay lazy.
- No deploy was made.

## 2026-09-24 — Shell redesign

**Status:** implementation complete; independent review passed.

**Decisions and scope**

- Rebuild the desktop header and mobile navigation with the existing theme tokens. Keep the established Today, Paths, Vocabulary and Progress destinations, 44 px controls, focus behavior and reduced-motion treatment. The signed-in course slot displays the current English ← Tiếng Việt label and collapses to its own row below 480 px; signed-out users see no course placeholder.
- Put the language and four-combination theme menus in the header. Locale, family and mode changes apply without a reload and persist through the existing providers. The quick theme control flips light/dark within the selected family. Menus support Arrow, Home, End and Escape keyboard behavior.
- Move shell labels, status copy, notifications, loading fallbacks, accessible view headings and recovery copy into the eager shell catalog. Keep the raw sync signature for notification dismissal, and preserve provider errors in the recovery panel. The root error boundary reads the global catalog directly because it encloses the locale provider; it falls back to readable English if catalog loading itself fails. Its Crystal Lumi image is a static asset so recovery does not depend on another JavaScript chunk.
- Move the runtime-error presentation to an on-demand chunk to keep the unchanged initial JavaScript budget. The boundary keeps an immediate retry control while that presentation loads. Feature-specific strings in `AppOverlays` remain with their owning later screen phases.

**Verification**

- `npm run i18n:check`: pass; extraction stable with 98 shell messages, complete en/vi coverage and pseudo catalog generation. Migrated-file string guard: 21 tests pass.
- Focused shell and recovery tests: 58 passed before the final root recovery test; the final root recovery test passes 2/2. Chromium Playwright shell, accessibility, touch-target and focus suite: 27/27 passed. It covers the four actual Canvas theme combinations at 1440 and 390 px, 360 px pseudo-locale control bounds, live locale/theme switching, reduced motion and axe checks. Screenshots were compared with the Canvas shell/system references; Today and other feature interiors remain for their assigned phases.
- `npm run build` and `npm run verify:bundle`: pass. Initial JavaScript 70,899/71,000 B gzip; initial CSS 28,246/29,500 B gzip. `npm run verify:core`: pass on the final source (221 app files / 1,839 tests; Functions 269 passed and 38 skipped; Rules 64; emulator integration 38).

**Review notes**

- Independent review found and closed root-recovery, mobile control, localization and menu keyboard gaps. The final root recovery path has no lazy code dependency.
- Four theme combinations are implemented because the approved Canvas exports four; no undocumented fifth or sixth variant was added. Japanese remains disabled in this pilot track as the handoff requires.
- No deploy or Firebase change was made.
