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

## 2026-09-24 — Appearance settings

**Status:** complete; independent closure review passed after the delayed-focus fix.

**Decisions and scope**

- Add a lazy `settings` view reachable from both header menus, including the mobile management menu. Move the existing sound toggle there. The three theme cards select Midnight Aurora, Ink & Paper, or Crystal Star; Crystal has Starry Night and Prism Day controls. The header quick toggle still changes only dark/light within its current family.
- Persist theme family and mode in the existing keys, with a new follow-system intent that reacts to device color-scheme changes. Manual mode choices turn follow-system off. Remove the duplicated navigation theme state so the theme provider owns one consistent preference.
- Persist Lumi and reduced-motion choices locally. Lumi can be hidden without removing a control; reduced motion still honors the OS preference when the user toggle is off. Browser pre-paint reads these choices; production and generated staging CSP hashes match the revised script.
- The reduced UI-first handoff permits local persistence and forbids Firebase SDK/Functions/Rules work. The larger phase file's account-sync clause awaits a backend settings contract for follow-system, Lumi, motion and sound; the planned `SettingsDto` currently represents only `themeFamily` and `themeMode` for appearance. No partial account sync was introduced.
- Keep the Settings screen, its catalog, preview CSS and Lumi asset in on-demand chunks. A settings heading takes focus after a delayed lazy load, as the existing Today and Paths screens do.

**Verification**

- Focused theme, navigation, settings and motion tests: 39/39 passed before the final delayed-focus fix. The migrated-string scanner and Settings tests passed 25/25 after the decorative mark fix. `npm run i18n:check`: pass, stable extraction with 24 Settings messages and complete en/vi translations.
- `npm run verify:core`: pass on the integrated source (224 application test files / 1,847 tests; Functions 269 passed and 38 skipped; Rules 64; emulator integrations 38). `npm run build` and `npm run verify:bundle`: pass on the latest source; initial JavaScript 70,995/71,000 B gzip, initial CSS 28,584/29,500 B gzip. Crystal CSS and fonts remain outside classic startup.
- Chromium Playwright appearance/theme suite: 28/28 passed across four actual theme combinations at 1440 and 390 px, persistence, system switching, mobile navigation and axe. A separate test delayed the Settings chunk by 900 ms and confirmed heading focus after navigation. `git diff --check`: pass. No extension files changed, so `extension:check` was not run.

**Review notes**

- Independent review found the lazy-load focus gap, verified its 900 ms delayed-chunk E2E fix, and found no remaining blocker. It accepted local-only persistence under the reduced-track handoff.
- Initial JavaScript is within its fixed budget but has only 5 B of headroom. Subsequent screen phases must stay lazy or remove eager code before adding any.
- No deploy was made.

## 2026-09-24 — Flashcard and study redesign

**Status:** complete; independent closure review passed.

**Decisions and scope**

- Split the card into front, back, headword and effects boundaries. `CardEffectsLayer` owns the category aura and the single guarded animation-frame pointer path for tilt, spotlight and holo. The parent keeps flip state, dialogs and pilot actions. All seven existing effects remain observable; the tier rim and holo styling use the four approved theme combinations.
- Render stored words without forced capitalization. Scope `lang` to target-language word, phonetic, syllables and examples, and to translation-language meanings and recall choices; keep interface labels in the UI locale. Speech synthesis and recognition call the shared `speechLocaleFor(card)` helper, which returns `en-US` until language packs arrive.
- Extract card and Study copy to the `components` and `practice` catalogs with complete English/Vietnamese translations and pseudo-locale expansion. Load pseudo expansion outside the initial chunk to preserve the bundle budget. Keep the existing AI disclosure, guest report restriction, edit, bookmark, gestures and review settlement behavior.
- Use token-based standard and Zen surfaces, tier labels and review controls. Preserve Zen's dark glass in light themes, place Zen metadata below persistent corner controls, and use accessible colors for its phonetic and syllable text. Crystal Lumi feedback follows a committed rating and respects motion and Lumi preferences. Reduced-motion faces have no residual transform.

**Verification**

- Effect guards were green before and after extraction. Final Chromium card/Study/pilot/visual suite: 39/39 passed, including standard and Zen front/back at 1440 and 390 px in all four themes, axe serious/critical checks, locale switching, reduced motion, and edit/bookmark/review. Firefox and WebKit effect guards: 4/4 passed. Final visual review found no Zen overlap or clipping.
- Focused Flashcard/Study/recall tests: 56/56 passed. `npm run i18n:check`, `npm run build`, `npm run verify:bundle` and `git diff --check`: pass. Final initial JavaScript is 70,874/71,000 B gzip; initial CSS is 28,152/29,500 B gzip.
- `npm run verify:core`: pass on final source (224 application files / 1,864 tests; Functions 269 passed and 38 intentionally skipped; Rules 64; emulator integration 38). The first full run had one catalog CLI test exit nonzero; the CLI and focused test passed on immediate rerun, and the second full gate passed without changes to that test.

**Review notes**

- Independent review found and closed the Zen surface, pilot selector, language metadata, static copy and effects-boundary issues; no high or medium findings remain. Shared protected-function errors still supply their existing English diagnostic message when present; that shared contract is outside this card presentation change.
- No deploy or Firebase change was made.

## 2026-09-24 — Daily learning redesign

