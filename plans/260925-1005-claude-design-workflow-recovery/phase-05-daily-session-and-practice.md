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

> **Staleness audit 2026-09-26.** `src/components/study/**` hiện chỉ còn `ReviewControls.tsx`, được `StudyView.tsx` dùng; nhận prop `saving` từ `StudyView.tsx:366`. Task 05.1(c) chạm `src/features/learning/**`, `src/app/**` và `src/features/cardEdit/editCardModel.ts`, nên controller phải làm tuần tự các file này.

File `proposed` là file/module cần tạo, không phải tuyên bố đã tồn tại. File chung do controller chỉnh tuần tự theo [ownership](acceptance-contract.md).

## Công việc cụ thể (viết lại theo kiến trúc 2026-09-26)

> **Staleness audit 2026-09-26.** Bảng task gốc (viết 25/09) giả định có offline queue/`durably-queued`, resume từ bản sao IndexedDB và pending-sync count. Owner đã bỏ toàn bộ offline learning và guest mode ngày 26/09 ([firebase-cost-rebuild](../260926-0917-firebase-cost-rebuild/plan.md)); review giờ chỉ đi qua callable `reviewCardV2` (`src/lib/cardReviewRepository.ts:111-118`). Bảng dưới thay bảng gốc; bản gốc giữ trong mục *Superseded* ở cuối section. Chi tiết audit: [planner-260926-2229-old-plan-staleness-audit](../reports/planner-260926-2229-old-plan-staleness-audit.md).

### Hiện trạng code (đã kiểm 26/09, HEAD `e25165e`)

- Today dựng plan bằng `buildDailyPlan` (bucket due/weak/new, tối đa 15; `src/features/dailyLearning/dailyPlan.ts:90-117`) và chỉ **hiển thị** ba chặng (`TodayScreen.tsx:54-57,101-109`). Không có session nhiều chặng, Bridge hay Word Match trong phiên: mỗi lesson là một mode rời (`DAILY_LESSON_MODES`, `dailyLearningUrl.ts:1-9`) mở từ nút mode.
- Lesson kết thúc chỉ bằng câu "Your daily lesson is complete." (`DailyLearningWorkspace.tsx:344`); `SessionRecapModal` chỉ được mount trong `StudyView.tsx:388`.
- Nhánh sync-pending là code chết: `useLearningStatePersistence.ts:188-198` chỉ trả `committed`/`conflict`, nhưng `lessonReducer.ts:4,19,27,75-87`, `dailySessionController.ts:12,70-79`, `usePracticeSession.ts:135,232-235,300` và `StudyView.tsx:29,221-225,371-373` vẫn xử lý `durably-queued`.
- Today/Progress vẫn báo "Available offline" (`TodayScreen.tsx:340,370`; `ProgressScreen.tsx:43`), dù rate cần mạng.
- Pool của Today không lọc theo course: `appDependencies.ts:63` không truyền `targetLanguage`, dù `fetchPracticeCards` đã hỗ trợ (`cardRepository.ts:712-714`). `courseLabel` đang cứng EN→VI (`DailyLearningWorkspace.tsx:368`).
- Harness e2e chỉ chạy emulator `firestore,auth` (`package.json:36`); `src/lib/firebase.ts` không có `connectFunctionsEmulator`. Vì vậy mọi e2e có bước rate (ví dụ `e2e/phase5-learning.spec.ts:79-80`) không commit review được.

### Bảng task

