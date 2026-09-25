---
title: "Courses, Goals, onboarding và settings đầy đủ"
status: todo
---

# 10. Courses, Goals, onboarding và settings đầy đủ

## Kết quả và phụ thuộc

07A,08,09; gate R10 và nguồn FE12. Không phụ thuộc07B (07B cần kết quả phase10). Wave1 chạy Firebase, không bắt chờ migration; timingG1 vẫn là điểm còn mở.

Ước lượng: 7–10 ngày. Đây là công sức kỹ thuật dự kiến, không phải hạn giao; bao gồm sửa và verify phần phase. Trạng thái hiện tại lấy từ audit, chưa task nào được đánh dấu đạt chỉ vì có patch.

## Nguồn và file sở hữu

Nguồn: Frontend12 + roadmap03b; LangCourses/LangMobile/LangOnboarding/LangSettings; AnimeLangCourses/Onboarding; Onboarding/MobileOnboard/AnimeOnboarding; ReminderSettings.

Đường dẫn dưới đây tương đối với `/mnt/Projects/startup/flash-card` cho đến khi phase migration đổi root theo source plan.

proposed src/features/{courses,onboarding}/**; src/features/settings/**; src/components/shell/CourseSwitcherSlot.tsx; languageProfile consumers; app coordination; library/practice/daily/progress intake context.

File `proposed` là file/module cần tạo, không phải tuyên bố đã tồn tại. File chung do controller chỉnh tuần tự theo [ownership](acceptance-contract.md).

## Công việc cụ thể

| Task | Thực hiện | Điều kiện đạt |
|---|---|---|
| 10.1 | CourseProvider và switcher thật: desktop popover/mobile sheet; create/switch/archive/reopen; một target một course. | Nút không còn span+chevron; thêm Hàn, Nhật, thêm Hàn lại mở existing; reload giữ active course. |
| 10.2 | Goals nằm trong course: choose/add/change level/pause/remove, exam/date/target khi thích hợp; nhiều Goals và optional none. | IELTS/TOEIC/study abroad/conversation/business; TOPIK/EPS; JLPT; HSK theo catalog; không gọi mỗi Goal là course. |
| 10.3 | Hợp nhất onboarding boards thành journey có nhánh: native/UI → target → Goals/level/script → daily pace → 5-card aha → reminder choice. | Back/skip/resume/new/legacy users đều rõ; legacy không bị ép tạo lại card; starter cards có nguồn/data thật, không bịa kết quả 4/5. |
| 10.4 | Settings: UI locale, meaning language, goal/date/pace, reading, voice, keyboard/IME guidance, archive, appearance/sound/reminder/account/plan links. | Đổi meaning chỉ tác động card mới và nói rõ; UI locale không tự đổi course; unavailable voices có fallback. |
| 10.5 | Scope tất cả library/Today/practice/progress/intake/share/extension theo active course, gồm counts/load-more/search. | Không leak giữa course/account; stale async result bị bỏ; missing-language old card vẫn nằm course English. |
| 10.6 | Incoming share khác pair: import matching course hoặc đề nghị create/reopen; native mismatch được trình bày đúng. | Không silently đổ Korean deck vào English; cancel không tạo side effect nửa chừng. |
| 10.7 | Course prefs/gamification/local-to-signed-in reconciliation đồng bộ Firebase; flag rollback vẫn giữ dữ liệu. | Hai thiết bị thấy đúng course/prefs; duplicate creation idempotent; storage failures không giả thành công. |

## Checklist

- [ ] 10.1 — CourseProvider và switcher thật: desktop popover/mobile sheet; create/switch/archive/reopen; một target một course.
- [ ] 10.2 — Goals nằm trong course: choose/add/change level/pause/remove, exam/date/target khi thích hợp; nhiều Goals và optional none.
- [ ] 10.3 — Hợp nhất onboarding boards thành journey có nhánh: native/UI → target → Goals/level/script → daily pace → 5-card aha → reminder choice.
- [ ] 10.4 — Settings: UI locale, meaning language, goal/date/pace, reading, voice, keyboard/IME guidance, archive, appearance/sound/reminder/account/plan links.
- [ ] 10.5 — Scope tất cả library/Today/practice/progress/intake/share/extension theo active course, gồm counts/load-more/search.
- [ ] 10.6 — Incoming share khác pair: import matching course hoặc đề nghị create/reopen; native mismatch được trình bày đúng.
- [ ] 10.7 — Course prefs/gamification/local-to-signed-in reconciliation đồng bộ Firebase; flag rollback vẫn giữ dữ liệu.
- [ ] Đối chiếu Canvas từng state của phase theo board/artboard inventory; reviewer kiểm tra cả hành vi và hình thức.
- [ ] Chạy focused checks rồi gates; ghi revision, kết quả và ngoại lệ trong log.

## Verification

Provider switching/ownerRace tests; onboarding matrix; E2E vi UI→ko + TOPIK II/EPS→ja→reopen ko→reload→offline→shared deck; settings visual; gates chung.

Hợp đồng chung: [acceptance-contract.md](acceptance-contract.md). Tên test mới là đề xuất; trước chạy phải kiểm inventory file thực, không báo file vắng là PASS. Với flow có mutation, test dùng emulator/fixtures, không dữ liệu người học hay Gemini thật.

## Rủi ro và rollback

Onboarding các board 4/5 bước là nhiều lớp yêu cầu, cần journey duy nhất có nhánh, không chọn một bộ rồi bỏ bộ kia. Migration-gated features được disabled có lý do, không fake.

Rollback theo commit scope hoặc flag additive đã review; không delete/reset dữ liệu hay dirty work. Bước phụ thuộc sau chỉ nhận contract đã kiểm chứng. Không deploy trong công việc lập kế hoạch này.
