---
title: "Phiên học liền mạch và các mode luyện tập"
status: todo
---

# 05. Phiên học liền mạch và các mode luyện tập

## Kết quả và phụ thuộc

04. Phase 10 thêm course context sau, không viết lại hình thức.

Ước lượng: 4–6 ngày. Đây là công sức kỹ thuật dự kiến, không phải hạn giao; bao gồm sửa và verify phần phase. Trạng thái hiện tại lấy từ audit, chưa task nào được đánh dấu đạt chỉ vì có patch.

## Nguồn và file sở hữu

Nguồn: TodaySession/MobileToday/AnimeToday; SessionBridge/AnimeBridge; LessonScreen/PlacementScreen; RecapScreen/RecapNext/AnimeRecap; Quiz/Spelling/Match/Story/Shadowing và Anime twins; DlgPractice/AnimeDlgStudy; frontend 07,08.

Đường dẫn dưới đây tương đối với `/mnt/Projects/startup/flash-card` cho đến khi phase migration đổi root theo source plan.

src/features/dailyLearning/**; src/features/practice/**; src/components/study/**; src/app/useAppLearningCoordination.ts; src/features/navigation/useAppNavigation.ts.

File `proposed` là file/module cần tạo, không phải tuyên bố đã tồn tại. File chung do controller chỉnh tuần tự theo [ownership](acceptance-contract.md).

## Công việc cụ thể

| Task | Thực hiện | Điều kiện đạt |
|---|---|---|
| 05.1 | Today có một start/continue chính và timeline thực: review đến hạn → new words → Word Match → recap. Lập session state gồm stage, card IDs, progress và kết quả đã commit. | Không chuyển bằng các CTA rời rạc; zero due/new/match pool được skip có giải thích, không tạo sample card. |
| 05.2 | Implement Bridge đúng composition, carry session context, continue/skip; resume sau navigate/reload; exit lưu/abandon theo trạng thái rõ. | Không rate/save lại card đã commit; owner/course thay đổi chặn kết quả cũ; reduced motion không bắt chờ animation. |
| 05.3 | Lesson sáu exercise modes và Placement intro/question/result/insufficient theo board; duy trì answer → feedback → rating → save/retry. | Placement không tự đổi FSRS; mode không đủ dữ liệu báo lý do; keyboard/IME hoạt động. |
| 05.4 | Rebuild Quiz và Spelling bằng cấu trúc Canvas: segmented progress, card, reading/direction, choices/input, feedback, Lumi, continue/retry. | Answer/wrong/correct/empty/finished đều có ảnh; wrong-answer retry có hành vi thật; không chỉ bọc class CSS quanh JSX cũ. |
| 05.5 | Rebuild Story, Match, Shadowing và mode picker: reader/word actions/audio; grid/timer/pairs; listen/record/feedback; chọn mode thực. | Tooltip/từ trong story dẫn đến hành động thật; recording/permission/no-support/retry rõ; không bịa waveform hay điểm pronunciation. |
| 05.6 | Recap nối kết quả mọi chặng, từ cần ôn, thành tích, next action/match, tomorrow/reminder và weekly recap. | Số liệu từ session settlement; nút Continue mở đích rõ thay vì chỉ đóng modal; XP giữ R3 và policy đã chốt. |
| 05.7 | Hợp nhất exit/back/deep link, mobile gestures và pause khi edit/overlay; bảo toàn analytics exactly-once. | End-to-end đi đủ bốn chặng, retry network, resume và return-to-card không mất trạng thái. |

## Checklist

- [ ] 05.1 — Today có một start/continue chính và timeline thực: review đến hạn → new words → Word Match → recap. Lập session state gồm stage, card IDs, progress và kết quả đã commit.
- [ ] 05.2 — Implement Bridge đúng composition, carry session context, continue/skip; resume sau navigate/reload; exit lưu/abandon theo trạng thái rõ.
- [ ] 05.3 — Lesson sáu exercise modes và Placement intro/question/result/insufficient theo board; duy trì answer → feedback → rating → save/retry.
- [ ] 05.4 — Rebuild Quiz và Spelling bằng cấu trúc Canvas: segmented progress, card, reading/direction, choices/input, feedback, Lumi, continue/retry.
- [ ] 05.5 — Rebuild Story, Match, Shadowing và mode picker: reader/word actions/audio; grid/timer/pairs; listen/record/feedback; chọn mode thực.
- [ ] 05.6 — Recap nối kết quả mọi chặng, từ cần ôn, thành tích, next action/match, tomorrow/reminder và weekly recap.
- [ ] 05.7 — Hợp nhất exit/back/deep link, mobile gestures và pause khi edit/overlay; bảo toàn analytics exactly-once.
- [ ] Đối chiếu Canvas từng state của phase theo board/artboard inventory; reviewer kiểm tra cả hành vi và hình thức.
- [ ] Chạy focused checks rồi gates; ghi revision, kết quả và ngoại lệ trong log.

## Verification

dailySessionController/lessonReducer/practice session tests trước behavior đổi; e2e/phase5-learning.spec.ts, practice-visual.spec.ts, daily-learning-visual.spec.ts, daily-recap-visual.spec.ts; add unified-session.spec.ts; gates chung.

Hợp đồng chung: [acceptance-contract.md](acceptance-contract.md). Tên test mới là đề xuất; trước chạy phải kiểm inventory file thực, không báo file vắng là PASS. Với flow có mutation, test dùng emulator/fixtures, không dữ liệu người học hay Gemini thật.

## Rủi ro và rollback

Lý do log cũ “chưa có bridge state” là task cần implement, không phải lý do loại bridge. Combo XP/predicted band không mở khi thiếu quyết định/mô hình; giữ task phase 15.

Rollback theo commit scope hoặc flag additive đã review; không delete/reset dữ liệu hay dirty work. Bước phụ thuộc sau chỉ nhận contract đã kiểm chứng. Không deploy trong công việc lập kế hoạch này.
