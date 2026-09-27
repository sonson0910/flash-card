---
title: "Owner review — remaining extension and WebWords Canvas gaps"
status: proposed
---

# Owner review: Phase 07 Canvas completion

## Purpose and boundary

This is a decision contract for the Phase 07 Canvas comparison checkbox. It
does not approve product work, alter the existing extension protocol, or claim
that a Canvas board is matched. It covers only the unresolved `ExtLoop`,
`LangExt`/`LangExtInPage`, and `WebWords` differences identified after the
baseline revision `04498bd`.

The existing source of truth remains the Canvas boards in
`docs/design/sonflash-redesign/canvas/src/` and the live contracts named below.
The initial default is to preserve the current zero-new-I/O behavior and hide
any Canvas panel for which real, scoped data is unavailable.

## Evidence and current boundary

- `ExtLoop` depicts weekly captures, source-site chips, a study streak, due
  work, and a review CTA. The popup currently derives only a bounded recent
  save reminder from extension storage; `MAX_RECENT_LOOKUPS` is 10 and the
  entries are de-duplicated, so it cannot truthfully represent a week's total
  or site distribution. Owners: `ExtLoop.dc.html`, `shared.js` and `popup.js`.
- The course bridge currently transfers only an opaque scope plus native and
  target language. It deliberately does not transfer a course title, page
  language, confidence, or a course list. Owners:
  `useBrowserExtensionImport`, `app-bridge.js`, `background-core.js`, and
  `shared.js`.
- WebWords already has a bounded, paginated card query: target-language
  equality, source capture-time ordering, and a 30-item page with one
  look-ahead document. It is a dialog layered over the current view rather
  than the full workspace shown by `WebWords.dc.html`. Owners:
  `webWordsQuery`, `webWordsRoute`, `WebWordsRouteHost`, and `WebWordsPage`.
  The current `useWebWordsPage` still passes `LEGACY_CARD_LANGUAGE` (`en`) to
  that query. A workspace implementation must first bind the query to the
  active course and discard stale results on course/account switch; otherwise
  it would show English captures while another course is active.

## Decisions required from the owner

1. **ExtLoop fidelity:** choose either the zero-I/O honest reminder described
   in Decision A, or authorize the aggregate contract in Decision B. The
   existing reminder must remain if no decision is made.
2. **Language presentation:** choose whether the extension may label the
   active target language using a bundled locale label only, or whether a
   learner-editable course display name is required. The latter expands the
   course profile contract and is not proposed by default.
3. **Language detection:** choose whether to retain the current active-course
   routing only, or authorize a detector with an explicit accuracy, provider,
   privacy, and cost contract. Do not show a confidence percentage or mismatch
   action before that decision.
4. **WebWords shell:** choose whether `?webWords=1` remains a dialog route or
   becomes a first-class full workspace route. The Canvas comparison stays
   open while it remains a dialog.
5. **Bulk-add meaning:** if the workspace is approved, choose whether “Add
   all” means every loaded/filtered item or every matching item. The latter is
   not bounded by the current page query and requires a new server-side
   operation or a stated cap.

## Decision A — no-new-I/O extension completion

This is the default if the owner does not approve new cost or data contracts.

- Keep `ExtLoop` as the current recent-save reminder and label it as recent
  saves. It may offer the existing WebWords route and due-count handoff, but
  must not render a weekly chart, site totals, streak progress, or a claim that
  a save is in tomorrow's session.
- Derive a language label from the already-synced `targetLanguage` using a
  bundled locale table. It describes the target language, never a custom course
  name. An unknown or absent scoped locale leaves the current Chrome-i18n and
  generic capture UI unchanged.
- Do not render `LangExt` detect/mismatch states or `LangExtInPage` course
  chooser. Continue the existing silent-capture course gate in the app.
- Keep the inline bubble family-neutral. Its current injected function has no
  theme context; it must not imitate Crystal-specific Canvas geometry.

**Cost:** zero Firestore reads, writes, queries, and listeners; no new
extension storage key, host permission, or background scrape. Existing
extension storage reads and the existing due-count/course-locale bridges are
unchanged.

**Unavailable fallback:** hide the optional panel and retain the working
capture/result controls. Never substitute Canvas sample values.

## Decision B — bounded aggregate for full ExtLoop data

This option is required before rendering the data-dependent `ExtLoop` panels.
It is intentionally a proposal, not an approved schema.

### Proposed source and shape

Create a server-owned aggregate per authenticated owner and target language,
covering a rolling seven local-calendar-day window. It contains only:

```text
{ windowStart, dailyCaptureCounts[7], topSites[<=3]{ host, count }, capturedCount,
  generatedAt }
```

`host` is the sanitized hostname derived from the already-sanitized card source
URL. No URL path, page title, selection, sentence context, card id, or course
identifier enters the aggregate. `dueCount` and verified study streak stay
separate values from their current app owners; neither is inferred from capture
history.

The app may relay this value only through the existing origin-validated,
opaque-scope bridge pattern. A relay payload must add the current opaque scope,
must be rejected if the scope is retired, and must clear on owner change or
sign-out. The extension stores only the latest scoped snapshot; it does not
query Firestore itself.