| Task | Thực hiện | File sở hữu | Phụ thuộc | Điều kiện đạt |
|---|---|---|---|---|
| 05.0 | Cho harness e2e gọi được callable review/create/bulk: thêm Functions emulator vào `test:e2e:emulator` và nối `connectFunctionsEmulator` khi `VITE_SONFLASH_E2E_EMULATOR=true`. **Cần owner chọn phương án** (xem mục Concerns của report; cùng câu hỏi a/b/c với `card-delete-undo`). | Controller: `package.json`, `firebase.json`, `src/lib/firebase.ts`, `e2e/fixtures/firebase-emulator.ts` | Quyết định owner | Một e2e rate thẻ và thấy "Question 2 of N" trên build emulator. Không gọi Gemini/network thật. Có thể viết unit test cho 05.2–05.8 trước khi 05.0 xong; e2e acceptance thì phải chờ 05.0. |
| 05.1 | Gỡ nhánh sync-pending chết và nhãn offline sai. (a) Learning lane: bỏ `sync-pending`, `provisionally-persisted` và `syncPendingReviewCount` khỏi `lessonReducer`/`dailySessionController`/`dailyLearningPresentation`/`LessonScreen`; bỏ `syncPendingReviewCardId` và `reviewStatus 'sync-pending'` khỏi `usePracticeSession`/`StudyView`/`PracticeScreen`. (b) Offline: Today và Progress hiện thông báo trung thực "đang offline, kết nối lại để lưu". Start/rate bị chặn khi offline, và bỏ nhánh bỏ audio listening khi offline (`DailyLearningWorkspace.tsx:250`). (c) Controller làm tuần tự sau (a): thu hẹp union `durably-queued` trong `learningStateController.ts:80-113,297-310` cùng các consumer `editCardModel.ts:59-63`, `useLearningWorkspace.ts:237`, `use-library-mutation-feedback.ts:26,35`. | (a)(b) `src/features/dailyLearning/**`, `src/features/practice/**`; (c) controller: `src/features/learning/**`, `src/app/**`, `src/features/cardEdit/editCardModel.ts` | không | `tsc` sạch sau khi union bị thu hẹp, tức là không còn consumer nào xử lý `durably-queued`. Test tái hiện: rate thất bại do mạng thì vào `save-error` với Retry giữ cùng `operationId` (`dailySessionController.ts:139`), không bao giờ hiện "saved on this device". Viết lại e2e `pilot-mobile-review.spec.ts:71-86`: chờ trạng thái committed thay vì `[data-study-provisional]`. i18n extract bỏ `daily.lesson.sync-pending-count`, `study.sync-pending`, `today.offline`, `progress.offline`. |
| 05.2 | Session nhiều chặng: review (due+weak) → từ mới → Word Match → recap. Mô hình gồm stage, card IDs từng stage, `operationId` đã commit và kết quả từng stage. Nguồn là `buildDailyPlan` hiện có. Word Match dùng `createWordMatchRound` (`practiceModel.ts:11`) trên cùng pool; không đủ 4 thẻ thì skip kèm lý do. **Resume**: chỉ lưu con trỏ phiên (stage, IDs, opIds) trong `sessionStorage`, key theo owner, theo mẫu `useIntakeSharingSession.ts:113-119`. Khi reload thì query lại plan; thẻ đã commit tự rơi khỏi due vì server đã đẩy `nextReviewDate`. Không lưu nội dung thẻ, không có hàng đợi ghi và không thêm write Firestore. Thêm seam `targetLanguage` (mặc định giữ hành vi hiện tại), phase 10 sẽ nối vào. | `src/features/dailyLearning/{dailyPlan,dailySessionController,lessonReducer,DailyLearningWorkspace,dailyLearningUrl}.ts(x)` + proposed `dailySessionStages.ts` | 05.1 | Zero due/new/match có skip và giải thích, không tạo sample card. Reload giữa stage thì quay lại đúng stage và không rate lại thẻ đã commit. Đổi owner xóa con trỏ và bỏ kết quả async cũ. Số read khi bắt đầu phiên không vượt query practice đã gộp của cost-rebuild phase 3; test đếm query. |
| 05.3 | Bridge giữa các stage theo SessionBridge/AnimeBridge: tóm tắt stage vừa xong, continue/skip, exit/abandon. Mỗi review đã commit ngay khi rate, nên thoát phiên chỉ bỏ con trỏ. | `src/features/dailyLearning/**` (proposed `SessionBridge.tsx`) | 05.2 | Reduced motion không bắt chờ animation. Exit không mất review đã commit và không rate lại. Đổi owner/course thì chặn bridge cũ. |
| 05.4 | Lesson sáu mode và Placement intro/question/result/insufficient theo board; giữ answer → feedback → rating → save/retry. | `LessonScreen.tsx`, `PlacementScreen.tsx`, `exerciseEngine.ts`, `placementEngine.ts`, `scriptScoring.ts`, `daily-learning-canvas.css` | 05.1 (song song với 05.2 nếu tách file) | Như 05.3 gốc: Placement không đổi FSRS, mode thiếu dữ liệu nêu lý do, keyboard/IME chạy. Lỗi lưu hiện trạng thái retry trung thực. |
| 05.5 | Rebuild Quiz và Spelling theo Canvas: segmented progress, card, reading/direction, choices/input, feedback, Lumi, continue/retry. | `QuizView.tsx`, `SpellingView.tsx`, `usePracticeGames.ts`, `practice-board.css` | 05.1 | Như 05.4 gốc: answer/wrong/correct/empty/finished đều có ảnh; retry câu sai hoạt động thật. |
| 05.6 | Rebuild Story, Match, Shadowing và mode picker: word actions và audio trong reader; grid, timer và pairs; listen/record/feedback; chọn mode thật. | `StoryView.tsx`, `WordMatchView.tsx`, `ShadowingView.tsx`, `practiceModeRegistry.ts`, `TodayScreen.tsx` (PracticeModes) | 05.1; Word Match trong phiên cần 05.2 | Như 05.5 gốc: không bịa waveform/điểm phát âm; xử lý permission, no-support và retry rõ ràng. |
| 05.7 | Recap cuối phiên (RecapScreen/RecapNext/AnimeRecap), dùng chung cho lesson và study. Số liệu lấy từ các `operationId` đã commit trong session. XP lấy từ gamification thật (+2 mỗi review commit, `useLearningStatePersistence.ts:175`), không chép số mẫu. Có từ cần ôn, next action, số thẻ đến hạn ngày mai qua aggregate `countCards` (`cardRepository.ts:370`), và entry sang weekly recap khi phase 06 có đích. | `SessionRecapModal.tsx` hoặc proposed `dailyLearning/SessionRecap.tsx`; không chia hai agent cùng sửa | 05.2 | Continue mở đích rõ ràng. XP giữ R3; không có combo/bonus (phase 15). Thẻ lưu thất bại không được tính là "remembered". Reminder chỉ là link tới setting của phase 11 và không hứa đã gửi. |
| 05.8 | Hợp nhất exit/back/deep link (`?lesson=` và stage), mobile gesture, pause khi edit/overlay (`usePracticeSession.ts:140,220`), analytics exactly-once. | `useAppNavigation.ts` (controller), `dailyLearningUrl.ts`, `practiceSessionLifecycle.ts` | 05.2, 05.3 | E2E đi đủ bốn chặng. Mất mạng giữa chừng thì retry cùng `operationId`. Back/deep link không nhân đôi review. Return-to-card sau edit giữ index và timer. |
| 05.9 | Nghiệm thu Canvas từng state và từng board, bốn theme × 1440/390, a11y; thêm `e2e/unified-session.spec.ts`. | `e2e/**` (controller sequencing) | 05.0–05.8 | Đạt theo [acceptance-contract.md](acceptance-contract.md). Ảnh app so trực tiếp Canvas; snapshot tự cập nhật không được tính là bằng chứng. |

