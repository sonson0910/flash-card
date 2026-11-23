# Audit: Claude Design và workflow SonFlash chưa được tích hợp đầy đủ

Ngày: 25/09/2026, Asia/Ho_Chi_Minh. Branch: `feat/ui-redesign`. Phạm vi: source Canvas, trao đổi Claude gốc, plans/decisions, code trong current worktree và kiểm tra browser cục bộ. Đây là audit + kế hoạch; không deploy.

## Kết luận

Nhận xét của user có cơ sở. Nền theme, i18n, Appearance và một số component đã được làm; Library trong patch mới đã tiến gần thiết kế. Nhưng việc triển khai trước đó thường giữ bố cục/hành vi cũ rồi thêm style, và đã loại những workflow chưa có trong code khỏi phạm vi. Điều đó không đáp ứng yêu cầu tích hợp Claude Design đầy đủ.

User đã làm rõ lần cuối: mọi màn gen có chủ đích đưa vào sản phẩm, chỉ demo để chọn hướng mới không cần thành màn thật. [Kế hoạch khắc phục](../260925-1005-claude-design-workflow-recovery/plan.md) giữ tất cả board sản phẩm, gồm cả commerce/growth và các phần chờ backend; gate quyết định không đồng nghĩa loại bỏ task.

## Nguồn đã đối chiếu

| Nguồn | Cách dùng |
|---|---|
| Phiên Claude `5e520499-5fed-45db-bd78-9a938ff7db56` của project flash-card | Đọc user decisions và phần tư vấn/thiết kế liên quan, đặc biệt dòng 2761–2772 về learning loop, reminders, web words, onboarding, recap, sheet và AI tiến trình. Mốc đầy đủ trong scope-and-decisions của plan. |
| Canvas `src/*.dc.html`, `seed`, `project/canvas.json`, references | 112 source boards + 10 seed components; 219 artboards và 331 PNG. Mọi component/state wrapper được gắn phase trong inventory. |
| Handoff 24/09, handoff 25/09, frontend 01–20, roadmap, R1–R10 | Phân biệt thiết kế, giới hạn pilot, mở wave1 Firebase và migration có gate. Không lấy giới hạn pilot cũ để xóa master scope mới. |
| `docs/design/sonflash-redesign/*.md` | Nhận diện bản exploration cũ; nó không được ghi đè thiết kế/workflow chốt sau. |
| Current code + live port 3000 | Xác nhận actual behavior và sự khác biệt; không suy từ log “done”. |

## Những sai lệch đã xác nhận

