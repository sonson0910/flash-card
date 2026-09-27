---
title: "Nghiệm thu theo mốc và bàn giao có bằng chứng"
status: todo
---

# 13. Nghiệm thu theo mốc và bàn giao có bằng chứng

## Kết quả và phụ thuộc

Các phase thuộc mốc tương ứng. Mốc cuối chỉ đạt khi14/15 và mọi board required đều đạt hoặc owner đổi phạm vi cụ thể.

Ước lượng: 2–4 ngày cho mỗi đợt tích hợp lớn; phụ thuộc số lỗi. Đây là công sức kỹ thuật dự kiến, không phải hạn giao; bao gồm sửa và verify phần phase. Trạng thái hiện tại lấy từ audit, chưa task nào được đánh dấu đạt chỉ vì có patch.

## Nguồn và file sở hữu

Nguồn: acceptance-contract.md; board/artboard inventories; mọi phase; e2e suite; source reports.

Đường dẫn dưới đây tương đối với `/mnt/Projects/startup/flash-card` cho đến khi phase migration đổi root theo source plan.

e2e/**; evidence trong plans/reports hoặc plan evidence directory; ui-track-log/roadmap track-log; plan status; không tự sửa baseline Canvas.

File `proposed` là file/module cần tạo, không phải tuyên bố đã tồn tại. File chung do controller chỉnh tuần tự theo [ownership](acceptance-contract.md).

## Công việc cụ thể

| Task | Thực hiện | Điều kiện đạt |
|---|---|---|
| 13.1 | Đối chiếu từng dòng board/artboard với route/action, state và test; tìm orphan button/view/menu. | Coverage112 source+10 seed+219 artboard accounted; paired states không bị bỏ vì board summary đãchecked. |
| 13.2 | Chạy journey tổng: new→onboard→course→capture/create→daily→edit→recap→weekly→reminder; legacy/offline/account switch; share/extension. | Mọi entry point và return path có assertions; người test đi qua UI, không chỉ mount component và chụp. |
| 13.3 | So Canvas trực tiếp bốn theme × desktop/mobile và trạng thái critical; gate a11y, motion, vi/en/pseudo và languages được mở. | Visual mismatch report rỗng hoặc có ngoại lệ cụ thể được chấp nhận; không refresh hàng loạt snapshot để che mismatch. |
| 13.4 | Chạy toàn bộ gates và cross-browser critical flows; review cross-module/contract/performance. | lint/core/build/bundle/i18n/extension cùng source state; skipped/flake ghi đúng; không nhận screenshot pass là feature pass. |
| 13.5 | Ghi log sau từng phase, commit theo quyền đã có và handoff checklist còn lại cho Claude/owner. | Commit chỉ file scope, có revision và test evidence. Không gọi toàn bộ xong nếu còn gate hoặc workflow chưa implement. |
| 13.6 | Lập release checklist và rollback artifact; phân biệt local/staging/production revision. | Không deploy ở task này; link website cũ không được mô tả là UI mới. |

> **Staleness audit 2026-09-26** ([report](../reports/planner-260926-2229-old-plan-staleness-audit.md)).
> - 13.1, 13.3, 13.5, 13.6 STILL VALID.
> - 13.2 NEEDS REWRITE: thay "legacy/offline/account switch" bằng "legacy (đã backfill language) / mất mạng báo lỗi trung thực và retry cùng operationId / sign-out về landing / đổi account". Journey bắt đầu bằng sign-in; không còn nhánh guest.
> - 13.4 NEEDS REWRITE (nhỏ): harness e2e hiện không có Functions emulator (`package.json:36`), nên các flow review/create/bulk không chạy được. Đây là điều kiện tiên quyết (phase 05 task 05.0). Thêm `npm run test:rules` và test Functions vào bộ gate vì Rules đã bị cắt gọn và có callable bulk mới.

## Checklist

- [ ] 13.1 — Đối chiếu từng dòng board/artboard với route/action, state và test; tìm orphan button/view/menu. — Audit 2026-09-27 xong phần đếm: 245 covered, 36 implemented-untested, 9 missing (AnimeReveal ceremonies thuộc 04; drill LangPractice/AnimeLangPractice thuộc 09), 51 out-of-scope-locked. Orphan: `openStats` không caller (insights không tới được), `DeckCreationForm` và `LumiBubble` chỉ còn trong test/không dùng, nút "Learn 5 new" ở `TodayScreen` luôn disabled; `LibraryClearDialog` đã nối (`33e94e2`). Course switcher/goals/settings/onboarding (10) chưa có test render. Chưa tick vì orphan và missing còn mở.
- [ ] 13.2 — Chạy journey tổng: new→onboard→course→capture/create→daily→edit→recap→weekly→reminder; legacy/offline/account switch; share/extension.
- [ ] 13.3 — So Canvas trực tiếp bốn theme × desktop/mobile và trạng thái critical; gate a11y, motion, vi/en/pseudo và languages được mở.
- [ ] 13.4 — Chạy toàn bộ gates và cross-browser critical flows; review cross-module/contract/performance.
- [ ] 13.5 — Ghi log sau từng phase, commit theo quyền đã có và handoff checklist còn lại cho Claude/owner.
- [x] 13.6 — Lập release checklist và rollback artifact; phân biệt local/staging/production revision. Xem [release-checklist.md](release-checklist.md) (snapshot 2026-09-27, không deploy).
- [ ] Đối chiếu Canvas từng state của phase theo board/artboard inventory; reviewer kiểm tra cả hành vi và hình thức.
- [ ] Chạy focused checks rồi gates; ghi revision, kết quả và ngoại lệ trong log.

## Verification

npm run verify:core; npm run build; npm run verify:bundle; npm run i18n:check; npm run extension:check; selected Chromium/Firefox/WebKit and mobile review suites; audit release-specific checks khi bước đó được phép.

Hợp đồng chung: [acceptance-contract.md](acceptance-contract.md). Tên test mới là đề xuất; trước chạy phải kiểm inventory file thực, không báo file vắng là PASS. Với flow có mutation, test dùng emulator/fixtures, không dữ liệu người học hay Gemini thật.

## Rủi ro và rollback

Review agreement không thay thực nghiệm. Trước start preview kiểm PID/port, dừng process do phiên tạo khi xong; không giết process của user.

Rollback theo commit scope hoặc flag additive đã review; không delete/reset dữ liệu hay dirty work. Bước phụ thuộc sau chỉ nhận contract đã kiểm chứng. Không deploy trong công việc lập kế hoạch này.
