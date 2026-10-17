# Share dialog visual review and implementation correction

## Canvas sources

- Classic outgoing share: `docs/design/sonflash-redesign/canvas/src/DlgShare.dc.html` and `reference/DlgShare-{dark,light}.png`; the source dialog is 560px wide.
- Classic incoming share: `docs/design/sonflash-redesign/canvas/src/DlgShareIn.dc.html` and `reference/DlgShareIn-{dark,light}.png`; the source dialog is 580px wide.
- Crystal share and share-in: `docs/design/sonflash-redesign/canvas/src/AnimeDlgLibrary.dc.html`, `kind=share` and `kind=sharein`, plus `reference/AnimeDlgLibrary-{dark,light}.png`. The source widths are 600px and 620px, respectively. `AnimeDlgManage.dc.html` supplies related shared shell motifs only; it is not the Crystal share source.
- Theme values are from `docs/design/sonflash-redesign/canvas/src/tokens.js` and `src/anime-tokens.js`.

## Correction to the preliminary review

The earlier version incorrectly stated that Crystal had no share-specific design and that `AnimeDlgManage` was the relevant visual reference. It also called the old 560px/580px captures source-matched. Both claims are withdrawn: `AnimeDlgLibrary` explicitly defines share/sharein, and its dialogs are 600px/620px. The captures under `artifacts/recovery-shell-share-20260925-1430/` show the pre-correction implementation and are historical evidence only.

## Source-backed implementation now in place

- Crystal body uses the exact 170-degree light/dark gradients without the extra radial layer. Header padding is `22px 24px 14px 26px` with no lower rule. Desktop widths are 600px outgoing and 620px incoming.
- Crystal outgoing uses the 76×96 layered cover, 26px deck title, 48px chamfered link field, source-specific warnings/facts, and footer surface/padding. Product data does not contain mastered totals, CEFR bands, or headword stress spans; none are fabricated.
- Crystal incoming uses three separate chamfered metric tiles and a horizontally scrollable, keyboard-focusable 86×112 sample-card rail with up to five real words and the real remainder count. Existing `shell.share.sample-vocabulary` text labels the rail. Product metadata does not include the sample author's identity, so no author is invented.
- Classic share removes the Crystal-only top/bottom ornaments; dark outer/body corners use 26px/25px, incoming safeguard uses the source 12px round cyan/info treatment without its decorative shield, and the dark mini cards use valid layered card/rim backgrounds with source 16px corners and shadows. Light mini cards use the source 12px corners and inset/shadow treatment. The Classic incoming metrics strip uses 14px dark / 10px light corners.
- Crystal Copy keeps a 44px touch target even though the Canvas button is 38px tall. This is an intentional accessibility size exception.
- Real product policy content remains: AI disclosure, actual expiry/language/truncation metadata, and privacy guidance can add vertical content. Copy versus Copied is a functional state difference.

## Evidence and verification state

Pre-correction Crystal captures are preserved under `artifacts/recovery-shell-share-20260925-1430/`. Later Classic baseline evidence is under `artifacts/recovery-shell-share-20260925-1540/`, including outgoing/incoming Classic dark desktop and incoming Classic light mobile. Those images predate the latest share-specific CSS corrections; they do not establish a pass for the current implementation. No outgoing-mobile capture was available in that set.

`git diff --check -- src/components/AppOverlays.tsx src/components/share-dialog.css` passes. No tests, build, or browser run was performed in this lane. Root owns the final fixture run; acceptance remains pending visual comparison and the incoming-rail keyboard reachability check.

## Status

**DONE_WITH_CONCERNS** — source-specific Classic and Crystal geometry/styles are implemented. Final visual acceptance and the keyboard rail assertion await root's fixture run.
