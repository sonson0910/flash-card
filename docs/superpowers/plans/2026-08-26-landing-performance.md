# Maximum Landing Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the first landing render cloud-free and dramatically reduce its media/font transfer while preserving the current UI, animation, auth security, and data consistency behavior.

**Architecture:** Keep `App` as a lightweight navigation/landing bootstrap and dynamically mount one sticky `AppRuntime` containing the existing application composition. Self-host verified AV1/H.264 video pairs, the alpha overlay, the correctly sized logo, and Instrument Serif through Vite-hashed assets; use native browser source fallback and existing cache policy.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, Vitest, Playwright, Firebase 12, FFmpeg/ffprobe, cwebp, Lighthouse.

---

## File map

- Create `src/app/AppRuntime.tsx`: sole owner of the existing cloud/application hooks and shell after extraction from `App`.
- Modify `src/App.tsx`: cold bootstrap, landing callbacks, sticky runtime activation, landing sign-in request bridge.
- Modify `src/app/appCompositionRoot.test.ts`: enforce the cloud-free bootstrap and runtime ownership boundary.
- Modify `src/app/AppDeferredViews.test.tsx`: point shell composition assertions at `AppRuntime`.
- Create `src/features/landing/LandingAssets.test.ts`: local-media/font delivery contract.
- Modify `src/features/landing/LandingPage.tsx`: local imported sources with native AV1/H.264 fallback; preserve the video nodes and motion behavior.
- Modify `src/index.css` and `index.html`: local Instrument Serif and removal of Google Font/auth preconnects.
- Create `src/assets/landing/*`: four AV1/H.264 pairs, alpha-preserving overlay, and 80 px logo.
- Create `src/assets/fonts/instrument-serif-latin-{regular,italic}.woff2`: exact self-hosted font faces.
- Modify `scripts/bundle-budget.mjs` and `scripts/bundle-budget.test.mjs`: reject Firebase in the initial asset graph and tighten the measured initial-JS budget.
- Create `e2e/landing-performance.spec.ts`: cold-network, navigation, video contract, and warm-runtime smoke checks.

## Task 1: Generate and verify local landing assets

**Files:**
- Create: `src/assets/landing/golden-hour.{av1,h264}.mp4`
- Create: `src/assets/landing/still-water.{av1,h264}.mp4`
- Create: `src/assets/landing/deep-woods.{av1,h264}.mp4`
- Create: `src/assets/landing/quiet-dawn.{av1,h264}.mp4`
- Create: `src/assets/landing/train-window.webp`
- Create: `src/assets/landing/sonflash-logo-80.png`
- Create: `src/assets/fonts/instrument-serif-latin-regular.woff2`
- Create: `src/assets/fonts/instrument-serif-latin-italic.woff2`

- [ ] **Step 1: Download originals into a disposable directory**

Run:

```bash
landing_asset_tmp=/tmp/sonflash-landing-originals
mkdir -p "$landing_asset_tmp"
curl -fL 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260702_081127_0992a171-d3c6-4978-8213-0ec5df8b6d63.mp4' -o "$landing_asset_tmp/golden-hour.mp4"
curl -fL 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260702_092026_dd05b805-ea0f-40b2-8c52-332b88502592.mp4' -o "$landing_asset_tmp/still-water.mp4"
curl -fL 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260702_081042_df7202bf-bd80-4b2b-bbc6-1f09ba2870e9.mp4' -o "$landing_asset_tmp/deep-woods.mp4"
curl -fL 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260702_080959_4cac5234-3573-464e-a5b7-76b94b8a7d61.mp4' -o "$landing_asset_tmp/quiet-dawn.mp4"
curl -fL 'https://soft-zoom-63098134.figma.site/_assets/v11/0b4a435b2df2747593c43d7a1c9b4578f7d8d90c.png' -o "$landing_asset_tmp/train-window.png"
```

Expected: five non-empty source files; no repository file is changed yet.

- [ ] **Step 2: Generate the minimal browser asset matrix**

Run:

```bash
mkdir -p src/assets/landing src/assets/fonts
landing_asset_tmp=/tmp/sonflash-landing-originals
for name in golden-hour still-water deep-woods quiet-dawn; do
  ffmpeg -y -i "$landing_asset_tmp/$name.mp4" -an -c:v libaom-av1 -crf 28 -b:v 0 -cpu-used 4 -row-mt 1 -pix_fmt yuv420p -movflags +faststart "src/assets/landing/$name.av1.mp4"
  ffmpeg -y -i "$landing_asset_tmp/$name.mp4" -an -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -movflags +faststart "src/assets/landing/$name.h264.mp4"
done
```

Then run:

