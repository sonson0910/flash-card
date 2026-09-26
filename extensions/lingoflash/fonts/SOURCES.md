# Font sources and licenses

Copies of the exact same self-hosted, redistributable font builds the main
app uses (see `src/assets/fonts/SOURCES.md`), vendored here so the extension
popup/options pages never make a network request for typography.

| Family | Assets | Source | License |
| --- | --- | --- | --- |
| Fraunces | `fraunces/` | [Google Fonts Fraunces v38](https://fonts.gstatic.com/s/fraunces/v38/) | SIL Open Font License 1.1 |
| Geist Mono | `geist-mono/` | [Fontsource Geist Mono v5.2.8](https://www.npmjs.com/package/@fontsource-variable/geist-mono) | SIL Open Font License 1.1 |
| Geist | `geist/` | [Fontsource Geist v5.2.9](https://www.npmjs.com/package/@fontsource-variable/geist) | SIL Open Font License 1.1 |

Only the normal-weight variable axis and the latin/latin-ext/vietnamese
subsets are included; italic and CJK subsets are not needed by the extension
UI and are intentionally left out of this smaller, self-contained copy.
