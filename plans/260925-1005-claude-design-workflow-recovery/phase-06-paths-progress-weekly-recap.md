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

> **Staleness audit 2026-09-26** ([report](../reports/planner-260926-2229-old-plan-staleness-audit.md)).
> - 06.1 NEEDS REWRITE: Paths vẫn quảng cáo "Available offline" và "keep downloaded words available offline" (`CatalogScreen.tsx:65,262`; `CatalogWorkspace.tsx:74,160`). Cache catalog IndexedDB (`catalogCache.ts:395`) không nằm trong danh sách owner đã bỏ, nhưng học/rate thì cần mạng. Owner phải chốt giữ hay bỏ claim offline cho catalog.
> - 06.2 NEEDS REWRITE: bỏ banner "Available offline · showing saved progress" (`ProgressScreen.tsx:43`) và prop `isOffline` (`ProgressWorkspace.tsx:13,29`, `AppViewStage.tsx:72`). Khi offline, hiện dữ liệu cache của Firestore kèm nhãn "offline, có thể chưa mới".
> - 06.3 STILL VALID.
> - 06.4 NEEDS REWRITE: thêm ngân sách read. Weekly recap không được quét toàn bộ `reviewHistory` của mọi thẻ; lấy nguồn có giới hạn (xp history gamification hoặc một query theo khoảng ngày có index) và ghi số read mỗi lần mở.
> - 06.5 STILL VALID.

## Checklist