| Mức | Bằng chứng | Hệ quả và task |
|---|---|---|
| Cao | `src/features/library/LibraryScreen.tsx:137` gọi `openCardCreator`; form nằm trong `details` đóng tại `:181`; `src/app/useAppLearningCoordination.ts:308` chỉ scroll/focus. Reviewer click live: `open:false`, không focus form. | CTA Create card không hoạt động. Phase04.1 sửa theo workflow tạo thẻ Canvas, có regression test từ nút visible. |
| Cao | `src/features/practice/practice-board.css:4` và `:105` chủ yếu trang trí panel có sẵn. Live Quiz so `AnimeQuiz-light.png` thiếu composition card/Lumi/progress/feedback theo thiết kế. Các mode khác cùng vấn đề bố cục. | Rebuild từng mode và trạng thái, phase05.4–05.5. [Ảnh app](../260925-1005-claude-design-workflow-recovery/evidence/current-quiz-1440.png), [Canvas](../../docs/design/sonflash-redesign/canvas/reference/AnimeQuiz-light.png). Hai ảnh khác câu hỏi/state, không dùng để tính pixel diff; sự thiếu composition được xác nhận thêm từ source. |
| Cao | `LibraryTools.tsx:462` là inline create form; `DlgCreate` có modal context/deck/preview/regenerate/save. `EditCardDialog.tsx:62` vẫn centered modal, trong khi EditSheet yêu cầu pause/save/resume cạnh card. | Thiếu workflow, không phải chỉ sai màu. Phase04.2 và04.5. |
| Cao | `DailyLearningWorkspace.tsx:361` hoàn thành lesson bằng close/navigate lại Today; không có state orchestration bốn chặng. `SessionRecapModal.tsx:68–69` chỉ retry weak hoặc close. | Chưa có Today→review→new→match→recap/next như TodaySession/SessionBridge/RecapNext. Phase05.1–05.7. |
| Cao | `CourseSwitcherSlot.tsx:11` ghi placeholder; runtime là `span`+chevron. Chưa có `src/features/courses`, `onboarding`, `languagePacks`, `src/data`. | Chuyển course/Goals/onboarding đa ngôn ngữ chưa có; phase08–10. Appearance đã có không phải Settings toàn bộ đã xong. |
| Cao | `src/lib/speechMatch.ts:8–14` loại ký tự ngoài Latin; `exerciseEngine.ts:112` chia whitespace; normalizer không giữ `translationLanguage`. | Không thể gọi wave1 đã hỗ trợ chỉ vì có `lang` và dropdown ngôn ngữ. Phase08–09. |
| Cao | Extension manifest còn LingoFlash, không `_locales`; import intent có context nhưng không persisted source URL/title model. `CardData` không có web-source provenance. | Extension chưa được redesign đầy đủ; WebWords/Today strip thiếu dữ liệu thực. Phase07. |
| Trung bình | Reviewer đo Crystal landing390: CTA y491–539, Lumi từ khoảng y490; negative stage offset trong `landing-page.css:58`. | Artwork che nhãn sign-in. Phase12.1. [Ảnh](../260925-1005-claude-design-workflow-recovery/evidence/current-landing-390.png). |
| Trung bình | `daily-learning-canvas.css:99` heading25vw; empty Today390 title cao khoảng230px, CTA ban đầu dưới fixed nav, kéo xuống mới thấy. | Cần sửa layout mobile và safe area phase03/05. [Ảnh](../260925-1005-claude-design-workflow-recovery/evidence/current-today-390.png). |
| Chặn gate | `npm run i18n:check` lần audit thất bại: extraction thay catalog; vi/library thiếu16, vi/landing thiếu1. `PlanUsageMeter.tsx:16–32` còn text/date vi hardcode; billing/account catalogs hiện0. | Hoàn tất dịch và scanner coverage phase01/12; không nhận “EN/VI done” từ tên thư mục. |
| Chưa verify | Patch R9 đã sửa13 file nhưng worker dừng trước test sau thay đổi. Báo cáo chỉ có lần test trước sửa:46 pass,3 fail. | R9 partial/unverified, không phải chưa bắt đầu hoặc đã xong. Phase02. |

Không kết luận Paths/Progress sai chỉ vì screenshot empty khác board mẫu có dữ liệu. Ready state phải được kiểm bằng fixture tương đương. Audit browser hiện tại không thay cho nghiệm thu mọi state sau implementation.

## Vì sao kiểm tra cũ không bắt được

`e2e/practice-visual.spec.ts:37–41` và các visual suites so với snapshot do app sinh. Chúng chứng minh app giữ nguyên hình của chính nó; không chứng minh hình đó khớp Canvas. Log cũ ghi “green” và “no high/medium” chỉ đúng phạm vi review lúc đó, không đủ chứng minh yêu cầu user đã được đáp ứng.

Các quyết định thu hẹp được ghi ngay trong `frontend/ui-track-log.md`:

| Dòng | Quyết định cũ | Cách xử lý trong plan mới |
|---|---|---|
| 157 | Không có sequential bridge state nên giữ lesson flow cũ. | Thiếu state là task cần xây; không lấy sample XP làm lý do bỏ cả bridge. |
| 199 | Story tooltip và shadowing waveform chưa có behavior nên không dựng. | Bổ sung workflow và nguồn dữ liệu thật; không giả điểm/waveform. |
| 222 | Giữ inline create và full-card grid vì Canvas modal/compact grid thay behavior. | User yêu cầu redesign cả behavior; triển khai modal/grid và bảo toàn khả năng qua detail/sheet đúng flow. |
| 259 | Omit collage/ribbon cùng language chooser/testimonials/prices. | Collage/ribbon là visual phải tích hợp; language/commercial claims có gate cụ thể. Không gộp khác loại rồi bỏ cả nhóm. |

## Những workflow phải được giữ trong kế hoạch

