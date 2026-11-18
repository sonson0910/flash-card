# Shared-deck acceptance

Status: complete for local phase 02; no deployment.

## Scope and revision

Base `47a1bdc`; accepted source tree `87546c9d08aa99b31443c756d33f0cde52a0bac1` (31 source/test/catalog paths). The commit also records this report, the phase checklist, migration mapping and decision log. Phase 03–05 application changes remain outside this source tree.

Complete optional target/native language pairs and safe origin now survive share validation, normalization, fingerprinting, persistence, migration recognition, public preview and adoption provenance. Mixed/unknown metadata stays unknown. Public share data excludes owner identity. Expiry, revoke, import retry, copy fallback and focus recovery remain effective. Persisting the received deck pair on the newly adopted private card is the explicit phase 08.2 card-model task, not silently claimed here.

## Verification

| Evidence under `plans/260925-1005-claude-design-workflow-recovery/evidence/` | Result |
|---|---|
| `phase-02-isolated-core-retry.log` | PASS: 226 web files / 1,966 tests; 27 Functions files / 284 tests; 65 Rules tests; 38 emulator integration tests. Skips in the normal Functions pass were subsequently executed with the emulator. |
| `phase-02-resumed-focused-retry.log` | PASS: 35 overlay/controller tests after final structure/order correction. |
| `phase-02-resumed-final-i18n.log` | PASS: stable extraction, 11 catalogs, complete EN/VI coverage, strict compilation. |
| `phase-02-resumed-final-build.log`, `phase-02-resumed-final-bundle.log` | PASS: 101 JS chunks; initial JS 70,089/71,000 B gzip; initial CSS 28,669/29,500 B gzip. |
| `phase-02-03-resumed-final-browser.log` | PASS: 33/33. Includes all 20 theme/locale/viewport combinations and 13 behavior journeys. |

The isolated core run predates only the final overlay markup, scoped CSS and corresponding catalog references. Those frontend changes received the focused, extraction, build, bundle and browser checks above. No later backend/domain change is substituted into that core evidence. The shell/share fixture is test-only infrastructure committed with phase 03; it renders the same accepted phase-02 sharing components and real session controller with deterministic service adapters. This is not live cloud/G1 evidence.

## Canvas comparison

Sources: Classic `DlgShare` / `DlgShareIn`; Crystal `AnimeDlgLibrary` **share/sharein variants**, with `GridAnimeDlgLibrary-comparison.png` for their rendered source. Generic `AnimeDlgManage` is not used as a replacement. The earlier incorrect source claim is withdrawn in `reviewer-260925-1430-share-visual.md`.

[Visual coverage CSV](../260925-1005-claude-design-workflow-recovery/evidence/phase-02-share-visual-coverage.csv) maps 40 incoming/outgoing images to board, theme, locale, viewport and behavior log. Preserved captures: `artifacts/recovery-shell-share-20260925-1653/`. Root compared the corrected frame widths, type, hierarchy, cover, metric treatment, Classic grid, Crystal sample rail/rim, footer, warning and mobile scroll against the sources. EN/VI use 1440×900 and 390×844; pseudo-locale uses 360×844. Keyboard tests reach the final horizontal tile, lower guidance, copy and both footer actions without hiding page overflow or axe blockers.

Specific content/accessibility differences retained:

- Public payload has no sender identity: omit the sample author's avatar/name. Do not expose owner UID. Use actual creation time.
- The payload has no mastered totals, CEFR-band aggregate or verified stress spans: display real count/category/copy semantics and plain real headwords, without fabricated data.
- Actual language pairs, expiry, truncation, privacy and AI disclosures add content; language metadata uses the active theme's shape and typography.
- Close and Copy keep 44px targets. Focus outlines and scrollable, focusable content/rail remain visible. Classic subtle text uses contrast-adjusted `#7b7266` / `#8e9ca4`; the original light shade failed WCAG contrast. No axe rule or assertion was disabled.

Independent data/scope review: [refreshed candidate review](reviewer-260925-1540-share-candidate.md). Final style correction: [worker report](fullstack-developer-260925-1636-share-visual-finish.md), followed by root image/keyboard/contrast verification. Prior failures and the interrupted reboot setup logs remain historical evidence, not PASS.
