# Báo cáo catalog và i18n pilot surfaces

## Dịch còn thiếu ở phase 01.4

Đã hoàn tất 17 bản dịch tiếng Việt bị trống trong catalog có sẵn:

- `src/i18n/locales/vi/library.po` — 16 ID: `common.close`, `flashcard.edit`, `library.canvas.search-placeholder`, `library.card.bookmark`, `library.card.delete`, `library.card.detail-title`, `library.card.due-now`, `library.card.grade.learning`, `library.card.grade.mastered`, `library.card.grade.new`, `library.card.open-details`, `library.card.tier.learning`, `library.card.tier.mastered`, `library.card.tier.new`, `library.card.unseen`, `library.card.word`.
- `src/i18n/locales/vi/landing.po` — 1 ID: `shell.theme.quick-toggle`.

## Hardcode ở năm component được mở thêm

Thay copy giao diện hoặc nhãn trợ năng bằng Lingui messages trong các file thuộc quyền sở hữu bổ sung:

- `src/components/shell/DesktopNavigation.tsx`: chip hiển thị dùng message `shell.level.short` với đúng dạng `Lv {level}` như Canvas; aria label vẫn đầy đủ (`Level {level}, {xp} XP`, được dịch theo UI locale). Chữ cái S của dấu hiệu thương hiệu dùng `shell.brand.mark`, giữ nguyên S trong EN/VI.
- `src/features/landing/LandingPage.tsx`: nhãn “Crystal Star”, aria label mẫu, sáu nhãn grade/status và bốn dòng ribbon đã vào catalog. Headword và IPA chuyển vào `crystalDemoWords` vì là nội dung từ vựng tiếng Anh. Ba nghĩa mẫu dùng message riêng để theo UI locale. Wordmark SON/FLASH dùng `landing.brand.crystal-wordmark` và giữ nguyên thương hiệu EN/VI. Badge VI giữ nguyên tên chủ đề `Crystal Star`.
- `src/features/library/LibraryCardGrid.tsx`: aria label `Library pages` dùng `library.grid.pages-nav`.
- `src/features/library/LibraryOverview.tsx`: chữ ký mascot dùng `library.overview.lumi-signature`; bản VI giữ nguyên đúng lockup `LUMI · LINK`.
- `src/features/library/LibraryScreen.tsx`: aria label của tablist Decks dùng `library.decks.nav-label`.

Các ID mới được trích xuất và dịch trong catalog tiếng Việt:

- `landing.po` — 16 ID: `landing.brand.crystal-wordmark`, `landing.demo.cards.label`, `landing.demo.grade.bloom`, `landing.demo.grade.bud`, `landing.demo.grade.star`, `landing.demo.meaning.immediate`, `landing.demo.meaning.instant`, `landing.demo.meaning.spelling`, `landing.demo.tier.learning`, `landing.demo.tier.mastered`, `landing.demo.tier.new`, `landing.hero.crystal-badge`, `landing.ribbon.chrome-extension`, `landing.ribbon.context-first`, `landing.ribbon.learn-at-your-pace`, `landing.ribbon.spaced-review`.
- `library.po` — 3 ID: `library.decks.nav-label`, `library.grid.pages-nav`, `library.overview.lumi-signature`.
- `shell.po` — 2 ID: `shell.brand.mark`, `shell.level.short` (`{level}` được giữ nguyên).

Extraction cũng cập nhật các catalog EN và en-XA tương ứng. Snapshot hash trước/sau cho thấy extraction không thay đổi catalog ngoài landing/library/shell. Catalog en-XA được runtime tạo từ tiếng Anh để pseudo-localize.

## Sửa theo review i18n ngày 25/9

- `shell.level.short`: source, EN và VI dùng `Lv {level}` để giữ chip gọn đúng Canvas; placeholder `{level}` không đổi. Aria label riêng vẫn đầy đủ `Level {level}, {xp} XP` trong source và bản dịch VI `Cấp {level}, {xp} XP`.
- `landing.hero.crystal-badge`: bản VI giữ đúng tên thương hiệu/chủ đề `Crystal Star`.
- `library.overview.lumi-signature`: bản VI giữ nguyên chữ ký `LUMI · LINK`.

## Audit read-only các pilot surface

Các phát hiện này chưa được sửa trong lượt hiện tại; phase 12.3 là owner theo plan.

| File / dòng | Bằng chứng | Owner / việc cần làm |
|---|---|---|
| `src/features/billing/UpgradeDialog.tsx:21,32,39-49` | Tiêu đề, trạng thái, thông tin gói, disclosure, lỗi, legal copy và nút đang là chuỗi literal tiếng Việt; component không dùng Lingui. | Phase 12.3, billing catalog. `billing.po` EN/VI hiện chỉ có header. |
| `src/features/plan/PlanUsageMeter.tsx:16,19-29` | Có “AI cards” tiếng Anh, quota/cảnh báo tiếng Việt, và ngày tháng ghim vào `vi-VN`. | Phase 12.3, billing catalog; dùng message ICU cho số lượng và format ngày theo locale UI. |
| `src/features/account/AccountDataSection.tsx:21,30,35-57` | Copy export/xóa, trạng thái, lỗi và close label đều là literal tiếng Việt. | Phase 12.3, account catalog. `account.po` EN/VI hiện chỉ có header. |
| `src/features/cardReport/ReportCardDialog.tsx:6-13,51-100`; `src/features/cardReport/cardReportService.ts:25-29,44,48-59` | Lý do báo thẻ, form/help/status/error copy hardcode; component hiển thị lỗi từ service tại `ReportCardDialog.tsx:38`. | Phase 12.3; `lingui.config.ts` chưa có area `cardReport`, nên cần thêm catalog ownership trước khi trích xuất. |
| `lingui.config.ts:15-16` | Billing đã include `src/features/billing` và `src/features/plan`; account đã include `src/features/account`. | Catalog đã được cấu hình nhưng message chưa được chuyển từ literal. |
| `src/i18n/migratedFiles.ts:1-62` | Bốn pilot source trên chưa nằm trong danh sách kiểm soát string scanner. | Phase 12.3 thêm từng file sau khi đã đưa toàn bộ copy vào catalog. |

`XÓA TÀI KHOẢN` là chuỗi xác nhận có hợp đồng backend: `functions/src/index.ts:859-864` kiểm tra đúng cụm từ và `src/features/account/accountDataService.test.ts:107-117` xác nhận payload. Không dịch riêng hằng UI cho đến khi hợp đồng server đổi cùng lúc.

## Kiểm tra

- `npm run i18n:extract` — PASS; landing/shell/library VI có lần lượt 77/77, 158/158, 209/209 message.
- `npm run i18n:compile` — PASS với `--strict`.
- `npm run i18n:check` — PASS; extraction ổn định, đủ message EN/VI trong 11 catalog.
- `npm run test -- --run src/i18n/stringScanner.test.ts src/components/shell/AppNavigation.test.tsx src/features/library/LibraryScreen.test.tsx src/features/library/LibraryCardGrid.test.tsx` — PASS, 4 file / 77 test.
- Quét catalog tiếng Việt — 0 bản dịch trống trong landing/library/shell.
- `git diff --check` cho các file thuộc scope — PASS.
- Repo không có render test chuyên biệt cho `LandingPage`; scanner và các render test shell/library liên quan đều PASS.
