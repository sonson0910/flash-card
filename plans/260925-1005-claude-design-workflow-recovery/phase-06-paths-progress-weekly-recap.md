---
title: "Paths, Progress, thành tích và recap tuần"
status: todo
---

# 06. Paths, Progress, thành tích và recap tuần

## Kết quả và phụ thuộc

05; course scoping được hoàn tất ở 10.

Ước lượng: 2–4 ngày. Đây là công sức kỹ thuật dự kiến, không phải hạn giao; bao gồm sửa và verify phần phase. Trạng thái hiện tại lấy từ audit, chưa task nào được đánh dấu đạt chỉ vì có patch.

## Nguồn và file sở hữu

Nguồn: PathsScreen/AnimePaths; ProgressScreen/AnimeProgress; AchievementsScreen/AnimeAchievements; WeeklyRecap/AnimeWeeklyRecap; frontend 10.

Đường dẫn dưới đây tương đối với `/mnt/Projects/startup/flash-card` cho đến khi phase migration đổi root theo source plan.

src/features/catalogWorkspace/**; src/features/dailyLearning/Progress*.tsx; src/components/stats/**; proposed src/features/weeklyRecap/**; session result read model.

File `proposed` là file/module cần tạo, không phải tuyên bố đã tồn tại. File chung do controller chỉnh tuần tự theo [ownership](acceptance-contract.md).

## Công việc cụ thể

| Task | Thực hiện | Điều kiện đạt |
|---|---|---|
| 06.1 | Paths chọn mục tiêu/track, preview/provenance/download/activate/continue; tách personal route và catalog được duyệt trong đúng bố cục Canvas. | Dữ liệu chưa có dùng state unavailable, nhưng ready fixture phải nghiệm thu được full composition; không lấy empty screen để ký xong Paths. |
| 06.2 | Progress: hero, heatmap, chart, nhớ/yếu/mới, timeline và actionable drilldown. | Mỗi control thay dữ liệu thật; không gộp XP toàn account thành course progress; empty XP không tự thêm điểm giả. |
| 06.3 | Achievements: locked/progress/unlocked, nhóm tier, detail và milestone trong recap/Today. | Eligibility đọc model thật; điều kiện/XP bonus chưa chốt đi phase 15, không dùng nhãn sample như đã đạt. |
| 06.4 | Weekly recap từ lịch sử thật: date range, learned/reviewed/recall nếu đủ dữ liệu, word of week, heatmap, selection toggles và caption. | Định nghĩa mỗi metric được test; không suy study time từ số thẻ; không có data thì không dựng best week. |
| 06.5 | Share/download recap: PNG có đúng lựa chọn, Web Share/copy/download fallback, preview privacy. | Mặc định không đưa tên/từ riêng không được chọn; không tự đăng mạng xã hội; referral reward gắn phase 15 khi mở. |

## Checklist

- [ ] 06.1 — Paths chọn mục tiêu/track, preview/provenance/download/activate/continue; tách personal route và catalog được duyệt trong đúng bố cục Canvas.
- [ ] 06.2 — Progress: hero, heatmap, chart, nhớ/yếu/mới, timeline và actionable drilldown.
- [ ] 06.3 — Achievements: locked/progress/unlocked, nhóm tier, detail và milestone trong recap/Today.
- [ ] 06.4 — Weekly recap từ lịch sử thật: date range, learned/reviewed/recall nếu đủ dữ liệu, word of week, heatmap, selection toggles và caption.
- [ ] 06.5 — Share/download recap: PNG có đúng lựa chọn, Web Share/copy/download fallback, preview privacy.
- [ ] Đối chiếu Canvas từng state của phase theo board/artboard inventory; reviewer kiểm tra cả hành vi và hình thức.
- [ ] Chạy focused checks rồi gates; ghi revision, kết quả và ngoại lệ trong log.

## Verification

Stats/ActivityHeatmap/catalog tests; e2e/paths-progress-visual.spec.ts và catalog-workspace.spec.ts; new weekly-recap unit+export journey; gates chung.

Hợp đồng chung: [acceptance-contract.md](acceptance-contract.md). Tên test mới là đề xuất; trước chạy phải kiểm inventory file thực, không báo file vắng là PASS. Với flow có mutation, test dùng emulator/fixtures, không dữ liệu người học hay Gemini thật.

## Rủi ro và rollback

Images/share có thể chứa nội dung học cá nhân. Chỉ export khi user thao tác; tránh đưa private fixture/data thật vào repo.

Rollback theo commit scope hoặc flag additive đã review; không delete/reset dữ liệu hay dirty work. Bước phụ thuộc sau chỉ nhận contract đã kiểm chứng. Không deploy trong công việc lập kế hoạch này.
