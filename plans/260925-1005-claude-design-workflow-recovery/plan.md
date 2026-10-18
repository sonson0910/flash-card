---
title: "Tích hợp đầy đủ Claude Design và các workflow SonFlash"
description: "Khôi phục phạm vi toàn bộ màn hình, trạng thái và workflow; đối chiếu Canvas với code, thực thi theo phụ thuộc và nghiệm thu bằng bằng chứng."
status: in-progress
priority: P1
effort: "Ước lượng riêng từng phase; phần backend và kinh doanh có gate, chưa có ngày hoàn tất cam kết"
branch: feat/ui-redesign
tags: [frontend, redesign, workflow, extension, multilingual]
created: 2026-09-25
---

# Tích hợp đầy đủ Claude Design và các workflow SonFlash

## Kết quả cần giao

Toàn bộ màn được thiết kế để dùng trong sản phẩm phải trở thành màn/luồng hoạt động thật, đúng bố cục, typography, hình ảnh, chuyển động và trạng thái Canvas. Bao gồm màn chưa có trong app. Chỉ loại bản demo dùng để chọn hướng; không loại tính năng vì code hiện tại chưa có. Đây là kế hoạch sau rà soát ngày 25/09, chưa phải xác nhận triển khai hoàn tất.

**Chỉ đạo mới nhất:** user xác nhận mọi màn gen có chủ đích tích hợp, trừ demo lựa chọn. Quy tắc này thay thế cách hiểu cũ “chỉ restyle màn đang có”. Quyết định giá, quota, quyền riêng tư và điều kiện phát hành vẫn áp dụng; các màn có gate được giữ trong backlog.

Đọc [kết quả audit](../reports/audit-260925-1005-claude-design-workflow-gaps.md), [phạm vi và nguồn quyết định](scope-and-decisions.md), [danh mục board](board-inventory.csv), [danh mục artboard/trạng thái](artboard-inventory.csv), [hợp đồng nghiệm thu](acceptance-contract.md). Plan này thay thế checklist tổng quát `260925-0930-claude-design-fidelity`; không sửa lại lịch sử các log đã có.

## Phases

Tiến độ thực thi lấy từ checklist từng phase và [decision log](decision-log.md); cột cuối giữ hiện trạng lúc audit để không nhầm với nghiệm thu mới.

| # | Phase / kết quả | Phụ thuộc | Hiện trạng tại audit |
|---|---|---|---|
| 01 | [Chốt bằng chứng, kiểm kê và sửa nền đang dở](phase-01-start.md) | không | Chờ thực thi |
| 02 | [Shared deck giữ cặp ngôn ngữ](phase-02-shared-deck-language-contract.md) | 01 | Có patch chưa verify |
| 03 | [Theme, shell, mobile và system states đúng Canvas](phase-03-theme-shell-system.md) | 01 | Cần sửa và nghiệm thu lại |
| 04 | [Flashcard, Library, tạo/sửa thẻ và các sheet/dialog](phase-04-flashcard-library-sheets.md) | 03 | Có thiếu luồng, CTA tạo thẻ lỗi |
| 05 | [Phiên học liên tục và toàn bộ practice](phase-05-daily-session-and-practice.md) | 04 | Thiếu orchestration; visual chưa đạt |
| 06 | [Paths, Progress, thành tích và recap tuần](phase-06-paths-progress-weekly-recap.md) | 05 | Một phần; thiếu recap tuần |
| 07 | [Extension và vòng từ web vào bài học — A/B](phase-07-extension-and-web-words.md) | A:04,05; B:10 | Chưa tích hợp thiết kế mới |
| 08 | [Ports và hợp đồng ngôn ngữ trên Firebase](phase-08-firebase-data-ports.md) | 02; local trước G1 đã được phép | Chưa thực hiện |
| 09 | [Language packs Anh/Hàn/Nhật/Trung](phase-09-target-language-packs.md) | 08 | Chưa thực hiện |
| 10 | [Courses, Goals, onboarding và settings đầy đủ](phase-10-courses-goals-onboarding.md) | 07A, 08, 09 | Chỉ Appearance đã có |
| 11 | [Nhắc học, âm/rung, AI tiến trình và tutor — A/B](phase-11-reminders-and-ai-progress.md) | A:05,07A; B:10 + delivery gate | Thiếu chức năng/hợp đồng |
| 12 | [Landing và tài khoản/gói — A/B](phase-12-landing-account-plan-surfaces.md) | A:03; B:10,11B,15 | Một phần; có lỗi mobile/i18n |
| 13 | [Nghiệm thu từng mốc và bàn giao](phase-13-verification-and-handoff.md) | từng phạm vi đã xong | Chưa đạt |
| 14 | [Auth, upload, API/offline và hạ tầng có phụ thuộc backend](phase-14-backend-dependent-workflows.md) | gate migration hiện có | Giữ đầy đủ trong kế hoạch |
| 15 | [Pricing, checkout, Pro, referral, league và streak](phase-15-commercial-and-motivation-workflows.md) | quyết định kinh doanh; 14 khi cần | Giữ đầy đủ; chưa mở pilot |

## Thứ tự và phân công

