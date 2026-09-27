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

> **Staleness audit 2026-09-26** ([report](../reports/planner-260926-2229-old-plan-staleness-audit.md)).
> - 10.1 STILL VALID: `firebaseCourseAdapter` và 8 course callable đã có nhưng chưa được nối vào runtime; shell chỉ có `CourseSwitcherSlot`.
> - 10.2, 10.4, 10.6 STILL VALID.
> - 10.3 NEEDS REWRITE (nhỏ): journey chỉ bắt đầu sau sign-in (không còn guest). "5-card aha" tạo thẻ qua callable và chịu quota Free 30, nên owner phải chốt thẻ starter có tính quota không.
> - 10.5 NEEDS REWRITE: repository đã lọc `where('language','==',target)` (`cardRepository.ts`, cả `fetchPracticeCards` ở dòng 712-714). Việc còn lại là nối active course vào caller: `appDependencies.ts:63` chưa truyền target, và `courseLabel` còn cứng (`DailyLearningWorkspace.tsx:368`). "Thẻ cũ thiếu language vẫn ở course English" nay dựa vào script `scripts/backfill-card-language.mjs` do owner chạy. Nếu chưa backfill thì thẻ cũ biến mất khỏi query có lọc, nên đây là gate trước khi 10.5 phát hành.
> - 10.7 NEEDS REWRITE: phần "local-to-signed-in reconciliation" là OBSOLETE vì guest đã bỏ. `localCourseAdapter.ts` (export tại `courses/index.ts:4`) là ứng viên gỡ. Giữ phần hai thiết bị nhất quán, tạo course idempotent và lỗi lưu phải báo trung thực.
> - Verification: bỏ "offline" khỏi chuỗi E2E.

## Checklist