### Checklist (mới)

- [x] 05.0 — Harness e2e gọi được callable. Đã xong từ trước: `test:e2e:emulator` chạy Functions emulator (`scripts/run-e2e-functions-emulator.mjs`, `firebase.json`); e2e run 260927 thấy log `functions: Beginning/Finished execution of "asia-southeast1-reviewCardV2"` cho mọi bước rate trong `phase5-learning.spec.ts`/`unified-session.spec.ts`.
- [x] 05.1 — Gỡ sync-pending/`durably-queued` chết và nhãn "Available offline" trong learning/practice; controller thu hẹp union. Xác nhận lại 260927: `grep -rn "durably-queued|sync-pending|provisionally-persisted|syncPendingReview" src/features/dailyLearning src/features/practice src/features/learning` không còn khớp nào.
- [x] 05.2 — Session nhiều chặng với con trỏ `sessionStorage`, không thêm read/write Firestore. Đã triển khai: `dailySessionStages.ts` (`buildSessionStagePlan`, `firstOutstandingStage`/`nextOutstandingStage`, `readDailySessionPointer`/`writeDailySessionPointer` chỉ dùng `sessionStorage`), `DailyLearningWorkspace.tsx` (`beginMultiStageSession`, `advanceMultiStage`, `continueToNextStage`, `skipUpcomingStage`, resume effect dòng 454-480). Zero-bucket tự skip (match có `skipReason`; review/new rỗng tự nhảy qua `nextOutstandingStage`). Owner/course đổi thì `clearDailySessionPointer` (effect dòng 286-301). Verify: `e2e/unified-session.spec.ts` 8/8 pass (chạy lại 260927, xem report `fullstack-developer-260927-0915-daily-session-phase.md`).
- [x] 05.3 — Bridge behavior/data đúng board (real stats/labels/skip reason/exit qua `SessionBridgeModel`; i18n `session.bridge.*`/`session.stage.*` đã có trong `today.po` en+vi với bản dịch thật, không còn hiện id thô). **Còn mở về bố cục**: `SessionBridge.tsx` vẫn là một card căn giữa, chưa phải layout full-bleed cinematic của Canvas (progress bar 4-chặng ở top, panel streak, teaser next-stage, ảnh thẻ lật) — xem mục kiến trúc trong report 260927-0915. Tick behavior/data, không tick fidelity bố cục.
  - 2026-09-27: bố cục full-bleed theo `SessionBridge-*`/`AnimeBridge-*` đã làm. Rail bốn chặng, số chặng đã xong, thẻ preview lấy từ stage plan thật, chặng kế tiếp và Continue/Skip/Exit; `shell.css` ẩn topbar/mobile nav chỉ khi bridge đang mở. Không làm combo, nguồn thẻ hay XP bonus của Canvas vì chưa có dữ liệu thật. Kiểm: `session-bridge.test.tsx` cùng transitions/stages 21/21; tsc sạch; `i18n:check` pass; bundle JS 70.999 / CSS 29.476 gzip; `e2e/unified-session.spec.ts` chromium 8/8 (nav ẩn, rail, sát mép viewport, reduced motion, axe). Còn một flake: ảnh Match xáo ngẫu nhiên bằng `Math.random`, fail 1/8 một lần, chạy lại 3/3 pass. Chưa kiểm Firefox/WebKit. Firestore không thêm read/write.
