# Browser Extension Enhancement Roadmap

> Canonical continuation file for future implementation sessions. Read this file before resuming extension work after context compaction. Update the status/checklists only when the corresponding code, tests, privacy notes, and release checks are actually complete.

## Document status

- Status: **planned; no feature work from this roadmap started**
- Last updated: 2026-08-21
- Current extension baseline: 1.3.3 / protocol v2
- Current working branch at planning time: `codex/stable-extension-selector`
- Baseline compatibility patch: commit `ed926ce` (stable fallback selectors with legacy fallback)
- Existing unrelated workspace item: `.serena/` is untracked and must not be included accidentally

## How to resume

1. Read this file and inspect the current git status.
2. Confirm which task is the first unchecked task; do not restart completed tasks.
3. Preserve the security invariants in the “Non-negotiable constraints” section.
4. Implement one small task at a time with tests first.
5. Run the task checkpoint before marking it complete.
6. Update this file in the same change/commit as the completed task.

## Current architecture facts

- Extension entry points are `background.js`, `background-core.js`, `background-ui.js`, `app-bridge.js`, `shared.js`, and the popup.
- Selection capture currently returns selected text plus an anchor; it does not capture sentence context.
- Inline rendering is injected through `scripting.executeScript` and returns an explicit render acknowledgement.
- Quick Translate currently calls the Google Translate endpoint with `sl=en` and `tl=vi`.
- Create + save uses an inactive app worker tab and the existing app intake pipeline.
- Import protocol v2 verifies origin, worker tab, operation ID, payload and expiry; app results have persisted/in-memory claims and replay protection.
- The app intake and production Cloud Function currently generate a card from a word string. The active language profile is English → Vietnamese.
- `CardData` supports one `customDeck`, but there is no general tag model.
- Options page/configuration was intentionally removed in the cleanup phase. The release guard currently rejects an options page and the package graph must be updated if one is reintroduced.
- Required permissions are currently least-privilege: `activeTab`, `alarms`, `contextMenus`, `scripting`, `storage`; host permissions are only the production app and Google Translate origins.

## Product decisions

### Build now

- Manual Text-to-Speech in inline bubble and popup.
- Session-scoped recent lookups.
- Options page once there are real user settings.
- Quick Translate source auto-detection with Vietnamese target.
- Sentence-context card generation, but only through a new verified protocol version.
- Deck selection when saving, after the protocol/data path is ready.

### Build only with explicit opt-in / later release

- Floating selection icon: per-site opt-in permission, never enabled globally by default.
- Blacklist: only meaningful when a persistent content script/floating icon exists; use an allowlist-first model and a denylist override.

### Defer

- General tags and automatic `domain:example.com` tags. The card/sync/filter model has no tag field; do not overload `customDeck`.
- Full source/target language pairs. Quick Translate can become language-flexible before card generation does, but full multilingual card creation is an app/backend migration, not an extension-only feature.

## Non-negotiable constraints

- Do not add mandatory `<all_urls>`/broad host permissions for a convenience feature.
- If floating UI is built, request optional site access only from a direct user gesture and keep the feature off by default.
- Do not place sentence context or other page content in a raw URL fragment for protocol v3. Prefer an opaque job ticket and return the stored intent only after background verification.
- Keep v2 and v3 acceptance in the app during rollout. Deploy app support before publishing a v3 extension.
- Treat page context as hostile/untrusted text: cap it, validate it at the backend boundary, and explicitly tell the model it is linguistic data, not instructions.
- Never read password/hidden fields or capture full-page HTML, URL paths, titles, credentials, or tokens.
- Recent history stores only bounded text/result metadata; never store context, credentials, or Firebase/App Check data.
- Keep app origin and worker-tab/job checks on every import/result path.
- Preserve the old `#new-word`/form/button selectors while new stable extension data attributes exist.
- No autoplay TTS by default. Browser voice loading and autoplay/user-activation behavior differs across Chrome and Safari.
- No new dependency unless the native browser APIs and existing code cannot satisfy the requirement.

