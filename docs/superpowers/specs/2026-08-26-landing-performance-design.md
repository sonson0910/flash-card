# Landing Performance Design

**Date:** 2026-08-26

**Status:** Approved for implementation planning

**Scope:** Maximize cold-landing performance while preserving the current DOM, visual design, animations, data guarantees, and trust boundaries.

## 1. Context

The current landing page is visually healthy but pays the startup cost of the authenticated application before the visitor expresses intent to use it. Static imports pull Firebase, Firestore, Auth, App Check, callable functions, library coordination, and related third-party scripts into the initial graph. The landing background also downloads four autoplay videos totaling about 80.6 MB at source, with approximately 14.3 MB transferred during a Lighthouse run.

Measured baselines on the current checkout:

| Target | Performance | FCP | LCP | TBT | Transfer |
| --- | ---: | ---: | ---: | ---: | ---: |
| Local `/` | 71–78 | ~3.12 s | 4.51–6.73 s | 41–46 ms | ~938 KB |
| Local landing | 70–72 | 3.08–3.27 s | 5.87–6.24 s | 19–161 ms | 15.42–15.48 MB |
| Production `/` | 73 | 2.76 s | 5.92 s | 122 ms | ~920 KB |
| Production landing | 68 | 2.74 s | 5.72 s | 309 ms | 15.40 MB |

The initial build contains approximately 310 KB gzip JavaScript and 25 KB gzip CSS. Landing traces include roughly 320 KB of reCAPTCHA, 95 KB of Google Auth iframe code, 43 KB of Google API code, and external font traffic. Animation is not the primary bottleneck: motion E2E passes in Chromium, Firefox, and WebKit, CLS is near zero, and ordinary traces do not show animation-driven long tasks as the dominant cost.

## 2. Goals

- Make the cold landing independent of cloud runtime initialization.
- Reduce landing media transfer by at least 75%, targeting 80–85%.
- Preserve the current landing DOM, layout, motion timing, crossfades, and visible effects.
- Preserve all Auth, App Check, Firestore Rules, mutation capability, owner isolation, epoch/revision/tombstone, pending-queue, and A→B→A race guarantees.
- Keep the change reversible without schema or data migration.

## 3. Non-goals

- Redesigning the landing page or changing its copy, navigation, animation language, or interaction model.
- Replacing Firebase or changing Firestore schemas, security rules, synchronization protocols, or authorization policy.
- Building a second landing-specific identity/session system.
- Adding a service worker, custom cache framework, media loader abstraction, or new runtime dependency.
- Claiming bit-for-bit image equivalence after lossy media compression. The required standard is measured and visually reviewed perceptual equivalence.

## 4. Chosen architecture

### 4.1 Lightweight bootstrap and sticky application runtime

The top-level bootstrap owns only the navigation state needed to render the cold landing and detect explicit application intent. It must not statically import `appDependencies`, Firebase modules, App Check, Firestore, device sync, or application coordination hooks.

The existing authenticated application composition moves intact into `src/app/AppRuntime.tsx`. The bootstrap dynamically imports this runtime when the visitor explicitly chooses an application path such as Start, Library, Catalog, or sign-in.

The runtime is a single sticky instance:

1. Cold landing renders without loading the runtime chunk.
2. An explicit application intent starts one coalesced dynamic import.
3. The runtime mounts once and retains the existing controllers, subscriptions, and identity state.
4. Returning to landing hides or routes away from the runtime but does not recreate it.
5. The runtime remains mounted until page unload.

This boundary removes cold-start work without making adapters nullable or asynchronous and without duplicating application state. Existing composition inside the runtime should move with the smallest possible behavioral diff.

The sign-in action uses the same runtime-loading path. If chunk loading causes a popup to lose browser user activation, the existing redirect fallback remains the recovery path; no separate auth controller or cached landing identity is introduced.

### 4.2 Media delivery

Each of the four landing backgrounds is self-hosted as:

1. AV1 in MP4 as the preferred source.
2. H.264 in MP4 as the compatibility fallback.

Native `<video><source>` selection provides codec fallback. Existing `autoplay`, `muted`, `playsInline`, source switching, crossfade timing, and motion behavior remain unchanged.

Every rendition must preserve:

- 1920×1080 dimensions.
- 24 fps.
- 241 frames.
- Approximately 10.041667 seconds duration.
- Structural similarity of at least SSIM 0.985 against its original.
- Fast-start metadata placement for progressive playback.

If a rendition misses the quality gate, raise its bitrate or retain the original fallback rather than accepting visible degradation. A representative transcode already demonstrated that H.264 CRF 23 can reduce one source by about 66.9% at SSIM 0.9862, while AV1 CRF 28 can reduce it by about 86.2% at SSIM 0.9868.

The overlay is self-hosted in an alpha-preserving optimized format with the same intrinsic dimensions and visible train/bobbing behavior. The logo uses a correctly sized local asset instead of decoding the 192 px version for a 40 px display.

