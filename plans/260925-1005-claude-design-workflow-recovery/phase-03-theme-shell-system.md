---
title: "Dựng lại shell, theme và system states từ Canvas"
status: completed
---

# 03. Dựng lại shell, theme và system states từ Canvas

## Kết quả và phụ thuộc

01; nền cho mọi màn.

Hoàn tất local ngày 25/09/2026. [Báo cáo nghiệm thu](../reports/verification-260925-1710-shell-system.md) ghi source tree, gates, ảnh đối chiếu và các workflow còn thuộc phase sau. Chưa deploy.

Ước lượng: 2–3 ngày. Đây là công sức kỹ thuật dự kiến, không phải hạn giao; bao gồm sửa và verify phần phase. Trạng thái hiện tại lấy từ audit, chưa task nào được đánh dấu đạt chỉ vì có patch.

## Nguồn và file sở hữu

Nguồn: Canvas tokens.js/anime-tokens.js, partials.html, AnimeSystem/SystemStates, AnimeFeedback/FeedbackSheet, AnimeMobile, AnimeSettings; frontend phases 03,05.

Đường dẫn dưới đây tương đối với `/mnt/Projects/startup/flash-card` cho đến khi phase migration đổi root theo source plan.

src/components/shell/**; src/components/{AppOverlays,AppErrorBoundary,RecoverableActionFeedback}.tsx; src/app/{AppRuntime,AppViewStage,AppDeferredViews}.tsx; src/styles/shell.css; src/styles/themes/**; src/features/theme/**; Lumi; settings appearance.

File `proposed` là file/module cần tạo, không phải tuyên bố đã tồn tại. File chung do controller chỉnh tuần tự theo [ownership](acceptance-contract.md).

## Công việc cụ thể

| Task | Thực hiện | Điều kiện đạt |
|---|---|---|
| 03.1 | Lấy kích thước header/nav, khoảng cách, font, active tab, avatar, XP và quick theme toggle từ source; không giữ shell cũ rồi chỉ đổi màu. | Bốn theme đúng chuẩn; số XP/streak không dựng giả; course slot đủ chỗ để phase 10 thay bằng switcher thật. |
| 03.2 | Làm mobile nav/menu, safe-area và scrolling theo AnimeMobile/Mobile*; icon/label/focus và account panel đầy đủ. | 390px không che CTA; keyboard và touch đều mở được language/settings/account. |
| 03.3 | Làm loading/skeleton, empty, offline/sync pending, expired session, error boundary, toast/undo/retry theo board. | Mỗi feedback có trigger và recovery thật; không toast thành công khi save fail. |
| 03.4 | Hoàn thiện Appearance: mọi theme đổi trực tiếp, system follow, light/dark within family, Lumi và reduced motion, sound. | Không reload hoặc flash sai theme; Lumi off không mất thông tin; persistence local/account được phân biệt đúng. |
| 03.5 | Loại style/layout cũ trong phạm vi đã thay sau khi so hình đạt; kiểm tra legal/18+ và analytics ở shell. | Không còn hai shell chồng nhau, hidden focus target hoặc hệ typography cũ đè CSS mới. |

## Checklist

- [x] 03.1 — Lấy kích thước header/nav, khoảng cách, font, active tab, avatar, XP và quick theme toggle từ source; không giữ shell cũ rồi chỉ đổi màu.
- [x] 03.2 — Làm mobile nav/menu, safe-area và scrolling theo AnimeMobile/Mobile*; icon/label/focus và account panel đầy đủ.
- [x] 03.3 — Làm loading/skeleton, empty, offline/sync pending, expired session, error boundary, toast/undo/retry theo board.
- [x] 03.4 — Hoàn thiện Appearance: mọi theme đổi trực tiếp, system follow, light/dark within family, Lumi và reduced motion, sound.
  > Kiểm tra 2026-09-27: đã gỡ `LumiBubble` và test chỉ phục vụ component này vì không còn caller trong `src/` hoặc `e2e/`; `Lumi.tsx` cùng test của nó vẫn hoạt động. `npm run lint` pass; `npx vitest run src/components` pass 28 file / 134 test.
- [x] 03.5 — Loại style/layout cũ trong phạm vi đã thay sau khi so hình đạt; kiểm tra legal/18+ và analytics ở shell.
- [x] Đối chiếu Canvas từng state của phase theo board/artboard inventory; reviewer kiểm tra cả hành vi và hình thức.
- [x] Chạy focused checks rồi gates; ghi revision, kết quả và ngoại lệ trong log.

## Verification

**Đổi theme khi chạy — 2026-10-03.** Classic chỉ chuyển sang Crystal sau khi CSS/tài nguyên Crystal đã tải; context và root dùng cùng family đã áp dụng trong thời gian chờ. Link Crystal đã lỗi được tạo lại để retry, và đổi nhanh theme hoặc system mode trong khi tải không ghi đè lựa chọn cuối. Theme tests 13/13, toàn `src` 2519/2519, lint, build và bundle đạt. Ảnh first-paint của Crystal đã lưu trong trình duyệt thật vẫn cần Chromium/Canvas; chưa coi việc kiểm mã là nghiệm thu hình ảnh.

**Nhãn mobile Crystal — 2026-10-03.** Tab Library trong bottom nav Crystal nay hiện “Words”/“Từ” theo MobileToday; Classic vẫn là “Vocabulary”, desktop vẫn là “Collection”, route và icon giữ nguyên. Focused nav 3/3, toàn frontend 292 file/2.662 test, lint, i18n 12 catalog, build/bundle đạt. Ảnh mobile hiện tại cần chạy lại bằng Chromium và so Canvas trước khi coi nhãn/layout đã nghiệm thu hình ảnh.

AppNavigation và theme/settings tests; e2e/ui-shell.spec.ts, e2e/settings-appearance.spec.ts, accessibility.spec.ts; Canvas comparisons + gates chung.

Hợp đồng chung: [acceptance-contract.md](acceptance-contract.md). Tên test mới là đề xuất; trước chạy phải kiểm inventory file thực, không báo file vắng là PASS. Với flow có mutation, test dùng emulator/fixtures, không dữ liệu người học hay Gemini thật.

## Rủi ro và rollback

src/index.css/AppRuntime/navigation là file chung, chỉ controller sửa. Chênh contrast phải có evidence; không tự đổi palette.

Rollback theo commit scope hoặc flag additive đã review; không delete/reset dữ liệu hay dirty work. Bước phụ thuộc sau chỉ nhận contract đã kiểm chứng. Không deploy trong công việc lập kế hoạch này.
