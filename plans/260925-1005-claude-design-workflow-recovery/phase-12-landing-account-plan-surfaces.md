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

- [ ] 12.1 — Landing đúng hero/card collage/ribbon/demo/sections desktop/mobile; theme variants lấy trực tiếp Canvas source.
- [ ] 12.2 — Gộp Sales/LangLanding thành sections của landing canonical: value/demo/process/extension/language offer/pricing khi hợp lệ.
- [ ] 12.3 — Pilot quota/upgrade/report/account export/delete/legal/18+ đầy đủ EN/VI và Canvas design.
- [ ] 12.4 — Giữ sonflash.app canonical/hreflang/sitemap, locale navigation và sign-in return flow; không hỏi lại domain.
- [ ] 12.5 — Performance/first paint/LCP kiểm ở tất cả theme, font/image lazy hợp lý, keyboard legal links.
- [ ] Đối chiếu Canvas từng state của phase theo board/artboard inventory; reviewer kiểm tra cả hành vi và hình thức.
- [ ] Chạy focused checks rồi gates; ghi revision, kết quả và ngoại lệ trong log.

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

## Verification

landing locale/visual/performance tests, check-locale-pages.mjs; pilot/account/report/quota component tests; E2E sign-in return/export/delete confirmation với fixtures; gates chung.

Hợp đồng chung: [acceptance-contract.md](acceptance-contract.md). Tên test mới là đề xuất; trước chạy phải kiểm inventory file thực, không báo file vắng là PASS. Với flow có mutation, test dùng emulator/fixtures, không dữ liệu người học hay Gemini thật.

## Rủi ro và rollback

Không công bố thông tin/giá/khả năng chưa có. Chỉ schema/markup policy, không tự ghi owner đã duyệt nội dung pháp lý.

Rollback theo commit scope hoặc flag additive đã review; không delete/reset dữ liệu hay dirty work. Bước phụ thuộc sau chỉ nhận contract đã kiểm chứng. Không deploy trong công việc lập kế hoạch này.