- [x] 06.1 (partial, 2026-09-27) — Đã bỏ đúng tuyên bố "available offline"/"keep downloaded words available offline" khỏi `CatalogScreen.tsx` (owner decision: Paths drops the offline claim); e2e regression guard thêm trong `paths-progress-visual.spec.ts`. Chưa làm lại toàn bộ đối chiếu Canvas composition (preview/provenance/download/activate/continue) trong phiên này — xem "Residual gaps" trong report.
- [x] 06.2 (2026-09-27) — Bỏ banner "Available offline" lớn trong `ProgressScreen.tsx`, thay bằng dòng chữ mờ "Offline — this may be out of date." (không banner, không màu cảnh báo). Giữ prop `isOffline` (chỉ đổi cách render) theo đúng chỉ đạo trực tiếp đã nhận, khác với gợi ý xoá hẳn prop trong audit note gốc — xem lý do trong report.
- [x] 06.3 (2026-09-27) — Ba trạng thái badge (earned/in-progress/locked) giờ tách bạch theo đúng phân lớp thị giác của `AchievementsScreen`/`AnimeAchievements` Canvas: earned = viền/icon màu brand + dòng "✓ unlocked"; in-progress = icon mờ + progress bar + phân số như cũ; locked = icon mờ hơn (opacity-70) + dòng "🔒 Not started yet", không progress bar. Trạng thái suy từ dữ liệu thật (`resolveAchievementBadgeState`: earned nếu `unlocked`, ngược lại in-progress khi `current>0`, locked khi `current===0`) — không phát minh điều kiện gate nào (không thêm badge Level/Shadowing mới, đúng ghi chú "điều kiện/XP bonus chưa chốt đi phase 15"). Thêm legend 3 mục (● earned / ○ in-progress / 🔒 locked) phía trên lưới, và nhóm badge theo tier (Bud/Bloom/Star, `achievementBadgeCopy.tierKey` mới) với số "earned/total" mỗi tier — đáp ứng "nhóm tier". "Detail": mỗi thẻ đã hiển thị đủ title/description/tier/progress-hoặc-trạng-thái cùng lúc (không cần ẩn sau click) nên không thêm expand/collapse để giữ bundle nhỏ — xem lý do trong report. Milestone trong Weekly recap đã có từ 06.4; milestone trong "Today" KHÔNG làm vì cần đưa `LibraryStatsViewModel`/badge summary vào `TodayScreen` model — nằm ngoài file sở hữu của việc này (`src/features/gamification/**` + UI thành tích), xem "Changes needed outside my files" trong report. File: `src/components/stats/AchievementsMatrix.tsx`, `src/components/stats/AchievementsMatrix.test.ts`. Test: `npx vitest run src/components/stats/AchievementsMatrix.test.ts src/features/weeklyRecap/WeeklyRecapDialog.test.tsx src/features/dailyLearning/ProgressWorkspace.test.tsx` (16 tests pass); `npx tsc --noEmit` sạch. Cảnh báo: snapshot e2e `e2e/paths-progress-visual.spec.ts-snapshots/progress-*.png` sẽ lệch vì layout đổi thật (tier heading, legend, locked/earned rows) — cần regenerate baseline sau khi reviewer so Canvas trực tiếp; không tự chạy Playwright trong phiên này (heavy-job rule).
- [x] 06.3 Today milestone follow-up (2026-09-27) — Đã điều tra riêng phần "milestone trong Today" còn bỏ ngỏ ở mục trên. Đọc toàn bộ 4 artboard Today trong Canvas (`AnimeToday.dc.html`, `MobileToday.dc.html`, `TodaySession.dc.html`, seed `TodayScreen.dc.html`: cả `renderVals()` lẫn ảnh reference dark PNG tương ứng) — không artboard nào có phần tử milestone/achievement-badge (không có "next badge", không có tier icon + progress gắn với hệ Bud/Bloom/Star). Những thứ gần giống trên Today — "Streak", "Level X · XP", "Daily Goals" (AnimeToday, XP quests như "Finish today's lesson"/"Hit a combo"), "Recall rate", "Path progress" — là số liệu độc lập, không phải milestone/achievement. Theo đúng điều kiện dừng đã nhận ("nếu Canvas Today không có milestone element thì dừng, không tự bịa UI"), KHÔNG thêm UI milestone vào `TodayScreen.tsx`/`DailyLearningWorkspace.tsx`. Không sửa file nào trong lượt này (không cần export gì thêm từ `AchievementsMatrix.tsx`). Việc 06.3 coi như đã đóng: milestone Weekly recap có ở 06.4, milestone Today không có trong Canvas nên không nợ gì thêm — nếu owner muốn thêm milestone cho Today sau này thì đó là một quyết định thiết kế mới (cần artboard mới), không phải phần còn thiếu của 06.3. Report: [fullstack-developer-260927-1108-today-milestone-investigation.md](reports/fullstack-developer-260927-1108-today-milestone-investigation.md).
- [x] 06.4 (2026-09-27) — Weekly recap mới tại `src/features/weeklyRecap/**`, đọc duy nhất từ `LibraryStatsViewModel.xpChartData` (gamification XP history đã tải sẵn), không quét `reviewHistory`, không thêm read Firestore nào khi mở recap (0 read/mở). Không suy learned/reviewed/recall/word-of-week từ XP; hiển thị honest unavailable khi thiếu dữ liệu; không dựng "best week" khi không có hoạt động.
- [x] 06.5 (2026-09-27) — Canvas 2D PNG export chỉ chạy khi user bấm Share/Download; chuỗi fallback Web Share → Clipboard → tải file; preview đúng lựa chọn đã tick; không tự đăng mạng xã hội; không có referral reward.
- [ ] Đối chiếu Canvas từng state của phase theo board/artboard inventory; reviewer kiểm tra cả hành vi và hình thức. — Đã so trực tiếp `PathsScreen-{dark,light}.png`, `AnimePaths-dark.png`, `ProgressScreen-dark.png`, `AnimeProgress-dark.png` với PNG Chromium bốn theme desktop/mobile. Paths desktop dùng hero rộng 48% và shelf ba cột; roadmap nằm ngang ở đáy hero, không còn co vào mép phải. Progress ready đưa chart Activity/Mastery lên ngay sau header; loading/empty/error giữ thứ tự cũ. Đã xem và cập nhật đúng bốn baseline `paths-reviewed-*-desktop` và tám baseline `progress-*` của `paths-progress-visual.spec.ts`; unit Paths/Progress 27/27 pass; Chromium `paths-progress-visual.spec.ts` 17/17 pass; build và bundle pass (initial JS 70.997 B, CSS 29.460 B gzip). Checklist vẫn mở: release/fixture hiện có ba track, không có unit words, ETA hoặc continue-unit action để dựng sáu shelf cards và CTA của Canvas; Progress thiếu range data contract, forecast và recently-mastered model nên không dựng các control/metric giả và không thêm Firestore read.
  > **Contract audit 2026-09-27.** `contract-paths-progress-canvas.md` định nghĩa nguồn unit trong catalog artifact (+0 I/O), review activity trong stats document hiện có (+0 I/O), và nêu rõ 13 count queries/ngày cho forecast cùng 0–4 document reads/hydration cho recent mastery cần owner duyệt. `learning_states` hiện có reader nhưng chưa thấy production writer; không dùng số liệu đó làm unit progress đáng tin cậy. Giữ checkbox mở.
  > **Paths layout 2026-09-27.** Bỏ ornament đè tiêu đề hero, roadmap ba nấc xếp dọc không va chữ, shelf heading trở lại text Lingui thật thay cho CSS `content` tiếng Anh; desktop dùng hero 56% và shelf hai cột với đúng ba track hiện có, mobile xếp header thành hai dòng. Đã mở đủ 8 ảnh actual Classic/Crystal × light/dark × desktop/390px và so `PathsScreen-dark.png`; cập nhật chỉ 8 baseline Chromium `paths-reviewed-*`, rerun không update 8/8 pass. Focused unit 24/24, build/bundle pass initial JS 70.994/71.000 B và CSS 29.486/29.500 B gzip. Không thêm production Firestore I/O. Còn GAP unit preview, route, ETA, CTA Continue và ba shelf cards khác do contract/nguồn dữ liệu đang chờ; checkbox vẫn mở.
- [x] Chạy focused checks rồi gates; ghi revision, kết quả và ngoại lệ trong log. (2026-09-27) — vitest focused, `tsc --noEmit`, `verify:bundle` đều pass; e2e xem Tests Status trong report.

## Verification

Stats/ActivityHeatmap/catalog tests; e2e/paths-progress-visual.spec.ts và catalog-workspace.spec.ts; new weekly-recap unit+export journey; gates chung.

Hợp đồng chung: [acceptance-contract.md](acceptance-contract.md). Tên test mới là đề xuất; trước chạy phải kiểm inventory file thực, không báo file vắng là PASS. Với flow có mutation, test dùng emulator/fixtures, không dữ liệu người học hay Gemini thật.

## Rủi ro và rollback

Images/share có thể chứa nội dung học cá nhân. Chỉ export khi user thao tác; tránh đưa private fixture/data thật vào repo.

Rollback theo commit scope hoặc flag additive đã review; không delete/reset dữ liệu hay dirty work. Bước phụ thuộc sau chỉ nhận contract đã kiểm chứng. Không deploy trong công việc lập kế hoạch này.