### Cost and cache semantics

- **Capture mutation:** at most one aggregate-document read and one aggregate
  write in the same server-authoritative operation that persists a captured
  card. This is additional to the current capture cost and must be recorded in
  the decision log before implementation.
- **App refresh:** at most one aggregate-document read when the app has a
  signed-in, ready owner/course and the scoped snapshot is absent or older than
  15 minutes. No snapshot listener. A foreground app session reuses that
  snapshot within the 15-minute TTL.
- **Popup open:** zero Firestore I/O. It reads only the latest relayed snapshot.
- **Missing, expired, malformed, or scope-mismatched snapshot:** render the
  Decision A fallback. Do not silently trigger an app refresh or extension-side
  query.
- **Window rollover:** the server's supplied `windowStart` is authoritative.
  A client whose local day differs does not repair, extrapolate, or persist a
  different window.

This remains bounded per interaction, but the owner must explicitly accept the
new per-capture read/write and per-15-minute foreground refresh read. If that
cost is rejected, Decision A applies.

## Language detection and in-page course UI

No current payload proves the language of the page or selection. The existing
course-locale value only proves the learner's selected course. Therefore the
Canvas confidence and mismatch states require a separate owner-approved
detector contract.

If approved, its input must be limited to the learner-initiated selected text
already used for capture, bounded by the existing capture text limit. Its output
must be:

```text
{ detectedLanguage, confidence: integer 0..100 }
```

The result is transient to one capture and may not be written to card source
metadata, recent lookups, or an extension-wide history. The provider, whether
the current capture translation response may supply the result without another
network request, and any new request cost all require an owner decision after
an implementation audit. Until then, detection cost is **not approved** and is
recorded as unavailable.

The in-page Canvas course chooser also needs a separate decision. Its minimum
safe bridge payload is a bounded list of at most the existing course-profile
limit, each containing `{ targetLanguage, nativeLanguage, active }`; it omits
course ids, learner names, deck names, due counts, and card data. It may only
offer a switch through the existing app-owned course action after the learner
initiates capture. It cannot silently change the active course from a content
script. The owner must approve this behavior and its UI before implementation.

Theme family for an injected bubble is presentation state, not learner data.
If the owner approves Crystal in-page fidelity, transmit only the extension's
already-selected family/scheme to the injected renderer at invocation time. It
requires no Firestore I/O, no persistent bridge data, and no new host
permission. If unavailable, render the family-neutral bubble.

## WebWords workspace decision

If approved, replace the dialog presentation with a route/shell surface while
preserving `?webWords=1` deep links and browser back behavior. Bind the existing
query to the active course target language before exposing the workspace, and
cancel or ignore results from a retired account/course. It must keep the current
lazy boundary so the workspace does not enter the initial bundle.

The workspace reuses `fetchWebWordsPage`; opening it costs at most 31 card
document reads (30 visible plus look-ahead), and each explicit “load more” has
the same maximum. Existing client-side filters can derive “This week,”
“Not in a deck,” and tier/known views from loaded cards without new reads.
There is no subscription. Adding selected cards to the active session retains
the existing local session-pointer behavior; this contract authorizes no new
Firestore write.

The Canvas “Add all” control must initially mean **all currently loaded and
currently filtered cards**. Its label must disclose the resulting count. It may
not scan or mutate unseen pages. A later change to all matching cards requires
a separate bounded batch/server contract and cost decision.

When the route/shell decision is declined, keep the dialog and document it as
accepted drift; do not force full-screen styling onto an overlay.

## Privacy, security, and failure rules

- Card source URL, title, and context remain private learner data. Do not place
  them in aggregate, course, theme, or detector relay payloads; do not log them.
- Every app-to-extension value remains origin-validated, owner-scoped, bounded,
  and cleared on owner retirement. A stale scope must never reappear after an
  account switch.
- Detection and course changes remain user-initiated. There is no background
  page scraping, automatic course switch, new host permission, or extension
  Firestore credential.
- Invalid payloads, unavailable app bridge, signed-out state, offline state,
  and failed detector/provider calls fall back to the current capture UI. They
  never manufacture a course, count, confidence, quota, or streak.

## Rollout, rollback, and evidence

Ship only after an owner chooses the relevant decisions and records any
approved Firestore cost in `decision-log.md`. Roll out additive bridge data
behind an absent-data fallback; old app and extension versions keep their
current behavior. Rollback removes the new renderer/consumer and clears its
scoped extension snapshot, without deleting cards, course profiles, or source
metadata.

Before closing the Canvas checkbox, capture and review:

- quota popup in Classic/Crystal and light/dark;
- inline result and quota in each approved family/scheme; family-neutral is an
  accepted fallback when the theme decision is declined;
- WebWords ready, loading, empty, error, and signed-out states at desktop and
  mobile for both families/schemes after the route decision;
- behavior tests for scope retirement, detector fallback, bulk-add loaded-page
  bounds, and every approved aggregate mutation/TTL path.

Chrome's native context menu remains behavior-tested rather than pixel-tested;
that browser limitation is not a product fallback.