## Dependency map

```text
Settings foundation
├── TTS
├── Recent lookups
└── Quick Translate: source=auto, target=vi

Protocol v3 verified ticket
├── Context extraction
├── Structured AI generation request
└── Deck routing

Optional site permission
└── Floating selection icon + blacklist/allowlist

App multilingual profile registry
└── Full source/target language support
```

# Phase 1 — Safe UX improvements (target extension 1.4.0)

## Task 1: Settings foundation and Options page — M

**Files likely touched**

- `extensions/lingoflash/manifest.json`
- `extensions/lingoflash/shared.js`
- `extensions/lingoflash/popup.html`
- `extensions/lingoflash/popup.js`
- `extensions/lingoflash/popup.css`
- New `extensions/lingoflash/options.html`, `options.js`, `options.css`
- `scripts/browser-extension-package.mjs`
- `scripts/check-browser-extension.mjs`
- `extensions/lingoflash/tests/manifest.node.mjs`
- `extensions/lingoflash/tests/package.node.mjs`
- New options tests

**Settings schema**

```text
autoSpeak: false
bubbleDurationMs: 12000 (0 means manual close)
recentLookupsEnabled: true
quickTranslateSource: "auto"
quickTranslateTarget: "vi"
```

**Acceptance criteria**

- Options open from popup and `chrome://extensions`.
- Every value is bounded and invalid/missing storage returns safe defaults.
- App production URL remains fixed; it is not user-configurable.
- Package graph follows `options_ui.page`; ZIP guard still rejects unreachable files.
- No mandatory host permission changes.

**Verification**

- Manifest/package/options node tests.
- `npm run extension:check`.
- Build and inspect the packaged file list.

## Task 2: Manual TTS in bubble and popup — M

**Files likely touched**

- `extensions/lingoflash/background-ui.js`
- `extensions/lingoflash/popup.html`
- `extensions/lingoflash/popup.js`
- `extensions/lingoflash/popup.css`
- `extensions/lingoflash/tests/ui.node.mjs`
- `extensions/lingoflash/tests/popup.node.mjs`

**Acceptance criteria**

- Bubble has accessible speaker controls for the selected word and, when present, the example sentence.
- Popup can speak the selected text and recent lookup rows.
- A new utterance cancels the previous one; unsupported speech synthesis fails gracefully.
- Controls are keyboard-operable, labeled, and respect reduced motion.
- Autoplay remains off by default; the setting is not used to bypass browser user-activation rules.

**Verification**

- DOM/static tests for controls and labels.
- Fake `speechSynthesis` tests for speak/cancel/unsupported paths.
- Manual Chrome and Safari smoke check.

## Task 3: Recent lookups — M

**Files likely touched**

- `extensions/lingoflash/shared.js`
- `extensions/lingoflash/background-core.js`
- `extensions/lingoflash/popup.html`
- `extensions/lingoflash/popup.js`
- `extensions/lingoflash/popup.css`
- `extensions/lingoflash/tests/background.node.mjs`
- `extensions/lingoflash/tests/popup.node.mjs`

**Design**

- Store at most 10 successful terminal results.
- Dedupe by normalized text plus language pair.
- Store only text, translation, operation kind, status and timestamp.
- Chrome uses `storage.session`; Safari/local fallback requires TTL and startup cleanup.
- Add clear-history action and “create card” action for a quick-translate row.

**Acceptance criteria**

- History survives popup reopen in the current session.
- History is bounded, deduped, clearable and never contains raw context/URL/credentials.
- Failed operations are not presented as successful lookups.
- A history row can safely start a new quick-add job.

## Task 4: Quick Translate source auto-detection — S

**Files likely touched**

- `extensions/lingoflash/background-core.js`
- `extensions/lingoflash/shared.js`
- options/popup disclosure text
- background tests