Learning: daily orchestration/bridge, lesson/placement, sáu practice modes, edit pause/resume, recap có next step, web capture→WebWords→daily queue, progress/achievements/weekly export.

Personalization: course một target language với native language đổi được; Goals riêng; header switcher/mobile sheet; onboarding native/target/goal/level/script/pace/aha/reminder; settings language/voice/reading/keyboard/archive; wave1 en/ko/ja/zh trên Firebase.

Retention/AI: nhắc học có schedule/quiet hours/consent/channel thật, sound/haptics, streaming card generation/partial editing/cancel, tutor có quota/contract. Chưa có hợp đồng không có nghĩa bỏ màn; phase11 giải quyết hợp đồng trước chức năng.

Commercial/global: pricing/Pro/paywall/checkout/referral/league/streak controls đều có task và gate. R5–R8 vẫn chặn giá mẫu/giao dịch pilot chưa được phép. Auth mới, uploads/quota/My Files, API/offline/migration và các locale/target waves có source plan và bước thiết kế bổ sung cho state chưa có Canvas.

## Phạm vi kiểm tra thực tế của audit

| Kiểm tra | Kết quả |
|---|---|
| `npm run lint` | PASS trên worktree lúc audit. |
| `npm run i18n:check` | FAIL như trên. Script đã chạy extraction và thay `.po`; không sửa bản dịch hoặc code để che lỗi trong task lập plan. |
| `ui-snapshot http://127.0.0.1:3000 --routes ...` | CLI capture12 route local, desktop12/12/mobile12/12,0 failure. Manifest có thêm1 record staging cũ được giữ từ run trước; không tính record đó vào audit local. Đây là snapshot discovery, không kiểm hết interactive states. |
| Reviewer live | Desktop1440/mobile390, classic/crystal light/dark; có deterministic practice fixture, create-CTA interaction và đo mobile overlap. Kết luận FIX_REQUIRED. |
| Full core/build/bundle/R9 emulator | Không chạy lại toàn bộ trong task planning này. Không lấy PASS cũ thay evidence của patch hiện tại. |
| Inventory | Source112/112, seed10/10, artboard219/219 có phase;331 reference paths tồn tại; không unmapped. |

Đã dừng agent implementation R9 theo scope audit+plan, bảo toàn patch. Không commit/deploy/reset/xóa dữ liệu. Có `.po` phát sinh từ check extraction, được ghi rõ để phase01 xử lý. Các ảnh evidence là fixture/local audit; không lấy thông tin tài khoản thật.

## Điểm cần quyết định sau khi owner xem kế hoạch

Scope màn hình đã được user chốt, không cần hỏi lại. Các quyết định còn lại là chính sách thực tế để bật commerce/rewards, kênh reminder và migration timing; chi tiết trong [scope-and-decisions](../260925-1005-claude-design-workflow-recovery/scope-and-decisions.md). Trước các quyết định đó vẫn phải giữ task, thiết kế state/contract và tiêu chí nghiệm thu đầy đủ.

## Kiểm tra kế hoạch sau review

- Review độc lập đã phát hiện và xử lý vòng phụ thuộc extension/course bằng07A/B; tách contract/delivery thành11A/B, landing hiện tại/đầy đủ thành12A/B. G1 timing giữ là quyết định còn mở. Nghiệm thu cuối có cạnh bắt buộc từ14 và15; mốc sớm không đồng nghĩa toàn bộ hoàn tất.
- `ak plan validate` đạt. Sweep cuối:15 phase files,89 implementation tasks không trùng ID,122 component/board,219 artboard,331 reference files tồn tại,63 local links hợp lệ. DAG22 nodes/35 edges không có vòng. Các checkbox implementation vẫn chưa được đánh dấu hoàn tất.
- Plan được chọn làm active path; Markdown là nguồn theo dõi task bền vững. Không tạo goal mới hoặc dùng trạng thái goal cũ để chứng nhận các task này đã xong.
- Bước journal qua `ak-journal` đã thử nhưng CLI lỗi `journals: rename: invalid argument`; không có journal được tạo thành công. Nội dung audit/decision và kế hoạch đã lưu trong repo. AgentWiki publish skipped.
