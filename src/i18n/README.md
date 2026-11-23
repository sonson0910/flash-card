# UI messages

SonFlash ships `en` and `vi` UI catalogs. `en-XA` is a generated pseudo locale available through `?locale=pseudo` on local and preview hosts. Later locales remain disabled in `locales.ts` until their screen catalogs are complete.

Use an explicit, stable message ID of the form `area.screen.purpose`, such as `today.header.title`. Keep the whole sentence in one message. Use ICU plural, select, number, and ordinal syntax for grammar and quantities; never assemble a sentence from translated fragments. Use Lingui `<Trans>` when a sentence contains inline markup. The source text is English; translate the same ID into Vietnamese before committing a migrated screen.

`lingui.config.ts` assigns feature directories to area catalogs. Each lazy screen loads its component and catalog together through `loadCatalog.ts`. Add a newly migrated screen to `migratedFiles.ts` so the string scanner rejects fresh JSX text and accessibility literals. `I18nProvider.tsx` chooses the locale in this order: allowed QA query, stored choice, profile choice, browser languages, English. It keeps `lang`, `dir`, formatting, and other tabs in sync. The pre-paint script in `index.html` handles the values available before React starts.

From the repository root:

```sh
npm run i18n:extract
npm run i18n:compile
npm run i18n:check
```

`i18n:check` requires a stable extraction, strict compilation, and complete English/Vietnamese IDs. Compiled `.js` catalogs are generated and ignored; the `.po` files are authoritative. Keep persisted data formats such as the English XP day key separate from UI formatting.