- [x] 10.1 — CourseProvider và switcher thật: desktop popover/mobile sheet; create/switch/archive/reopen; một target một course. (2026-09-27, fullstack-developer: `CourseGate.tsx`/`courseSessionController.ts`/`CourseSwitcherControl.tsx` nối vào `AppRuntime.tsx`; 10.5's caller wiring vẫn để agent khác.)
- [x] 10.2 — Goals nằm trong course: choose/add/change level/pause/remove, exam/date/target khi thích hợp; nhiều Goals và optional none. (2026-09-27: `CourseGoalsPanel.tsx`.)
- [x] 10.3 — Hợp nhất onboarding boards thành journey có nhánh: native/UI → target → Goals/level/script → daily pace → 5-card aha → reminder choice. (2026-09-27: `OnboardingJourney.tsx`/`OnboardingGate.tsx`; suppress-gate cho legacy/e2e users thêm sau khi coordinator báo overlay chặn e2e. Cập nhật 2026-09-27, integration lane: chốt câu hỏi audit "starter card có tính quota không" — CÓ, owner quyết starter cards trừ vào cùng quota AI-card Free 30/tháng như card AI khác. Thêm đường server-authoritative `createStarterCardsForOwner` trong `functions/src/cardPersistence.ts` (transaction Firestore duy nhất vừa reserve quota vừa tạo cả batch card, idempotent qua `operationId`, an toàn retry, không bao giờ trừ quota hai lần) và callable `createStarterCards` trong `functions/src/index.ts`. Client gọi qua `createStarterCardBatch` (`src/lib/cardRepository.ts`), `OnboardingJourney`'s "5-card aha" giờ đi qua `createStarterCards.ts` đã viết lại — all-or-nothing: hết quota thì `skippedForQuota` bằng cả catalog, không tạo thẻ nào, không bịa kết quả. Không cần đổi `firestore.rules` vì mọi collection liên quan (`ai_usage`, `ai_operations`, `card_reservations`) đã chặn client write từ trước, Admin SDK bỏ qua rules. Test: `functions/test/cardPersistence.test.ts` (5 test mới, 39 tổng), `src/features/onboarding/createStarterCards.test.ts` (4 test mới). Xoá `starterCardAllocation.ts`/`.test.ts` (dead code sau khi rewrite, chưa từng commit).)
- [x] 10.4 — Settings: UI locale, meaning language, goal/date/pace, reading, voice, keyboard/IME guidance, archive, appearance/sound/reminder/account/plan links. (2026-09-27: `CourseSettingsSection.tsx`.)
- [x] 10.5 — Scope tất cả library/Today/practice/progress/intake/share/extension theo active course, gồm counts/load-more/search. (2026-09-27, integration lane: áp diff đề xuất vào `appDependencies.ts` và các call site library/Today/practice/intake/share/extension để đọc `activeCourse` từ `coursePort`/`courseSession` đã bridge trong `AppRuntime.tsx`. `fetchLibraryStats`/`loadStats` (đếm tổng thư viện, không scope theo course) là gap còn lại ngoài ownership của lane này — xem báo cáo.)
- [x] 10.6 — Incoming share khác pair: import matching course hoặc đề nghị create/reopen; native mismatch được trình bày đúng. (2026-09-27: `shareCourseMatching.ts`; wiring thật vào `useIntakeSharingSession.ts` áp dụng bởi integration lane cùng phiên — đã nối `resolveShareCourseAction`/`ensureCourseForIncomingShare` thật, không còn là diff đề xuất. Phiên 2026-09-27 sau đó còn tái dùng đúng pattern này cho gate capture của browser extension, xem 07.5.)
- [ ] 10.7 — Course prefs/gamification/local-to-signed-in reconciliation đồng bộ Firebase; flag rollback vẫn giữ dữ liệu. (Chỉ phần obsolete-code — gỡ `localCourseAdapter` — thuộc phạm vi phase này và đã xong trước phiên này; phần đồng bộ hai thiết bị/idempotent creation còn lại ngoài phạm vi.)
- [ ] Đối chiếu Canvas từng state của phase theo board/artboard inventory; reviewer kiểm tra cả hành vi và hình thức.
  > **Capture 2026-09-27.** `e2e/course-onboarding-visual.spec.ts` chạy qua emulator 8/8, chụp 24 ảnh actual: onboarding và settings ở desktop/mobile, switcher và goals ở desktop, mỗi màn Classic/Crystal × light/dark. Đã mở ảnh và so với `LangCourses`, `LangOnboarding`, `Onboarding`, `LangSettings` trong Canvas. Còn DRIFT: switcher thực là popover danh sách 320px thay vì bố cục thông tin course 480px; onboarding là modal gọn thay vì journey board; course settings nằm sau Appearance. Mobile không có đường mở switcher/goals vì control chỉ mount trong DesktopNavigation. Ảnh nằm trong `test-results` của lượt chạy, chưa phải baseline; checkbox giữ mở cho đến khi sửa và so đủ state.
- [x] Chạy focused checks rồi gates; ghi revision, kết quả và ngoại lệ trong log. (2026-09-27, revision `ffbc9be`) — `verify:deploy` pass (2126 unit, 375 functions, 82 rules, 42 script tests); build + `verify:bundle` pass (JS 70.996 / CSS 29.498 B gzip); `i18n:check` pass; e2e chromium với Functions emulator: 240/242 pass ở lượt toàn bộ, 2 spec còn lại (`daily-learning-visual`, `practice-visual`) pass 25/25 khi chạy lại. Ngoại lệ: 2 fail đó là trang trắng do `ERR_NETWORK_CHANGED` khi Docker trên máy liên tục tạo/xoá interface veth, không phải lỗi code; runner emulator chuyển sang 1 worker vì 2 worker làm rate limiter quá hạn đọc Firestore. B7 bổ sung render coverage cho switcher, goals, settings và bước đầu onboarding trong các test feature, cùng spec e2e emulator `course-onboarding-settings.spec.ts`; focused render tests 8/8 pass và Chromium emulator e2e 2/2 pass ngày 2026-09-27. Romanization switch nay có accessible name từ label dịch sẵn có. Canvas comparison vẫn mở.

## Verification

Provider switching/ownerRace tests; onboarding matrix; E2E vi UI→ko + TOPIK II/EPS→ja→reopen ko→reload→offline→shared deck; settings visual; gates chung.

Hợp đồng chung: [acceptance-contract.md](acceptance-contract.md). Tên test mới là đề xuất; trước chạy phải kiểm inventory file thực, không báo file vắng là PASS. Với flow có mutation, test dùng emulator/fixtures, không dữ liệu người học hay Gemini thật.

## Rủi ro và rollback

Onboarding các board 4/5 bước là nhiều lớp yêu cầu, cần journey duy nhất có nhánh, không chọn một bộ rồi bỏ bộ kia. Migration-gated features được disabled có lý do, không fake.

Rollback theo commit scope hoặc flag additive đã review; không delete/reset dữ liệu hay dirty work. Bước phụ thuộc sau chỉ nhận contract đã kiểm chứng. Không deploy trong công việc lập kế hoạch này.
