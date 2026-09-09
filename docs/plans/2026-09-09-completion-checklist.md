# Remaining learning experience work

User decision: English UI throughout. Main implements; do not delegate code.
Do not report the overall task complete after finishing a slice.

- [x] Follow-up T3 gap: reviewed-but-forgotten words can request guidance in Today/Study; quiz/spelling can switch to a one-word introduction without answering. Existing history is preserved; in-flight/failed saves cannot be replaced by guidance. Local regression checks pass; release pending.

- [x] T5: saved, skipped and failed/pending review counts; partial-session recap; retry weak; XP comes from the successful persistence result. Local tests and Chromium/WebKit browser checks passed; not deployed.
- [x] Remove single-review mastery claim (local change, not deployed).
- [x] Study progress counts saved reviews, not card position (local change, not deployed).
- [x] T10 implementation: ten full pronunciation lessons plus ten word mappings to reviewed VOA context excerpts (19 distinct words); bounded players, opt-in loading and source fallback. Chromium/WebKit verification passed.
- [x] T11 implementation: clip transcript/captions, target highlighting, replay and exact clip-sentence practice; microphone/media failure safeguards. Chromium/WebKit verification passed.
- [x] Local verification: latest 2,151 unit tests and 12 new Chromium/WebKit checks passed; earlier 130 supported-browser checks passed; lint, build and bundle budget passed. Local Firefox cannot launch under this macOS sandbox; Linux CI must verify Firefox before release.
- [ ] Independent review and complete CI gates.
- [ ] Release and verify exact production revision; retain rollback candidate.

Sync PR #69 merged as 45326be26a926ec8ed8afc9e2d409f7dcd5e179d.
Candidate run: 34335062864. Its status must be checked live, not inferred.
Production is not updated merely because CI or candidate build succeeds.

## Video evidence

Implemented a ten-word, static **full-lesson** pilot: water, comfortable, work,
walk, word, world, probably, schedule, and, can. Author source URLs are stored
beside each YouTube ID in `PronunciationVideo.tsx`; durations were read from
YouTube metadata on 2026-09-09. No video download, paid API or new dependency.
Player is opt-in, uses the privacy-enhanced YouTube host and stops at the known
lesson duration. Closing the card disclosure or video removes the player.
Card text/audio and external source links remain usable if embedding fails.

YouTube's caption endpoints returned empty bodies for both supplied English
tracks, so those items remain explicitly labelled full lessons.
The short-context requirement instead reuses the reviewed VOA Listen transcript
cues from the original video at https://learningenglish.voanews.com/a/7949136.html.
Ten mappings: news, information, new, ready, work, trip, travel, shirt,
sunglasses, guidebook. The public video endpoint redirects to
`voa-video.voanews.eu`; its canonical URL returns video/mp4, and live Chromium
playback verified duration 60.04 seconds and seeking to 16 seconds. The source
frame matches the existing work-trip dialogue. No changes to Listen's audio-only
contract, no downloaded/rehosted video. Visible transcript and WebVTT captions
reuse the existing approved cues rather than introducing guessed offsets.

Shadowing now permits word or card-sentence practice, drops stale microphone
callbacks after navigation/stop, and does not grade media/permission errors.
An integrated browser regression also exposed and fixed missing match/shadowing
mode forwarding in `useAppLearningCoordination.ts`.

## Release evidence

PR #70 independent correctness/security reviews passed, including a tested recap
close fallback fix. Its first CI run exposed a Linux total-JS baseline of
2,880,013 B raw / 917,804 B gzip; reviewed total caps now 2,885,000 / 920,000.
Initial-load, per-chunk, CSS and media caps are unchanged. Follow-up guidance
still fits these caps locally; all final release gates must pass on Linux.

PR #71 includes the reviewed PR #70 commits plus forgotten-word guidance and
its reviewed keyboard-order fix. Merge the combined #71 only after final CI;
no separate #70 deployment is needed. The Firefox failure in run 34339749888
was HTTP 403: its forwarded external Host header reached the local Vite media
fixture. The fixture now overrides Host while preserving Range requests;
application allowed-host settings and codec/media assertions remain intact.

Sync candidate run 34335062864 passed; digest
`d1dcba0caac4e323bfa1706481add6471c8b903f998f85375cf25532862f9d53`.
Staging run 34336762296; archive run 34336762832; read-only verification run
34336841284 all passed. Production run 34337072534 passed. Production health
returned revision 45326be26a926ec8ed8afc9e2d409f7dcd5e179d; sw.js returned HTTP 200,
JavaScript MIME type and no-cache/no-store/must-revalidate. Approval expiry reset
to zero after promotion. Learning changes in this branch are NOT yet deployed.