**Status:** implementation complete; independent closure review passed.

**Decisions and scope**

- Restyle Today, Lesson, Placement, the streak dialog and session recap for the four approved theme combinations at desktop and 390 px. Keep the existing daily plan, exercise reducer, placement diagnosis, review settlement, keyboard and IME behavior. The active course label uses the current English ← Vietnamese profile until course context exists.
- Show the streak chip only when the stored streak is backed by positive XP activity for the current local day. This avoids displaying a fabricated streak from the gamification read model. Recap numbers use the existing locale-aware `CountUp`; Crystal shows hero, sleepy and proud Lumi in their respective states and honors the saved Lumi and motion preferences.
- Keep target-language `lang` metadata on prompts, options, tokens and answer input. Extract the screen and recap copy into the `today` and `practice` catalogs with ICU counts and complete en/vi translations. Japanese and Korean remain disabled UI locales for this pilot; tests cover their target-language metadata without claiming translated UI catalogs.
- The Canvas bridge board assumes a six-day streak, combo multiplier and XP reward, while the current pilot has no sequential review/new-word/match bridge state. Those invented claims conflict with the pilot decisions. The real Today primary action continues into the existing lesson flow; no fake bridge or reward was added.
- Narrow the production catalog import glob to en/vi; pseudo-locale messages continue to derive from English at runtime. This keeps the new screen catalogs inside the unchanged bundle limits.

**Verification**

- `npm run i18n:check`: pass; extraction stable with 165 `today` and 34 `practice` messages, complete en/vi coverage. Focused Today/recap tests: 26/26 passed on final source. `npm run verify:core`: pass on final source, including Functions, 64 Rules tests and 38 emulator integration tests.
- `npm run build`, `npm run verify:bundle` and `git diff --check`: pass. Initial JS 70,779/71,000 B gzip; initial CSS 28,456/29,500 B gzip; total JS 857,209/860,000 B gzip.
- Chromium daily-learning, recap and existing pilot-flow suite: 21/21 passed on final build. Forty committed screenshot baselines cover Today, streak, Lesson, Placement and recap in the four themes at desktop and 390 px; the tests also check serious/critical axe findings, horizontal clipping and reduced motion. Representative screenshots were compared with the approved Canvas boards.

**Review notes**

- Independent review found and closed a missing empty-day sleepy Lumi, a streak read-model false positive, missing screenshot baselines and a clipped recap Lumi. The final Crystal recap baseline shows the full proud pose inside the modal. No high or medium findings remain.
- No deploy or Firebase change was made.

## 2026-09-24 — Paths, progress and achievements redesign

**Status:** complete; independent closure review passed.

**Decisions and scope**

- Restyle Paths, Progress, the activity heatmap, native charts and the six existing achievements for the four approved theme combinations. Paths uses only an installed reviewed release or the existing personal-library fallback; no draft vocabulary or fictional league, reward or release is exposed. Track and tier labels use stable catalog IDs with English/Vietnamese messages. The reduced Appearance phase did not supply course context, so Progress continues to show the existing aggregate learning history.
- Derive Progress numbers from real review and XP data. Keep saved totals visible while a refresh is in flight and announce that state. Format heatmap month and weekday labels with the UI locale and place the first weekday according to locale, with the documented fallback. Native chart colors use theme tokens; memory statuses and accessible chart tables translate with the UI. Crystal Star achievements retain their actual thresholds and use Bud, Bloom and Star wording.
- Keep availability copy as stable message keys and translate it at render time. Live EN→VI switching updates personal and ready statuses without restarting a catalog download. Storage blocked/timeout reasons have specific catalog messages. The reviewed-release visual fixture exists only in E2E tests; the deployed app still requires a real reviewed release.
- Use Terser for production minification to keep the fixed initial and total JavaScript budgets after the screen work. Sort Lingui extraction by message ID so identical English source strings do not reorder catalogs unpredictably. Existing message translations were preserved; no new UI locale was enabled.

**Verification**

- `npm run i18n:check`: pass, stable extraction and complete en/vi coverage (111 catalog and 55 progress messages). Focused Paths, Progress, charts, heatmap and achievements tests passed; the live EN→VI status and storage blocked/timeout paths have regression coverage.
- `npm run verify:core`: pass on the final source (224 application files / 1,894 tests; Functions 269 passed and 38 intentionally skipped; Rules 64; emulator integrations 38). `npm run build`, `npm run verify:bundle` and `git diff --check`: pass. Initial JS 69,871/71,000 B gzip; initial CSS 28,064/29,500 B gzip; total JS 846,084/860,000 B gzip.
- Chromium Paths/Progress visual suite: 16/16 passed on the latest build, with 24 screenshot baselines across four themes at desktop and 390 px. It covers personal fallback, a deterministic reviewed-ready fixture, Progress, serious/critical axe findings, horizontal containment and reduced motion. Existing catalog workflow E2E: 3/3 passed, including a live EN→VI switch without reload. Screenshots were compared with the approved Paths and Progress Canvas references.

**Review notes**

- Independent review identified and verified fixes for memory chart localization and token colors, reviewed-path tier copy, a 44 px category control, missing reviewed-catalog visual coverage, live locale status updates and catalog storage error copy. No high or medium findings remain.
- No deploy or Firebase change was made.