```bash
cwebp -quiet -q 90 -alpha_q 100 -m 6 /tmp/sonflash-landing-originals/train-window.png -o src/assets/landing/train-window.webp
ffmpeg -y -i public/brand/sonflash-logo-192.png -vf scale=80:80:flags=lanczos src/assets/landing/sonflash-logo-80.png
curl -fL 'https://fonts.gstatic.com/s/instrumentserif/v5/jizBRFtNs2ka5fXjeivQ4LroWlx-6zUTjg.woff2' -o src/assets/fonts/instrument-serif-latin-regular.woff2
curl -fL 'https://fonts.gstatic.com/s/instrumentserif/v5/jizHRFtNs2ka5fXjeivQ4LroWlx-6zAjjH7M.woff2' -o src/assets/fonts/instrument-serif-latin-italic.woff2
```

Expected: ten local assets exist; no new runtime dependency is added.

- [ ] **Step 3: Verify every rendition before accepting it**

For each video pair, run `ffprobe` and confirm `1920x1080`, `24/1`, `241` frames, and approximately `10.041667` seconds. Run SSIM against the original:

```bash
landing_asset_tmp=/tmp/sonflash-landing-originals
for name in golden-hour still-water deep-woods quiet-dawn; do
  ffmpeg -i "$landing_asset_tmp/$name.mp4" -i "src/assets/landing/$name.av1.mp4" -lavfi ssim -f null -
  ffmpeg -i "$landing_asset_tmp/$name.mp4" -i "src/assets/landing/$name.h264.mp4" -lavfi ssim -f null -
done
```

Expected: every `All:` SSIM is at least `0.985`; if not, lower that rendition's CRF until it passes. Confirm `ffprobe -show_entries stream=codec_name,width,height,r_frame_rate,nb_frames:format=duration` reports AV1/H.264 as intended. Confirm `webpinfo src/assets/landing/train-window.webp` reports alpha.

- [ ] **Step 4: Commit only the generated assets**

```bash
git add src/assets/landing src/assets/fonts
git commit -m "perf: self-host optimized landing assets"
```

## Task 2: Wire native media fallback and self-hosted fonts

**Files:**
- Create: `src/features/landing/LandingAssets.test.ts`
- Modify: `src/features/landing/LandingPage.tsx`
- Modify: `src/index.css`
- Modify: `index.html`

- [ ] **Step 1: Write the failing delivery contract**

Create a Vitest source contract that reads the three production files and asserts:

```ts
expect(landingSource).toContain("type='video/mp4; codecs=\"av01.0.08M.08\"'");
expect(landingSource).toContain("type='video/mp4; codecs=\"avc1.640028\"'");
expect(landingSource).toContain('data-hero-video');
expect(landingSource).toContain('muted');
expect(landingSource).toContain('playsInline');
expect(landingSource).toContain('train-window.webp');
expect(landingSource).not.toContain('cloudfront.net');
expect(landingSource).not.toContain('figma.site');
expect(cssSource).toContain('instrument-serif-latin-regular.woff2');
expect(cssSource).toContain('instrument-serif-latin-italic.woff2');
expect(cssSource).not.toContain('fonts.googleapis.com');
expect(htmlSource).not.toContain('fonts.googleapis.com');
expect(htmlSource).not.toContain('fonts.gstatic.com');
expect(htmlSource).not.toContain('apis.google.com');
expect(htmlSource).not.toContain('firebaseapp.com');
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/landing/LandingAssets.test.ts`

Expected: FAIL because the current component and HTML still reference remote assets.

- [ ] **Step 3: Implement the native delivery path**

Import the ten Vite assets. Replace each video record with `{ label, av1, h264 }`, retain the existing four `<video data-hero-video>` nodes and all current props/classes, and render sources in this order:

```tsx
<source src={video.av1} type='video/mp4; codecs="av01.0.08M.08"' />
<source src={video.h264} type='video/mp4; codecs="avc1.640028"' />
```

Replace only the overlay and logo `src` values with the imported local assets. Add two `@font-face` rules before the Tailwind import using `font-display: swap`, weight 400, normal/italic style, WOFF2 format, and the current Latin unicode range. Remove the Google Font import/links and the two auth preconnects from `index.html`; retain Geist and all security metadata.

- [ ] **Step 4: Verify GREEN and visual behavior**

Run:

```bash
npx vitest run src/features/landing/LandingAssets.test.ts
npm run lint
npx playwright test e2e/motion-remediation.spec.ts --project=chromium
```

Expected: all pass and the existing motion assertions still see four hero video nodes.

- [ ] **Step 5: Commit**

```bash
git add src/features/landing/LandingAssets.test.ts src/features/landing/LandingPage.tsx src/index.css index.html
git commit -m "perf: serve landing media and fonts locally"
```

## Task 3: Move the application composition behind one lazy boundary

