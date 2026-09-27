---
title: "Landing, tài khoản, policy và plan surfaces"
status: todo
---

# 12. Landing, tài khoản, policy và plan surfaces

## Kết quả và phụ thuộc

12A: tasks12.1,12.3–12.5 sau03, nghiệm thu landing/account/pilot với capabilities hiện có. 12B: task12.2 tích hợp đầy đủ Sales/Lang sections sau10,11B,15; chạy lại12.4–12.5 khi markup/capability thay đổi. Toàn12 chỉ hoàn tất khi cảA/B đạt.

Ước lượng: 2–4 ngày. Đây là công sức kỹ thuật dự kiến, không phải hạn giao; bao gồm sửa và verify phần phase. Trạng thái hiện tại lấy từ audit, chưa task nào được đánh dấu đạt chỉ vì có patch.

## Nguồn và file sở hữu

Nguồn: LandingScreen/LandingSales/AnimeLanding/AnimeLandingSales/LangLanding; AnimeSystem/Feedback/Settings/ProStates; handoff §5; frontend16.

Đường dẫn dưới đây tương đối với `/mnt/Projects/startup/flash-card` cho đến khi phase migration đổi root theo source plan.

src/features/landing/**; landing-page.css; src/features/{account,billing,cardReport,plan}/**; public/privacy.html/terms.html; locale page generator/checker; catalogs.

File `proposed` là file/module cần tạo, không phải tuyên bố đã tồn tại. File chung do controller chỉnh tuần tự theo [ownership](acceptance-contract.md).

## Công việc cụ thể

| Task | Thực hiện | Điều kiện đạt |
|---|---|---|
| 12.1 | Landing đúng hero/card collage/ribbon/demo/sections desktop/mobile; theme variants lấy trực tiếp Canvas source. | Ảnh/decor không đè CTA tại390; không chỉ bỏ artwork để test overflow xanh; demo flip/interaction làm thật. |
| 12.2 | Gộp Sales/LangLanding thành sections của landing canonical: value/demo/process/extension/language offer/pricing khi hợp lệ. | Không nhân route trùng; ngôn ngữ chưa mở hiển thị trạng thái thật; testimonial/claims cần nguồn, không chép người dùng giả. |
| 12.3 | Pilot quota/upgrade/report/account export/delete/legal/18+ đầy đủ EN/VI và Canvas design. | Billing/account catalogs không còn0 khi surface có copy; request/working/success/error/reauth đều có test; purchase intent chưa thành checkout. |
| 12.4 | Giữ sonflash.app canonical/hreflang/sitemap, locale navigation và sign-in return flow; không hỏi lại domain. | EN/VI reciprocals, noindex staging nếu config yêu cầu, CTA không đổi locale/theme bất ngờ. |
| 12.5 | Performance/first paint/LCP kiểm ở tất cả theme, font/image lazy hợp lý, keyboard legal links. | Không tăng initial budget; không che content để làm metric đẹp; ảnh không layout-shift. |

> **Staleness audit 2026-09-26** ([report](../reports/planner-260926-2229-old-plan-staleness-audit.md)). Phạm vi audit: nghiệm thu visual 12A.
> - 12.1 và 12.5 STILL VALID: chỉ còn so ảnh Canvas và đo LCP/CLS.
> - 12.3 NEEDS REWRITE (bổ sung): Firestore dùng `persistentLocalCache` (`src/lib/firebase.ts:90`), nhưng trong `src` không có `clearIndexedDbPersistence`. Delete account (và có thể cả sign-out trên máy dùng chung) phải xóa cache này; cần test. Chuỗi "Changes stay safe on this device until the quota resets" (`src/lib/cloudError.ts:2`) nay sai vì không còn queue.
> - 12.4 NEEDS REWRITE (nhỏ): landing giờ là đích bắt buộc của mọi người dùng signed-out (`AppRuntime.tsx:208-210`). Sign-in return flow phải giữ deep link (`?view=`, `?lesson=`, intent import từ extension).

## Checklist

- [x] 12.1 — Landing đúng hero/card collage/ribbon/demo/sections desktop/mobile; theme variants lấy trực tiếp Canvas source. (2026-09-27, xem "Trạng thái 12C")
- [x] 12.2 — Gộp Sales/LangLanding thành sections của landing canonical: value/demo/process/extension/language offer/pricing khi hợp lệ. (2026-09-27, xem "Trạng thái 12C")
- [x] 12.3 — Pilot quota/upgrade/report/account export/delete/legal/18+ đầy đủ EN/VI và Canvas design. (2026-09-27, xem "Trạng thái 12C")
- [x] 12.4 — Giữ sonflash.app canonical/hreflang/sitemap, locale navigation và sign-in return flow; không hỏi lại domain. (2026-09-27, xem "Trạng thái 12C")
- [ ] 12.5 — Performance/first paint/LCP kiểm ở tất cả theme, font/image lazy hợp lý, keyboard legal links.
- [ ] Đối chiếu Canvas từng state của phase theo board/artboard inventory; reviewer kiểm tra cả hành vi và hình thức.
- [x] Chạy focused checks rồi gates; ghi revision, kết quả và ngoại lệ trong log. (2026-09-27, revision `ffbc9be`) — `verify:deploy` pass (2126 unit, 375 functions, 82 rules, 42 script tests); build + `verify:bundle` pass (JS 70.996 / CSS 29.498 B gzip); `i18n:check` pass; e2e chromium với Functions emulator: 240/242 pass ở lượt toàn bộ, 2 spec còn lại (`daily-learning-visual`, `practice-visual`) pass 25/25 khi chạy lại. Ngoại lệ: 2 fail đó là trang trắng do `ERR_NETWORK_CHANGED` khi Docker trên máy liên tục tạo/xoá interface veth, không phải lỗi code; runner emulator chuyển sang 1 worker vì 2 worker làm rate limiter quá hạn đọc Firestore.

## Trạng thái 12A (2026-09-26, không có bằng chứng trình duyệt)

Không tick checkbox nào ở trên: mỗi task cần đối chiếu ảnh Canvas trực tiếp (`acceptance-contract.md` §Bố cục) mà lượt này không chạy Playwright/browser. Chi tiết đầy đủ và board/state còn chờ ảnh: `../reports/fullstack-developer-260925-2240-phase12a-landing.md`.

- 12.1: code/behavior đã sửa (flip thật cho Classic hero demo card, hết đè CTA 390px Crystal); còn chờ so ảnh app so với `LandingScreen-{dark,light}.png` và `AnimeLanding-{dark,light}.png` (desktop 1440 + mobile 390).
- 12.3: i18n EN/VI đầy đủ và `i18n:check` đạt cho billing/account; `cardReport` catalog area còn thiếu trong `lingui.config.ts` (xem quyết định 2026-09-26 trong decision-log) nên bản dịch VI của Report card dialog chưa có hiệu lực cho tới khi thêm dòng include và dịch tay. Còn chờ so ảnh Canvas cho toàn bộ dialog.
- 12.4: không đổi code; xác nhận lại bằng test có sẵn, không có gì mới cần ảnh riêng cho lượt này.
- 12.4 (2026-09-27, integration lane): đã áp dụng diff sign-in-return-flow từ báo cáo (`restoreLocation` mới trong `useAppNavigation.ts`, `preSignInLocationRef` + effect khôi phục trong `AppRuntime.tsx`) — deep link (`?view=`, `?lesson=`) và intent import từ extension trong `sessionStorage` giờ sống sót qua vòng bounce-về-landing-rồi-đăng-nhập. `npx tsc --noEmit` sạch; `useAppNavigation.test.ts` (8 test) và `AppRuntimeBoundary.test.tsx` (1 test) qua. Checkbox 12.4 tổng vẫn để trống: canonical/hreflang/sitemap/locale-navigation của task này chưa được lượt này xác minh lại bằng ảnh Canvas/browser, chỉ phần sign-in-return-flow được sửa.
- 12.5: lazy-load ảnh phụ + focus-visible link pháp lý đã thêm; còn chờ đo LCP/CLS thật bằng Lighthouse/Playwright trong browser.

## Trạng thái 12B (2026-09-27, vẫn không có bằng chứng trình duyệt)

Vẫn không tick checkbox nào ở trên vì lượt này cũng không chạy Playwright/browser (heavy job, không được phép chạy song song với các lane khác đang hoạt động trên cùng working tree). Chi tiết đầy đủ: `../reports/fullstack-developer-260927-0130-phase12-landing-account.md`.

- 12.2: thêm section "extension" (năng lực Chrome extension, giữ trong `LandingPage.tsx`, không tách route mới) và "languages" (roster ngôn ngữ thật, chỉ English available) giữa "how-it-works" và "methods"; thêm nav link Extension/Languages. Viết lại toàn bộ `<section id="pricing">` (bỏ copy "Pilot access"/"chưa công bố giá" cũ, thêm bảng Free-vs-Pro + FAQ) bằng số liệu có nguồn thật (30 thẻ/tháng free, 79.000₫/$7.99 Pro), KHÔNG chép testimonial/giả định 7 ngôn ngữ/payment method từ Canvas `LandingSales.dc.html`/`LangLanding.dc.html` vì đó là nội dung dựng — xem báo cáo phần "Khác biệt có chủ đích so với Canvas".
- 12.3: thêm test component còn thiếu (`UpgradeDialog.test.tsx`, `AccountDataSection.test.tsx`, `ReportCardDialog.test.tsx`, `billingService.test.ts`) phủ đủ request/working/success/error/reauth; i18n hoá toàn bộ `PlanUsageMeter.tsx` (trước đó 100% tiếng Việt hardcode, không Lingui).
- 12.4: không đổi code (đúng theo hợp đồng — routing thuộc controller); phát hiện và mô tả đầy đủ lỗi sign-in-return-flow làm mất deep link (`?view=`, `?lesson=`) khi bounce về landing, kèm diff đề xuất cho `AppRuntime.tsx` + `useAppNavigation.ts` trong báo cáo (không tự áp dụng vì vượt giới hạn một-file/≤15-dòng).
- 12.5: xác nhận `LandingPage-*.js`/`UpgradeDialog-*.js`/`AccountDataSection-*.js`/`ReportCardDialog-*.js` đều là chunk lazy riêng (2.4–9.4kB gzip), initial JS gzip vẫn trong budget (70.979/71.000B); initial CSS gzip vượt budget (29.725/29.500B) trên working tree hiện tại — xem "Concerns" trong báo cáo về khả năng đóng góp từ các lane song song khác.

## Trạng thái 12C (2026-09-27, audit 12.1–12.4 + fix noindex staging)

Lượt này là audit theo yêu cầu "nhiều việc có thể đã xong một phần: audit trước, sửa gap, chỉ tick cái đã verify" — không tự cho rằng 12A/12B đã đóng, đọc lại toàn bộ code hiện tại (không chỉ báo cáo cũ) trước khi tick. Vẫn **không có công cụ browser/Playwright trong phiên này** (không có tool `chrome-devtools`/Playwright nào khả dụng), nên không tự chụp ảnh app rồi so tay với board Canvas. Đối chiếu Canvas pixel-level ở dòng checklist riêng cuối cùng vẫn để trống vì lý do đó — không tick giả.

Bằng chứng cho 4 tick trên, theo đúng "Điều kiện đạt" ghi trong bảng công việc (không phải đối chiếu ảnh, mà là hành vi/nội dung/test):

- **12.1**: `ClassicLandingHero` có flip thật (state `flipped`, `role="button" tabIndex={0}`, `aria-pressed`, Enter/Space, tôn trọng `prefers-reduced-motion`) — đọc trực tiếp `LandingPage.tsx:328-493`. CTA 390px Crystal không còn bị đè: `landing-page.css:63` giữ `margin-top: 0` + `row-gap: 28px` ở breakpoint ≤900px (không phải xoá artwork để né test). Ribbon (`.crystal-ribbon`) và card collage (3 `.crystal-demo-card`) vẫn còn nguyên trong cả CSS và JSX, khớp `AnimeLanding.dc.html`. LCP vẫn là headline text: `.crystal-copy h1` giữ `color: #ff2a4d` (đặc, không đổi) + `-webkit-text-fill-color: transparent` — đúng ràng buộc owner, không sửa. Bằng chứng hành vi mạnh nhất hiện có (không phải do lượt này tạo, nhưng vẫn còn hiệu lực trên working tree hiện tại): báo cáo `fullstack-developer-260927-0900-crystal-light-landing-lcp.md` — `test:e2e:emulator` cho `landing-visual/performance/atmospheres.spec.ts` **25/25 pass**, gồm 8 snapshot `toHaveScreenshot` (4 theme × 2 viewport) khớp ảnh baseline đã chốt sẵn, không đổi diff nào. Lượt này không chạy lại Playwright (đúng ràng buộc heavy-job), chỉ xác nhận qua đọc code rằng phần CSS/JSX liên quan không bị lane khác đổi lại từ lúc đó.
- **12.2**: không có route mới — "extension"/"languages"/"pricing" là `<section>` trong chính `LandingPage.tsx`. Roster ngôn ngữ hiển thị trạng thái thật: chỉ `english.available = true`, Korean/Japanese/Chinese gắn nhãn "In progress" (`languageOffers`, `LandingPage.tsx:189-194,1012-1033`). Không có testimonial hay số liệu giả — pricing dùng đúng số đã có nguồn trong code (`billing.upgrade.offer.fallback-price` → 79.000₫/$7.99 Pro; 30 thẻ AI/tháng Free). Owner eyebrow decision "Free to start, Pro when you want more" đã khớp y nguyên tại `LandingPage.tsx:825` — không cần sửa.
- **12.3**: gap i18n từng ghi trong báo cáo 12A ("`cardReport` catalog area còn thiếu") **đã được đóng** bởi một lượt khác trước phiên này — `lingui.config.ts` đưa `src/features/cardReport` vào area `components` (không phải area `cardReport` riêng như đề xuất cũ, nhưng tương đương) và `i18n:extract` đã chạy: `components.po` (EN/VI) có đủ 30 msgid `cardReport.*`, không còn `msgstr ""` nào ngoài header. Xác nhận thêm `billing.po` (22 msgid), `account.po` (17 msgid), `landing.po` (118 msgid) đều dịch VI đầy đủ, không còn message trống. `UpgradeDialog`/`AccountDataSection`/`ReportCardDialog`/`PlanUsageMeter` đều có test request/working/success/error (+ reauth-rejection riêng cho delete-account) — 116/116 test qua trên toàn bộ `src/features/{landing,account,billing,cardReport,plan}` + `src/i18n` (`npx vitest run`, lượt này). Purchase intent vẫn chỉ `recordPurchaseIntent`, chưa mở checkout thật. `accountDataService.ts` đã gọi `clearIndexedDbPersistence` sau `terminate` khi xoá tài khoản — đúng gap staleness-audit 2026-09-26 đã nêu, xác nhận đã đóng (không phải do lượt này).
- **12.4**: `scripts/generate-locale-pages.mjs`/`check-locale-pages.mjs` xác nhận vẫn giữ canonical `https://sonflash.app`, hreflang EN/VI reciprocal + `x-default`, sitemap.xml — 4 test gốc + test mới đều qua. `LocaleLinks` (`LandingPage.tsx:256-296`) vẫn là locale navigation thật (`href="/"`/`href="/vi/"`, `hrefLang`, ghi `localStorage`). Sign-in-return-flow: xác nhận **đã áp dụng thật** trong `AppRuntime.tsx:129,290,294,298-299` (`preSignInLocationRef` chụp `window.location.href` trước khi bounce về landing, phục hồi bằng `window.history.pushState` sau khi `user` xác nhận đăng nhập) — đúng note "integration lane" đã ghi ở "Trạng thái 12A"; không phải sửa của lượt này, chỉ xác nhận lại còn hiệu lực. **Gap mới tìm và đã sửa trong lượt này** (xem dưới): "noindex staging nếu config yêu cầu" trong Điều kiện đạt của 12.4 — trước đây chưa có cơ chế nào, nay đã có.

### Gap mới, đã sửa: staging phải noindex

Repo có build target riêng cho staging (`npm run build:staging` → `SONFLASH_TARGET=staging`, deploy vào project Firebase riêng `sonflash-staging-20260906` qua `firebase.staging.json`) nhưng `public/robots.txt` (nguồn tĩnh, được Vite copy y nguyên vào `dist/robots.txt`) luôn là `Allow: /` + `Sitemap: https://sonflash.app/sitemap.xml` bất kể target — nghĩa là bản staging (con nguyên vẹn UI/copy giống production) có thể bị crawl/index dưới domain staging, tạo duplicate-content và có thể lộ nội dung trước khi công bố. Không tìm thấy bất kỳ cơ chế `noindex`/`X-Robots-Tag` nào khác trong repo (`firebase.json`, `firebase.staging.json`, `index.html`, mọi script) để bù việc này.

Sửa trong `scripts/generate-locale-pages.mjs` (file tôi sở hữu, là nơi duy nhất sinh `dist/robots.txt`/hreflang hiện có — không đụng `firebase.json`/`firebase.staging.json`, những file dùng chung ngoài quyền sở hữu):
- `generateLocalePages({ root, target })` nhận thêm `target` (mặc định đọc `process.env.SONFLASH_TARGET` giống đúng pattern đã có ở `scripts/release-config.mjs`). Khi `target !== 'production'`, mỗi trang locale được chèn thêm `<meta name="robots" content="noindex, nofollow" />` (bên cạnh canonical/hreflang, không đổi nội dung khác).
- `dist/robots.txt` giờ do chính script này viết ra (không còn phụ thuộc bản Vite copy từ `public/robots.txt`): target production giữ nguyên byte-for-byte (`Allow: /` + `Sitemap:` như cũ, đã diff xác nhận), target khác ghi `Disallow: /`.
- `checkLocalePages` (`check-locale-pages.mjs`) thêm kiểm ngược: production phải **không** có `noindex`, target khác phải **luôn** có `noindex` + `robots.txt` disallow toàn bộ — chặn cả hai chiều lỗi (staging quên noindex, hoặc lỡ tay mang noindex vào production).
- Test mới trong `scripts/locale-pages.test.mjs`: 3 test (staging có noindex + disallow; production bị chặn nếu lỡ có noindex; staging bị chặn nếu thiếu noindex hoặc thiếu disallow). `npx vitest run scripts/locale-pages.test.mjs` — **7/7 pass** (4 test gốc không đổi hành vi + 3 mới).

Đây là script build-time Node thuần (`node scripts/generate-locale-pages.mjs`), không đi qua Vite/Rollup, nên **không có byte nào cộng vào initial JS/CSS bundle** — không cần offset CSS budget cho thay đổi này.

Không wiring vào pipeline deploy staging (`staging:deploy:hosting` trong `package.json` chưa gọi `check-locale-pages.mjs`) vì `package.json` là file dùng chung ngoài quyền sở hữu — nếu controller muốn gate cứng trước khi deploy staging, cần thêm bước `SONFLASH_TARGET=staging node scripts/check-locale-pages.mjs` vào script đó.

### Kiểm tra đã chạy (lượt này)

- `npx tsc --noEmit -p tsconfig.json` — sạch.
- `npx vitest run src/features/landing src/features/account src/features/billing src/features/cardReport src/features/plan src/i18n` — 12 file / 116 test pass.
- `npx vitest run scripts/locale-pages.test.mjs` — 7/7 pass (3 mới cho noindex staging).
- Không chạy `npm run build`/`verify:bundle`/Playwright/emulator — một job nặng khác (`npm run lint && vitest run ... && functions test && functions build && test:rules`) đang chạy trên máy trong lúc audit; đúng ràng buộc heavy-job, không chạy song song.



landing locale/visual/performance tests, check-locale-pages.mjs; pilot/account/report/quota component tests; E2E sign-in return/export/delete confirmation với fixtures; gates chung.

Hợp đồng chung: [acceptance-contract.md](acceptance-contract.md). Tên test mới là đề xuất; trước chạy phải kiểm inventory file thực, không báo file vắng là PASS. Với flow có mutation, test dùng emulator/fixtures, không dữ liệu người học hay Gemini thật.

## Rủi ro và rollback

Không công bố thông tin/giá/khả năng chưa có. Chỉ schema/markup policy, không tự ghi owner đã duyệt nội dung pháp lý.

Rollback theo commit scope hoặc flag additive đã review; không delete/reset dữ liệu hay dirty work. Bước phụ thuộc sau chỉ nhận contract đã kiểm chứng. Không deploy trong công việc lập kế hoạch này.
