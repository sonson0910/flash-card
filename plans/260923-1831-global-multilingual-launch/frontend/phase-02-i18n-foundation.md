# Phase 02: i18n foundation

Effort: 3d. Blocked by: none. Backend: not needed.

## Context

- No i18n library; strings are hardcoded (about 265 JSX text nodes and 141 attribute literals).
- `<html lang="en">` is fixed (`index.html:2`); the pre-paint theme script (`index.html:8-14`) is pinned by SHA-256 in the `firebase.json` CSP, and `deployGateSource.test.ts:87-94` recomputes inline-script hashes and fails on drift.
- Initial JS budget headroom is about 6 KB gzip (`scripts/bundle-budget.mjs:6-11`).
- `toLocaleString('en-US')` in `src/components/motion/CountUp.tsx:11`; bare `toLocaleString()` in `src/components/stats/ActivityHeatmap.tsx:107` (owned by phase 10, which switches it to the helper).
- UI locales, in order: en, vi → id, pt-BR, es → ja, ko → tr. Canvas specimen `LangLocales.dc.html` defines the rules: no string concatenation, ICU plurals (ja/ko have no plural forms), locale dates and currency, German ~35% longer, CJK line height 1.7, no uppercase eyebrows in CJK.

## Requirements

- One i18n runtime whose initial cost fits the budget; catalogs lazy-loaded per locale and per area.
- ICU MessageFormat for plurals, select and numbers; explicit, stable message ids (`today.header.title`) so the translation system keeps history.
- Locale resolution order: `?locale=` (dev/QA only) → stored choice (`sonflash_ui_locale`) → signed-in profile (phase 12) → `navigator.languages` matched to shipped locales → `en`.
- `document.documentElement.lang` and `dir` follow the UI locale before first paint and on change.
- A `pseudo` locale (accented, ~35% longer, bracketed) available in dev and preview builds only.
- Intl helpers for numbers, compact numbers, percentages, currency, dates, relative time and lists, all bound to the active UI locale.
- A scanner test that fails on new hardcoded user-visible strings in files already migrated.

## Files