**Files:**
- Create: `src/app/AppRuntime.tsx`
- Modify: `src/App.tsx`
- Modify: `src/app/appCompositionRoot.test.ts`
- Modify: `src/app/AppDeferredViews.test.tsx`
- Create: `e2e/landing-performance.spec.ts`

- [ ] **Step 1: Write the failing composition contract**

Update the existing source-contract tests to require:

```ts
expect(appSource).toContain("lazy(() => import('./app/AppRuntime'))");
expect(appSource).not.toContain("from './app/appDependencies'");
expect(appSource).not.toContain("from './app/useAppLibraryRuntime'");
expect(appSource).not.toContain("from './app/useAppLearningCoordination'");
expect(appSource).not.toContain('useBrowserExtensionImport');
expect(runtimeSource).toContain("from './appDependencies'");
expect(runtimeSource).toContain("from './useAppLibraryRuntime'");
expect(runtimeSource).toContain("from './useAppLearningCoordination'");
expect(runtimeSource).toContain('useBrowserExtensionImport');
```

Retarget the `AppViewStage` and deferred library/practice source assertions from `App.tsx` to `AppRuntime.tsx`.

In the same RED step, add a Playwright spec that collects request URLs before navigation and asserts a cold `/?view=landing` produces none matching:

```ts
const cloudRequest = /firebase|googleapis|recaptcha|identitytoolkit|securetoken|\/api\/device-cards/i;
expect(requests.filter(url => cloudRequest.test(url))).toEqual([]);
```

The browser test must also assert four `video[data-hero-video]` nodes, AV1 followed by H.264 in every node, click the first visible `Start Learning` button, observe the Today workspace, return to landing, open Vocabulary Library, and observe the library without a page reload. Record runtime cloud-script URLs and assert each unique URL is requested at most once during the warm navigation sequence.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run src/app/appCompositionRoot.test.ts src/app/AppDeferredViews.test.tsx
npm run build && npx playwright test e2e/landing-performance.spec.ts --project=chromium
```

Expected: FAIL because `App.tsx` still owns the cloud runtime.

- [ ] **Step 3: Extract without changing application behavior**

Move the current shell body, overlays, refs, `useOverlayState`, `useAppLibraryRuntime`, `useAppLearningCoordination`, `useBrowserExtensionImport`, and `appDependencies` import into the new default-exported `AppRuntime`. Pass the navigation object from `App`:

```ts
export interface AppRuntimeProps {
  readonly navigation: ReturnType<typeof useAppNavigation>;
  readonly visible: boolean;
  readonly signInRequest: number;
  readonly onSignInRequestHandled: (request: number) => void;
  readonly onLandingUserChange: (user: LandingUser | null) => void;
}

export interface LandingUser {
  readonly displayName?: string | null;
  readonly email?: string | null;
  readonly photoURL?: string | null;
}
```

`AppRuntime` must call all existing hooks unconditionally, publish the display-only landing user through an effect, acknowledge a positive unhandled sign-in request before awaiting `library.actions.signIn()`, and return `null` only after hooks/effects when `visible` is false. Do not alter Firebase adapters, capability checks, owner/session guards, or hook internals.

- [ ] **Step 4: Build the lightweight bootstrap**

`App.tsx` retains only React, `LandingPage`, `useAppNavigation`, and the lazy `AppRuntime`. It owns `runtimeActivated`, `signInRequest`, and display-only `landingUser`. A non-landing direct URL mounts the runtime immediately; every landing CTA activates it before changing view. Render landing and runtime as stable sibling positions so a warm runtime is never unmounted merely by returning to landing.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npx vitest run src/app/appCompositionRoot.test.ts src/app/AppDeferredViews.test.tsx src/app/appDependencies.test.ts
npm run lint
npm run build && npx playwright test e2e/landing-performance.spec.ts --project=chromium
```

Expected: all pass; `App.tsx` has no static cloud/runtime imports.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/app/AppRuntime.tsx src/app/appCompositionRoot.test.ts src/app/AppDeferredViews.test.tsx e2e/landing-performance.spec.ts
git commit -m "perf: defer cloud runtime until application intent"
```

## Task 4: Enforce the optimized initial bundle graph

**Files:**
- Modify: `scripts/bundle-budget.test.mjs`
- Modify: `scripts/bundle-budget.mjs`

- [ ] **Step 1: Write the failing budget test**

Extend bundle metrics with `initialAssetPaths` and assert `evaluateBundleBudget` reports an actionable failure when one contains `firebase` or `firebase-functions`:

```js
expect(evaluateBundleBudget({
  initialAssetPaths: ['assets/index.js', 'assets/firebase-deadbeef.js'],
  initialJavaScript: { raw: 1, gzip: 1 },
  initialCss: { raw: 1, gzip: 1 },
  javaScriptChunks: [],
}, generousBudgets)).toEqual([
  'initial asset graph contains deferred cloud chunk: assets/firebase-deadbeef.js',
]);
```

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/bundle-budget.test.mjs`