- [x] 05.4 — Lesson sáu mode + Placement. `DailyLearningWorkspace.tsx:183-190` map đủ 6 mode; `LessonScreen.tsx`'s `AnswerControl` xử lý choice/text/sentence; `dailySessionController.ts:116-136` rate→persist idempotent theo `operationId`, retry giữ cùng id; `PlacementScreen` model intro/question/result/insufficient (dòng 541-586).
- [x] 05.5 — Quiz + Spelling theo Canvas: segmented progress (linear bar có `role="progressbar"`), card, feedback correct/incorrect thật, retry/restart thật, Lumi (mới thêm 260927, xem Files Modified) khi theme crystal. Không bịa waveform/score.
- [x] 05.6 — Story, Match, Shadowing, mode picker. `StoryView.tsx` không giả story/permission; `ShadowingView.tsx` dùng Web Speech API thật (permission/no-support/error rõ, không bịa điểm phát âm — điểm từ `scoreSpeechMatch` thật); `WordMatchView.tsx` grid+timer+pairs thật; `practiceModeRegistry.ts`/`TodayScreen.tsx` `PracticeModes` chọn mode thật.
- [x] 05.7 — Recap từ settlement thật. `SessionRecapModal.tsx` nhận `totalCards`/`goodCount`/`againCount`/`xpEarned`/`weakCards` từ `DailySessionStats` tích lũy theo rating thật + `matchXp` thật từ Word Match; retry-weak thật. Theo quyết định owner 2026-09-27, recap dùng đúng một aggregate count query khi mở để đếm `nextReviewDate` trong ngày mai theo giờ địa phương, lọc ngôn ngữ course, không subscribe hoặc đọc card documents; 0, loading và lỗi đều có trạng thái riêng, lỗi không chặn recap. `card-repository-tomorrow-count.test.ts` 2/2, `session-recap-service.test.ts` 2/2, `SessionRecapModal.test.tsx` 5/5, `e2e/unified-session.spec.ts` Chromium 8/8 (4 theme × desktop/mobile) đạt; đã xem 8 ảnh mới so với Canvas và chỉ cập nhật 8 baseline recap. Chi phí tăng: một count query mỗi lần mở, 0 write. "Continue learning" đưa về Today (nơi tự tính lại due) đóng vai next-action không tốn thêm read. Entry từ recap sang weekly recap chưa được nối; weekly recap hiện mở được qua Progress (phase 06).
- [x] 05.8 — Exit/back/deep link/gesture/pause/analytics. `dailyLearningUrl.ts` hỗ trợ `?lesson=session`, stage nằm trong `sessionStorage` (không phải URL); popstate handler trong `DailyLearningWorkspace.tsx:270-285` đóng session + xoá con trỏ khi back tới Today. Resume qua reload dùng `readDailySessionPointer` + `outstandingItems` (loại thẻ đã commit). `dailySessionController.ts` idempotent retry theo `operationId`. Mobile gesture/pause khi edit overlay đã có từ trước ở `usePracticeSession.ts:313,324`/`StudyView.tsx` (swipe good/again, `isPaused` khi đang sửa thẻ) cho luồng practice độc lập; Lesson trong session dùng rating theo nút (đúng board Canvas, không phải deck vuốt).
- [x] 05.9 — Đối chiếu Canvas từng state; reviewer kiểm tra hành vi lẫn hình thức; chạy focused checks rồi gates; ghi log.
  - 2026-09-27 (báo cáo trước): `e2e/unified-session.spec.ts` thêm (8 test, 4 theme × 2 viewport, capture đủ bridge/review-front/review-back/new-word/match/recap). Tìm và sửa một bug thật (recap modal lệch tâm trên mobile do transform GSAP đè transform căn giữa) trong `SessionRecapModal.tsx`/`practice-board.css`, 8/8 pass sau khi sửa.
  - 2026-09-27 (báo cáo này, `fullstack-developer-260927-0915-daily-session-phase.md`): xác nhận catalog `session.bridge.*`/`session.stage.*` đã được một lane khác bổ sung đúng en+vi (không còn hiện id thô — mối lo #1 của báo cáo trước đã hết); chạy lại `unified-session.spec.ts` + `phase5-learning.spec.ts` + `daily-learning-visual.spec.ts` + `practice-visual.spec.ts` = 38/38 pass, không cần update baseline nào. Sửa nốt một lỗi ngữ pháp tiếng Anh còn sót ("Choose a English word") trong `WordMatchView.tsx` (nguồn + cần catalog `.po` cập nhật thủ công, xem báo cáo). Thêm Lumi (crystal theme) vào màn kết quả Quiz/Spelling cho đúng board Canvas. **Còn mở, chưa coi là đóng hẳn 05.3**: Bridge/Lesson chrome khác Canvas ở mức kiến trúc (thiếu full-bleed/immersive layout, ẩn nav app-shell) — cần đổi ở `src/App.tsx`/`src/app/AppViewStage.tsx` (ngoài quyền sở hữu file của lane này) cộng CSS mới trong khi ngân sách CSS đã hết dư; khuyến nghị một phase riêng có controller tham gia.

<details>
<summary>Superseded 2026-09-26 — bảng task và checklist gốc ngày 25/09 (giữ nguyên để truy vết)</summary>

### Công việc cụ thể (gốc)

| Task | Thực hiện | Điều kiện đạt |
|---|---|---|
| 05.1 | Today có một start/continue chính và timeline thực: review đến hạn → new words → Word Match → recap. Lập session state gồm stage, card IDs, progress và kết quả đã commit. | Không chuyển bằng các CTA rời rạc; zero due/new/match pool được skip có giải thích, không tạo sample card. |
| 05.2 | Implement Bridge đúng composition, carry session context, continue/skip; resume sau navigate/reload; exit lưu/abandon theo trạng thái rõ. | Không rate/save lại card đã commit; owner/course thay đổi chặn kết quả cũ; reduced motion không bắt chờ animation. |
| 05.3 | Lesson sáu exercise modes và Placement intro/question/result/insufficient theo board; duy trì answer → feedback → rating → save/retry. | Placement không tự đổi FSRS; mode không đủ dữ liệu báo lý do; keyboard/IME hoạt động. |
| 05.4 | Rebuild Quiz và Spelling bằng cấu trúc Canvas: segmented progress, card, reading/direction, choices/input, feedback, Lumi, continue/retry. | Answer/wrong/correct/empty/finished đều có ảnh; wrong-answer retry có hành vi thật; không chỉ bọc class CSS quanh JSX cũ. |
| 05.5 | Rebuild Story, Match, Shadowing và mode picker: reader/word actions/audio; grid/timer/pairs; listen/record/feedback; chọn mode thực. | Tooltip/từ trong story dẫn đến hành động thật; recording/permission/no-support/retry rõ; không bịa waveform hay điểm pronunciation. |
| 05.6 | Recap nối kết quả mọi chặng, từ cần ôn, thành tích, next action/match, tomorrow/reminder và weekly recap. | Số liệu từ session settlement; nút Continue mở đích rõ thay vì chỉ đóng modal; XP giữ R3 và policy đã chốt. |
| 05.7 | Hợp nhất exit/back/deep link, mobile gestures và pause khi edit/overlay; bảo toàn analytics exactly-once. | End-to-end đi đủ bốn chặng, retry network, resume và return-to-card không mất trạng thái. |

### Checklist (gốc)

- [ ] 05.1 — Today có một start/continue chính và timeline thực: review đến hạn → new words → Word Match → recap. Lập session state gồm stage, card IDs, progress và kết quả đã commit.
- [ ] 05.2 — Implement Bridge đúng composition, carry session context, continue/skip; resume sau navigate/reload; exit lưu/abandon theo trạng thái rõ.
- [ ] 05.3 — Lesson sáu exercise modes và Placement intro/question/result/insufficient theo board; duy trì answer → feedback → rating → save/retry.
- [ ] 05.4 — Rebuild Quiz và Spelling bằng cấu trúc Canvas: segmented progress, card, reading/direction, choices/input, feedback, Lumi, continue/retry.
- [ ] 05.5 — Rebuild Story, Match, Shadowing và mode picker: reader/word actions/audio; grid/timer/pairs; listen/record/feedback; chọn mode thực.
- [ ] 05.6 — Recap nối kết quả mọi chặng, từ cần ôn, thành tích, next action/match, tomorrow/reminder và weekly recap.
- [ ] 05.7 — Hợp nhất exit/back/deep link, mobile gestures và pause khi edit/overlay; bảo toàn analytics exactly-once.
- [ ] Đối chiếu Canvas từng state của phase theo board/artboard inventory; reviewer kiểm tra cả hành vi và hình thức.
- [ ] Chạy focused checks rồi gates; ghi revision, kết quả và ngoại lệ trong log.


</details>

## Verification

dailySessionController/lessonReducer/practice session tests trước behavior đổi; e2e/phase5-learning.spec.ts, practice-visual.spec.ts, daily-learning-visual.spec.ts, daily-recap-visual.spec.ts; add unified-session.spec.ts; gates chung.

> **Staleness audit 2026-09-26.** Có ba điểm cần biết. (1) Bước rate trong `phase5-learning.spec.ts:79-80` và cả `pilot-mobile-review.spec.ts` (chỉ chạy ở project mobile, `playwright.config.ts:29-51`) không thể đạt cho tới khi có 05.0. Hai test phase5 còn fail vì drift nhãn "Context story"/"Learning progress", xem `../reports/debugger-260926-2046-e2e-signin-triage.md`. (2) Snapshot `daily-recap-visual`/`practice-visual` đã fail từ trước (`../reports/debugger-260926-2120-e2e-regressions.md`); không được update baseline để che. (3) Thêm gate `npm run test:rules` khi 05 chạm Rules, và test Functions khi chạm callable.

Hợp đồng chung: [acceptance-contract.md](acceptance-contract.md). Tên test mới là đề xuất; trước chạy phải kiểm inventory file thực, không báo file vắng là PASS. Với flow có mutation, test dùng emulator/fixtures, không dữ liệu người học hay Gemini thật.

## Rủi ro và rollback

Lý do log cũ “chưa có bridge state” là task cần implement, không phải lý do loại bridge. Combo XP/predicted band không mở khi thiếu quyết định/mô hình; giữ task phase 15.

Rollback theo commit scope hoặc flag additive đã review; không delete/reset dữ liệu hay dirty work. Bước phụ thuộc sau chỉ nhận contract đã kiểm chứng. Không deploy trong công việc lập kế hoạch này.