### 4.3 Font delivery

The exact Instrument Serif face used by the hero is self-hosted as WOFF2. The duplicate external declarations in `index.html` and `src/index.css` are removed. Font loading must avoid an external render-blocking stylesheet while preserving the current typeface and layout.

Hashed Vite assets use the existing immutable cache policy under `/assets/**`; HTML remains non-immutable so deployments cannot strand an old asset graph.

## 5. Security and data invariants

Lazy loading changes only when the cloud runtime starts. It does not relax any trust boundary.

- App Check, Auth, Firestore Rules, and protected callable-function behavior remain fail-closed.
- Mutation capability remains disabled until identity and the remote epoch are verified.
- Owner-scoped Library Replica behavior is unchanged.
- Epoch/revision/tombstone ordering and pending-queue semantics are unchanged.
- The current A→B→A guards remain effective because a loaded runtime is not recreated during navigation.
- No local marker or cached identity is treated as authorization.
- No Firebase adapter becomes optional solely to support the landing path.
- No schema, rules, stored data, or sync-protocol migration is required.

Cold-landing failure is isolated from application failure. If the runtime chunk or Firebase initialization fails after intent, the application path exposes an explicit retry while the landing remains usable. Failures must never unlock mutations or silently downgrade App Check.

## 6. Implementation slices

### Slice A: Media and font

- Add verified AV1/H.264 renditions and native source fallback.
- Self-host and optimize the overlay, logo, and Instrument Serif WOFF2.
- Remove duplicate/external font loading.
- Preserve landing markup, styling, and motion behavior.

This slice can ship and roll back independently.

### Slice B: Lazy cloud runtime

- Extract the existing application composition into one `AppRuntime` module.
- Keep the bootstrap cloud-free on cold landing.
- Load and retain the runtime on explicit application intent.
- Remove unconditional cloud/auth preconnect or module-preload consequences from the landing path.

This slice can also ship and roll back independently. No data rollback is needed for either slice.

## 7. Verification strategy

Implementation follows test-first development for the new boundary.

### Automated behavior checks

- A cold landing neither imports nor initializes Firebase/App Check/Firestore.
- Explicit intent loads the runtime once, including concurrent/repeated intents.
- After first load, navigation back to landing and into the app reuses the same runtime.
- Sign-in continues through the existing popup/redirect behavior.
- Existing Firebase initialization and protected-function capability tests remain green.
- Existing composition-root, deferred-view, owner/session, epoch ordering, intake, media-race, and A→B→A tests remain green.
- Motion E2E remains green in Chromium, Firefox, and WebKit.

### Asset checks

For every video, a reproducible command verifies codec, dimensions, frame rate, frame count, duration, fast-start suitability, file size, and SSIM. Browser tests confirm the AV1 source and H.264 fallback are both valid choices. Screenshot/video comparison checks the overlay alpha, hero typography, crossfade, playback, and motion against the baseline.

### Performance checks

Run each Lighthouse/network scenario at least three times in the same environment and compare medians rather than selecting the best run.

Acceptance gates:

- No Firebase, Firestore, App Check, reCAPTCHA, or Google Auth request on cold landing.
- No Firebase or callable-functions module preload in the generated landing HTML.
- Landing media transfer reduced by at least 75%; 80–85% is the target.
- Mobile landing LCP at or below 2.5 seconds in a stable Lighthouse environment.
- CLS at or below 0.01.
- TBT at or below 100 ms.
- Initial landing JavaScript contains only the bootstrap, landing dependencies, and unavoidable framework runtime.
- No visible regression in DOM structure, responsive layout, animation timing, crossfade, or effects.

Headless software-decoding frame-drop numbers are diagnostic only. Final animation smoothness requires a real-device/GPU trace because headless decode is not representative.

## 8. Review and rollout

After implementation and targeted verification:

1. Run the broader build, unit, integration, and cross-browser motion suites.
2. Inspect the generated chunk/module-preload graph and landing network trace.
3. Perform an independent technical review.
4. Perform a separate security review of Auth/App Check/mutation boundaries.
5. Resolve substantiated findings and re-run the affected checks.
6. Deploy the two slices independently, with a revert of the corresponding code/assets as rollback.

The work is complete only when all acceptance gates have evidence or any environment-dependent exception is explicitly recorded with its measurement conditions.

## 9. Authoritative platform references

- [MDN `<video>` usage notes](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/video#usage_notes)
- [MDN `<source>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/source)
- [MDN video codec recommendations](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Video_codecs#recommendations_for_the_web)
- [HTML media element preload behavior](https://html.spec.whatwg.org/multipage/media.html#the-video-element)
- [FFmpeg `movflags` and faststart](https://ffmpeg.org/ffmpeg-all.html#movflags)
- [MDN `font-display`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@font-face/font-display)
- [Firebase Hosting cache headers](https://firebase.google.com/docs/hosting/manage-cache)