- Create: `lingui.config.ts`, `src/i18n/{locales.ts,I18nProvider.tsx,resolveLocale.ts,loadCatalog.ts,pseudo.ts}`, `src/i18n/locales/en/*.po` (generated), `src/lib/format.ts`, tests beside each, `src/i18n/stringScanner.test.ts`.
- Edit: `package.json` (deps: `@lingui/core`, `@lingui/react`; dev: `@lingui/cli`, `@lingui/vite-plugin`, `@lingui/babel-plugin-lingui-macro`; scripts `i18n:extract`, `i18n:compile`, `i18n:check`), `vite.config.ts` (Lingui plugin and the React plugin's Babel macro option only), `src/main.tsx` (provider), `index.html` (boot script sets `lang` and the theme attributes defined by phase 03), `firebase.json` (CSP hash only), `src/components/motion/CountUp.tsx`.

## Steps

1. **Spike and gate (half a day).** On a branch, wire Lingui with 20 real strings from `LandingPage.tsx`, build, run `npm run verify:bundle`, and record initial JS gzip. Repeat with react-i18next + `i18next-icu`. Pick Lingui if its delta is at most 4 KB gzip; otherwise pick the smaller option and record the numbers in this phase file. Revert the spike strings.
2. Define `src/i18n/locales.ts`: shipped locales with wave, autonym, `dir`, CJK flag, font stack key, and `hreflang` code. Only `en` and `vi` are enabled at first; later waves flip an `enabled` flag in phase 18.
3. Configure Lingui catalogs per area (`catalogs: [{ path: 'src/i18n/locales/{locale}/{name}', include: ['src/features/{name}'] }, …]` plus `shell`, `components`, `landing`). Each lazy area loads its own catalog before rendering inside its existing `Suspense` boundary (`src/app/AppViewStage.tsx`, `AppDeferredViews.tsx`).
4. Implement `resolveLocale.ts` with the order above and `I18nProvider.tsx` that activates the locale, sets `lang`/`dir`, and exposes `useUiLocale()` and `setUiLocale()` (persist to `localStorage`, broadcast to other tabs through the `storage` event).
5. Update the `index.html` boot script to read `sonflash_ui_locale` and set `lang` before paint, and to read the theme family key specified in phase 03 (one inline script for both). Recompute the SHA-256 and update the CSP in `firebase.json`; `deployGateSource.test.ts` must pass unchanged.
6. Implement `src/lib/format.ts` with memoized `Intl.NumberFormat`, `DateTimeFormat`, `RelativeTimeFormat`, `ListFormat` and `PluralRules` per locale; replace `CountUp.tsx:11`. Leave developer-facing error strings and the persisted XP day key (`gamificationStorage.ts:339`) untouched and add a comment test that asserts the XP key format stays `en-US`.
7. Implement the pseudo-locale via Lingui's `pseudoLocale` plus a length expansion transform; expose it with `?locale=pseudo` only when `import.meta.env.MODE !== 'production'` or on preview deployments.
8. Add the scanner test: parse `.tsx` files listed in `src/i18n/migratedFiles.ts` and fail on JSX text or `aria-label`/`title`/`placeholder`/`alt` string literals that are not in the allowlist (brand names, language autonyms, symbols). Each screen phase appends its files to the list.
9. Add `i18n:check` to `npm run verify`: `lingui extract --clean` produces no diff, `lingui compile --strict` succeeds for enabled locales, and every enabled locale has 100% of `en` keys.
10. Document the message-id convention and ICU rules (no concatenation, pass whole sentences, use `<Trans>` for inline markup, ordinal/plural via ICU) in `src/i18n/README.md`.

## Measured runtime spike (2026-09-24)

| Candidate | Initial JS gzip | Landing chunk gzip | Build time | Result |
|---|---:|---:|---:|---|
| Baseline | 65,045 B | 4,974 B | 7.23 s | Reference |
| Lingui 5.9.5 | 65,045 B | 8,331 B | 8.64 s | Chosen; landing delta +3,357 B |
| react-i18next + i18next-icu | 65,043 B | 30,588 B | 6.11 s | Landing delta +25,614 B |

The spike used the same real landing strings in isolated builds. The integrated implementation keeps only Lingui dependencies, shares catalogs by area, and stays within the unchanged initial bundle budgets.

The isolated spike was reverted. During integration, enabling Vietnamese browser auto-selection exposed mixed-language landing copy, so the complete landing surface was migrated in this phase (49 catalog messages) before enabling it for users. This preserves the two-locale requirement without leaving the entry screen half translated; the later landing step remains responsible for visual redesign and SEO.

## Validation

- Unit: `resolveLocale` table test (query, storage, profile, navigator variants: `pt-BR` → `pt-BR`, `pt-PT` → `en` until a pt-PT catalog exists, `es-MX` → `es`, `zh-TW` → `en`), `format.ts` snapshots for en, vi, de, ja, ko (canvas values: `12,480.5`, `12.480,5`, `2026年9月23日水曜日`).
- `npm run lint`, `vitest run`, `npm run build`, `npm run verify:bundle` within the existing budget.
- `deployGateSource.test.ts` passes with the new hash.
- Manual: `?locale=pseudo` renders the landing with pseudo strings and `lang="en-XA"`.

## Risk

| Risk | L × I | Mitigation |
|---|---|---|
| Babel macro slows builds noticeably | Medium × Low | Macro only touches files that import it; measure build time in the spike |
| Missing CSP hash update blocks production boot | Medium × High | The deploy gate test already recomputes the hash; add the boot script to the e2e smoke |
| Catalog load adds a waterfall on first view | Medium × Medium | Preload the active locale's shell catalog with `<link rel="modulepreload">` from the boot script; area catalogs load in parallel with the area chunk |
| Browser-language auto-pick surprises Vietnamese users on English browsers | Low × Medium | Stored choice wins; the switcher is visible in the header (phase 05) |

## Rollback

Revert the phase commits; the provider wraps the app, so removing it restores the previous
behaviour. Restore the previous CSP hash together with the old boot script.