**Acceptance criteria**

- Google Translate request uses `sl=auto` and the configured target, initially only `vi`.
- Create + save remains explicitly English vocabulary flow until app multilingual support is ready.
- Privacy text says selected text is sent to Google Translate and the source may be auto-detected.

## Phase 1 checkpoint

- [ ] All Phase 1 tests pass.
- [ ] `npm run extension:check` and ZIP verification pass.
- [ ] `npm run lint` and relevant Vitest tests pass.
- [ ] No new mandatory host permission appears.
- [ ] Popup and inline bubble remain usable on protected pages.

# Phase 2 — Context-aware generation (target app/extension protocol 1.5.0)

## Task 5: Protocol v3 verified ticket — M

**Files likely touched**

- `extensions/lingoflash/shared.js`
- `extensions/lingoflash/background-core.js`
- `extensions/lingoflash/app-bridge.js`
- `src/features/browserExtension/browserExtensionImport.ts`
- `src/features/browserExtension/browserExtensionImportRuntime.ts`
- `src/features/browserExtension/useBrowserExtensionImport.ts`
- Protocol/background/app tests

**Acceptance criteria**

- v3 ticket contains no sentence context in the URL.
- Background resolves the stored job and verifies origin, worker tab, operation ID, timestamp, mode and one-time claim.
- App accepts v2 and v3 during rollout.
- Replay, wrong tab, forged ticket and expired job are rejected.
- Existing v2 extension behavior remains functional.

## Task 6: Bounded sentence-context extraction — M

**Files likely touched**

- `extensions/lingoflash/background-ui.js`
- `extensions/lingoflash/background-core.js`
- DOM/behavioral extension tests

**Acceptance criteria**

- Capture returns selected text, anchor and at most one bounded sentence context.
- Uses `Intl.Segmenter` when available and punctuation fallback otherwise.
- Input/block scanning is bounded; no full-page HTML/title/path is transmitted.
- Password/hidden fields are excluded.
- If extraction fails, the existing text-only flow continues.

## Task 7: Structured app intake request — M

**Files likely touched**

- `src/features/intake/cardIntakeController.ts`
- `src/features/intake/cardIntakePipeline.ts`
- `src/features/intake/useCardIntake.ts`
- `src/lib/gemini.ts`
- Intake/runtime tests

**Design**

Replace a word-only generation call with a bounded request containing `term`, optional `context`, language and later optional deck. Existing-card identity remains term/language based.

**Acceptance criteria**

- No-context generation is behaviorally unchanged.
- Context can guide sense/example selection but is not persisted as a separate sensitive field.
- Generated example fields remain bounded and schema-validated.

## Task 8: Cloud Function validation and prompt hardening — M

**Files likely touched**

- `functions/src/inputValidation.ts`
- `functions/src/index.ts`
- `functions/src/aiGeneration.ts` if needed
- function tests

**Acceptance criteria**

- Server accepts legacy word string and new structured input during rollout.
- Context is capped (proposed maximum: 500 characters) and unknown fields are rejected.
- Prompt labels context as untrusted linguistic material, not instructions.
- Model output remains JSON-schema parsed and validated.
- No raw page context is logged or stored outside the generation request.

## Task 9: v3 privacy disclosure and rollout — S

**Files likely touched**

- `extensions/lingoflash/README.md`
- `public/browser-extension-privacy.html`
- popup/options disclosure text
- release tests

**Rollout order**

1. Deploy Cloud Function compatibility.
2. Deploy app v2+v3 compatibility.
3. Publish extension v3.
4. Observe adoption.
5. Retire v2 only in a later release.

## Phase 2 checkpoint

- [ ] Forged/replayed v3 ticket cannot create a card.
- [ ] Context is not present in the URL.
- [ ] Exact job/origin/worker-tab checks still pass.
- [ ] Prompt-injection text is treated as data.
- [ ] Text-only and v2 regression paths pass.
- [ ] Privacy disclosure explicitly mentions sentence context sent to LingoFlash/Gemini.