Expected: FAIL because metrics do not yet carry or reject initial cloud assets.

- [ ] **Step 3: Implement the smallest guard**

Return `initialAssetPaths` from `readBundleMetrics`; before numeric checks, append one failure for every initial path matching `/firebase/i`. Do not change total-chunk budgets. After a production build, set the initial raw/gzip budgets to the measured optimized values plus no more than 10% headroom and update the explicit-budget test to those exact constants.

- [ ] **Step 4: Verify build graph and budget**

Run:

```bash
node --test scripts/bundle-budget.test.mjs
npm run build
npm run verify:bundle
rg -n 'firebase|firebase-functions' dist/index.html
```

Expected: tests/build/budget pass; the final `rg` exits 1 with no match.

- [ ] **Step 5: Commit**

```bash
git add scripts/bundle-budget.mjs scripts/bundle-budget.test.mjs
git commit -m "test: prevent eager cloud bundle regressions"
```

## Task 5: Full verification, measurement, and independent review

**Files:**
- Modify only if a verified test/review finding requires a fix.
- Record measured results in the final handoff; do not add a monitoring dependency.

- [ ] **Step 1: Run focused and broad verification**

```bash
npm run lint
npx vitest run src/features/landing/LandingAssets.test.ts src/app/appCompositionRoot.test.ts src/app/AppDeferredViews.test.tsx src/app/appDependencies.test.ts src/lib/firebase.test.ts src/lib/protectedFunctionsCapability.test.ts src/features/gamification/firebaseGamificationStore.test.ts src/features/session/identitySessionController.test.ts
npm run build
npm run verify:bundle
npx playwright test e2e/landing-performance.spec.ts e2e/motion-remediation.spec.ts e2e/app-shell-remediation.spec.ts --project=chromium
npx playwright test e2e/motion-remediation.spec.ts --project=firefox --project=webkit
```

Expected: every command exits 0.

- [ ] **Step 2: Measure three comparable Lighthouse runs**

Run the production preview and collect three mobile Lighthouse JSON reports for `/?view=landing` under the same throttling/profile used for baseline. Compare medians for performance, FCP, LCP, TBT, CLS, total transfer, media transfer, and unused JS.

Required evidence:

- No cold Firebase/Auth/App Check/reCAPTCHA/device-sync request.
- Media transfer reduced at least 75% from the 14.3 MB run.
- Median LCP at or below 2.5 seconds where the test environment is stable.
- CLS at or below 0.01 and TBT at or below 100 ms.
- Initial JavaScript and chunk graph reported by `verify:bundle`.

- [ ] **Step 3: Compare visuals and motion**

Capture before/after landing screenshots at desktop and mobile widths and a real-browser video/trace of all four background switches. Confirm the same crop, overlay alpha, typography, DOM interaction targets, 1-second crossfade, reduced-motion behavior, and train-bob effect. Treat headless software-decoder dropped frames as diagnostic, not final GPU evidence.

- [ ] **Step 4: Run two independent ASSURANCE reviews**

Dispatch one read-only technical reviewer over the complete branch diff and one separate security reviewer focused on Firebase initialization order, App Check fail-closed behavior, sign-in dispatch, epoch gating, owner isolation, and sticky session lifetime. Fix every substantiated Critical/Important finding, re-run its affected test, and send it back to the same reviewer for re-review.

- [ ] **Step 5: Final verification and branch handoff**

Run `git diff --check`, `git status --short`, and the full focused command set again after review fixes. Report exact before/after medians, asset sizes/SSIM, test counts, review disposition, and any real-device measurement that could not be performed. Do not deploy without a separate release request.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Lazy sign-in loses popup activation | Medium | Retain the existing redirect fallback; never bypass Auth/App Check. |
| Runtime remount resets owner/session guards | High | Stable sibling position and sticky activation; browser navigation test plus existing A→B→A suites. |
| AV1 unsupported on a client | Medium | Native ordered `<source>` with H.264 fallback. |
| Compression changes visible motion | Medium | SSIM ≥0.985, exact frame/duration checks, cross-browser and side-by-side visual review. |
| New deployment strands old asset URLs | Low | Vite content hashes plus existing immutable `/assets/**` cache policy and non-cacheable HTML. |
| Headless performance variance | Medium | Three-run medians and explicit environment conditions; real-device/GPU trace for final animation judgment. |

## Checkpoints

- After Tasks 1–2: local assets meet codec/quality gates and the existing landing motion test passes.
- After Task 3: direct cold landing is cloud-free and the existing security/data tests pass.
- After Task 4: generated HTML cannot preload Firebase and the tightened bundle budget passes.
- After Task 5: measurements, visual evidence, technical review, and security review are resolved.
