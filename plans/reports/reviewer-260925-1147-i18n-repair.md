# Review i18n repair — 2026-09-25

Scope: 38 IDs filled/added and their JSX use in the five reported components. No code changes or test reruns. Reused worker evidence: 4 focused test files / 77 tests PASS. `src/i18n/stringScanner.test.ts` and `src/i18n/migratedFiles.ts` are unchanged.

## Findings

- **P2 — Canvas level abbreviation expanded in English.** [DesktopNavigation.tsx:70](/mnt/Projects/startup/flash-card/src/components/shell/DesktopNavigation.tsx:70) uses `Level {level}` for the visible chip; [en/shell.po:254](/mnt/Projects/startup/flash-card/src/i18n/locales/en/shell.po:254) expands it. The locked Today Canvas shows `Lv` in the same chip ([TodayScreen.dc.html:48](/mnt/Projects/startup/flash-card/docs/design/sonflash-redesign/canvas/seed/TodayScreen.dc.html:48)). This adds width to an auto-sized header chip without improving meaning; retain `Lv {level}` in English. Vietnamese `Cấp {level}` is a valid localization. The separate accessible label remains fully descriptive.
- **P2 — Theme family name translated as generic copy.** [vi/landing.po:230](/mnt/Projects/startup/flash-card/src/i18n/locales/vi/landing.po:230) renders `Crystal Star` as `Sao pha lê`. The app keeps `Crystal Star` in its theme names in both locales ([vi/shell.po:787](/mnt/Projects/startup/flash-card/src/i18n/locales/vi/shell.po:787)); the badge names that same theme family, so preserve the proper name.
- **P2 — LUMI signature translated.** [LibraryOverview.tsx:17](/mnt/Projects/startup/flash-card/src/features/library/LibraryOverview.tsx:17) uses the signature message; [vi/library.po:902](/mnt/Projects/startup/flash-card/src/i18n/locales/vi/library.po:902) changes `LUMI · LINK` to `LUMI · KẾT NỐI`. Canvas repeats `LUMI · LINK` as a fixed signature (for example [AnimeVocabulary.dc.html:20](/mnt/Projects/startup/flash-card/docs/design/sonflash-redesign/canvas/src/AnimeVocabulary.dc.html:20)); retain the branded lockup.

Reviewed sample vocabulary remains English (`Spelling`, `Immediate`, `Instant`) with matching IPA; only meanings, grades, and status copy are localized. Other checked new labels/placeholders preserve their meaning.