# Phase 3 — Deck routing (target 1.5.x)

## Task 10: Secure deck metadata sync — M

**Files likely touched**

- App browser-extension integration
- `extensions/lingoflash/app-bridge.js`
- `extensions/lingoflash/background-core.js`
- `extensions/lingoflash/popup.js`
- popup tests and origin/storage tests

**Acceptance criteria**

- App sends only bounded deck names after authentication/library readiness.
- Background accepts metadata only from the production app origin.
- Cache is session-scoped and bound to an opaque owner scope.
- Sign-out/account switch clears stale deck metadata.
- No token, password or raw user identity is sent to the extension.

## Task 11: Requested deck in verified job — M

**Files likely touched**

- `shared.js`
- `background-core.js`
- `app-bridge.js`
- browser-extension app runtime/hook
- intake/persistence code
- popup and app tests

**Acceptance criteria**

- Popup can choose “Library” or a known deck.
- Requested deck is included only in the verified job, never trusted from raw URL input.
- App validates the deck before spending an AI request.
- Card is persisted with `customDeck` in the same creation path.
- Missing/stale deck produces a clear error and does not silently save elsewhere.

## Phase 3 checkpoint

- [ ] Deck metadata cannot cross owner scope.
- [ ] Stale deck cannot misroute a card.
- [ ] Existing no-deck flow remains unchanged.
- [ ] Tags/domain metadata remain explicitly out of scope.

# Phase 4 — Floating selection icon, opt-in experiment (target 1.6.0)

## Task 12: Optional site access and registration — M

**Files likely touched**

- `manifest.json`
- options/popup permission UI
- `background-core.js`
- new dynamic selection content script
- `scripts/browser-extension-package.mjs`
- `scripts/check-browser-extension.mjs`
- manifest/package/permission tests

**Acceptance criteria**

- Feature is off by default.
- Permission is requested only after a direct user action and only for the selected site.
- No mandatory `<all_urls>` warning is added.
- Dynamic script files are included in the package graph and ZIP guard.
- Permission revocation stops the feature cleanly.

## Task 13: Accessible floating selection action — M

**Files likely touched**

- new selection content script and CSS
- `background-core.js`
- options/popup
- DOM/behavioral tests

**Acceptance criteria**

- Debounced selection detection shows a small Shadow DOM control only for valid text.
- Editable/password fields, protected pages, empty selections, scroll and Escape are handled safely.
- No selected text leaves the page before the user clicks.
- Control is keyboard-operable and respects reduced motion.
- Allowlist/blacklist behavior is deterministic and tested.

## Phase 4 checkpoint

- [ ] Permission review story is acceptable for Chrome Web Store.
- [ ] No unexpected page content is collected.
- [ ] Site opt-in, revocation and exclusion tests pass.
- [ ] Manual Chrome protected-page smoke test passes.

# Full multilingual support — separate app/product epic

Do not expose a broad source/target picker for card creation until the app supports it end-to-end. Required work includes:

- language-profile registry;
- language-aware card identity and duplicate detection;
- intake and persistence changes;
- dynamic Cloud Function prompt/validation;
- catalog/filter/practice language handling;
- correct TTS locale and media behavior;
- migration and compatibility tests.

Quick Translate `source=auto → target=vi` is intentionally a smaller, earlier feature.

## Definition of done for any task

- Acceptance criteria and abuse cases have tests.
- Relevant extension tests pass.
- App changes pass TypeScript/lint and focused Vitest tests.
- `npm run extension:check` passes for extension changes.
- Build/package/ZIP graph is verified when packaging changes.
- Privacy/README disclosure is updated when data flow or permission changes.
- No secrets, tokens, credentials or unnecessary page data are stored or logged.
- This file's task checkbox/status is updated in the same commit.