Làm 01 trước. 02 và 03 độc lập; sau đó 04 → 05 → 06 → 07A. Lane đa ngôn ngữ: 08 → 09 → 10 → 07B. 11A chuẩn bị hợp đồng; 11B giao chức năng khi delivery gate đạt. 12A sửa landing/pilot hiện tại; 12B tích hợp các section còn lại sau tính năng tương ứng. 14–15 có gate riêng. [DAG và định nghĩa các mốc](dependency-map.md) loại vòng phụ thuộc; [ownership/gate chung](acceptance-contract.md) áp dụng cho mọi đơn vị nghiệm thu.

Mốc A: giao diện và workflow học hiện tại + shared deck được chứng minh đúng. Mốc B: extension, đa ngôn ngữ và onboarding hoạt động trên Firebase. Mốc C: các màn backend/kinh doanh còn lại hoạt động sau khi gate tương ứng được chốt. Không gọi “toàn bộ hoàn tất” khi B/C hoặc board nào còn thiếu.

## Điều kiện hoàn tất

- [x] Mỗi board/artboard có task, owner, trạng thái và bằng chứng; mọi demo bị loại có nguồn chứng minh là demo lựa chọn (`evidence/board-artboard-coverage-260929.csv`: 341 dòng duy nhất, 323 `covered`, 18 `out-of-scope-locked`).
- [x] Mỗi màn thuộc phạm vi Mốc A/B và các phần pilot/local của Phase 14/15 đạt cả visual Canvas và hành vi thực, đủ trạng thái trên desktop/mobile và bốn tổ hợp theme trên emulator + browser; bộ Canvas reference cho 14.2/14.3/15.x đã render và kiểm chứng đủ `445/445 PNG`.
- [x] Các flow local/pilot thuộc phase 01–15 chạy xuyên suốt trên Auth/Firestore/Functions emulator; dữ liệu, FSRS, quota, purchase intent, idempotent payment entitlement settlement, account export/delete và pilot analytics đúng.
- [x] Verify từng phase, review độc lập, cập nhật `decision-log.md`; mọi snapshot cập nhật đều đã qua rà soát trực tiếp.
- [ ] Mọi gate hạ tầng/cloud/thương mại thật còn mở (`09.6` staging release, `11.2/11.4/11.5` live FCM/Resend/Gemini staging, `phase-14` quyết định chuyển khỏi Firebase & backend self-hosted, `phase-15` quyết định VAT, gateway và chính sách thưởng cho checkout/referral/league/streak freeze-repair) được chốt và nghiệm thu; không deploy trong công việc hiện tại.

## Validation

Nguồn: 112 source boards, 10 seed components, 219 artboards; phiên Claude gốc được đọc theo các mốc quyết định; current worktree được kiểm tra mã và browser. `npm run lint` đạt; `npm run i18n:check` đạt. Chi tiết, giới hạn audit và kiểm tra link/coverage nằm trong [audit](../reports/audit-260925-1005-claude-design-workflow-gaps.md). Trạng thái phase là tiến độ triển khai, không phải tiến độ viết plan. Review độc lập đã sửa phụ thuộc07↔10 và tách11A/B,12A/B. Schema CLI và toàn bộ link/coverage đã kiểm. Owner cho phép code/test local 08–10 trước G1; chưa coi gate phát hành G1 đã đạt.

**Rà soát tiến độ 2026-10-15.** [Báo cáo sửa UI](../reports/review-261015-1417-ui-remediation.md) cùng các lượt nghiệm thu local đã hoàn tất **13/15 phase (`01`–`13` done)** và toàn bộ phần code/contract/test local của **Phase 14 & Phase 15** (`status: in-progress`): đồng bộ 341 dòng trong `evidence/board-artboard-coverage-260929.csv` (`323 covered`, `18 out-of-scope-locked`), xác nhận `445/445` Canvas reference PNGs (`render-reference.mjs --check`), cập nhật bảng ánh xạ migration đầy đủ theo code thực tế tại `backend/phase-07-firebase-migration-tooling.md`, hoàn thiện đối soát entitlement idempotent (`settlePaymentProEntitlement`) và xuất/xóa đủ 22 subcollections/collections tại `accountData.ts`, cùng nghiệm thu E2E emulator cho Phase 14/15 (`e2e/landing-locales.spec.ts`, `e2e/landing-dialogs-visual.spec.ts`, `e2e/account-signout-emulator.spec.ts`, `e2e/anime-reveal-journey.spec.ts`, `e2e/anime-reveal-visual.spec.ts`, `e2e/gamification-two-device-sync.spec.ts`). Hai phase 14 và 15 giữ trạng thái `in-progress` vì quyết định chuyển khỏi Firebase (`R1`), thuế VAT, chọn cổng thanh toán (gateway) và chính sách thưởng đầy đủ vẫn mở theo [decision log](decision-log.md).

## Quyết định còn cần chốt trước phần phụ thuộc

Các gate về G1, kênh nhắc học, số liệu gamification, thanh toán và migration được liệt kê tại [scope-and-decisions.md](scope-and-decisions.md). Chúng không ngăn việc rà soát/thiết kế task và không cho phép bỏ màn.

<!-- slug: claude-design-workflow-recovery -->
