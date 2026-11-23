# Phase 03 shell/system evidence mapping

**Status:** DONE_WITH_CONCERNS
**Phạm vi:** Consolidation read-only cho Phase 03; không chạy browser, build hoặc test và không sửa source ứng dụng.

## Bằng chứng đã lập bản đồ

CSV [phase-03-shell-system-visual-coverage.csv](../260925-1005-claude-design-workflow-recovery/evidence/phase-03-shell-system-visual-coverage.csv) có **276 row ảnh** (không tính header):

- **252 ảnh accepted** từ `artifacts/recovery-shell-share-20260925-1653/`, thuộc log `phase-02-03-resumed-final-browser.log` (**33/33 passed**). Bộ này gồm account connecting/menu/session-lost, final account row, empty, all-caught-up, feedback, feedback + Undo, Undo và loading/error/offline/sync-error; đủ bốn theme, EN/VI ở 1440×900 và 390×844, pseudo EN-XA ở 360×844. Final-row ghi đúng viewport **390×560** theo ảnh thực tế.
- **24 ảnh exact isolated** từ `artifacts/recovery-shell-isolated-20260925-1710/`: 8 shell navigation đã accepted và 16 appearance settings đang chờ parent refresh sau sửa CSS toggle Classic. Kết quả hành vi được ghép từ `phase-03-isolated-browser.log` (37 case pass trước retry) và `phase-03-isolated-browser-retry.log` (4/4 retry pass); visual verdict của 16 settings vẫn pending render mới.
- Bộ `artifacts/recovery-main-shell-20260925-1535/` có 24 ảnh tương ứng nhưng là snapshot của mixed run; `phase-03-main-shell-browser.log` còn failure ngoài các row ảnh. Bộ này được giữ làm provenance và **không đếm vào CSV** sau khi có bộ isolated 1710. Các `test-failed-1.png` cũng không được map.

CSV dùng source label theo vùng để không gán rộng hơn evidence: account menu/final row là `partials:account-menu` (geometry của account flow hiện có, đối chiếu menu specimen trong `FeedbackSheet.dc.html`/`AnimeFeedback.dc.html`); connecting là `FeedbackSheet:account-connecting` hoặc `AnimeFeedback:account-connecting`; session-lost là `runtime:account-session-lost` vì không có Canvas specimen tương ứng; feedback/Undo là `FeedbackSheet:feedback-sheet` hoặc `AnimeFeedback:feedback-sheet`; system/empty/all-caught-up là `SystemStates:system-states` hoặc `AnimeSystem:system-states`; shell là `partials:navigation` hoặc `AnimeMobile:navigation`. Appearance Classic là `ReminderSettings:toggle-geometry+partials:appearance-controls`, còn Crystal là `AnimeSettings:appearance-tokens` — chỉ token palette/control appearance, không tuyên bố hoàn tất toàn bộ reminder/settings workflow. Các nguồn chuẩn tương ứng là `partials.html`, `AnimeMobile.dc.html`, `AnimeSystem.dc.html`, `SystemStates.dc.html`, `AnimeFeedback.dc.html`, `FeedbackSheet.dc.html`, `AnimeSettings.dc.html`, `AnimeMotion.dc.html` và `MotionStoryboard.dc.html`.

## Phân biệt loại kiểm tra

### Visual

Ma trận ảnh và viewport tuân theo `phase-03-theme-shell-system.md:16,28-32,44-48` và `acceptance-contract.md:7-10,16-27`. Review closure xác nhận các sửa visual chính trên ảnh fresh: Crystal offline cards không đè Lumi, pending count của sync error nằm ngoài detail scrollport, Clear row không bị mobile nav che ở 390×560, profile/status hiện ở initial mobile menu, và reduced-motion đã có trong matrix (`reviewer-260925-1634-system-visual-closure.md:25-49,60-76`). Bộ 16 settings có behavior gate pass nhưng visual verdict đang chờ render sau CSS fix Classic toggle; parent sẽ thay path/verdict khi refresh xong.

### Behavior

- `phase-02-03-resumed-final-browser.log` kết thúc **33 passed**; capture matrix và interaction assertions nằm trong `e2e/shell-share-workflow.spec.ts:266-431`. Initial account bounds/focus ở `:353-364`, final-row scroll/hit-test ở `:368-402`, và reduced-motion setup/assertion ở `:23-38` cùng các call site capture.
- Shell/theme/appearance behavior thuộc `e2e/ui-shell.spec.ts:18-86` và `e2e/settings-appearance.spec.ts:1-137`; hai case destination focus reduced/interrupted được ghi nhận ở retry log nói trên. Settings rows chưa được gọi là visual PASS trong khi chờ ảnh refresh.
- Ảnh là evidence visual; CSV không biến screenshot thành bằng chứng cho hành vi chưa có assertion tương ứng.

### Runtime/data

`acceptance-contract.md:8-12,19-20` yêu cầu trigger → recovery và dữ liệu thật/adapter thật; fixture chỉ được dùng trong test. `worker-260925-1229-shell-navigation.md:15-21,25-28` xác nhận shell gọi action thật, chỉ render streak/level/xp/course khi có runtime data, và giữ các label/destination chưa có contract. Account screenshots dùng fixture identity (`reviewer-260925-1553-account-appearance.md:29-31`), vì vậy không được xem là proof cho account production, persistence dữ liệu hoặc Firebase.

## Bằng chứng còn thiếu và ranh giới ownership

- Report này không chạy lại visual inspection. Acceptance cho phép đối chiếu trực tiếp; các review trước đã mở 100 ảnh system/feedback trong `reviewer-260925-1553-system-feedback.md:7-19`, các đại diện account/appearance trong `reviewer-260925-1553-account-appearance.md:5-20`, và fresh closure trong `reviewer-260925-1634-system-visual-closure.md:16-49`. Bộ shell 1710 bổ sung render/fit sau isolated gate; 16 settings ảnh 1710 là pre-refresh và đang chờ CSS rerender; persistence/system-follow và nội dung workflow vẫn phải đọc theo behavior log/owner tương ứng. Parent đã đóng checklist và các gate Phase 03 riêng; mapping này không thay thế log đó.
- Không thêm row giả cho các motion transition chưa được capture. `reviewer-260925-1525-shell-motion-coverage.md:9-13,27-39` yêu cầu giữ lại: AnimeMotion deal/selected-card/flip/combo/tier/Lumi cho **Phase 04/05/15**, MotionStoryboard Today→Review/recap/edit-sheet cho **Phase 04/05**, và các AnimeMobile screen flows (Today/review/recap/quiz/practice/onboarding/paywall) cho **Phase 04/05/10/11/15**.
- Empty và all-caught-up ở CSV chỉ đóng **system surface** của Phase 03.3. Generate/import/Paths và Learn 5 acquisition không được đánh dấu hoàn tất; library thuộc Phase 04, Today session thuộc Phase 05, Paths thuộc Phase 06, onboarding/course thuộc Phase 10, AI/progress thuộc Phase 11 và commercial/motivation thuộc Phase 15.
- Parent giữ quyền kết luận gate cuối, source hash, build/bundle và cập nhật checklist/phase status. Mapping này không thay thế các gate đó.

Status: DONE_WITH_CONCERNS
Summary: Đã lập CSV 276 ảnh Phase 03, ưu tiên bộ 33/33 accepted và bộ shell isolated; source labels chỉ rõ partials/runtime/Canvas region, còn 16 settings rows chờ ảnh sau CSS refresh.
Concerns/Blockers: Các transition và workflow thuộc Phase 04/05/10/11/15 vẫn mở theo ownership đã ghi; fixture screenshots không chứng minh production account/data persistence.

## Final parent verification — supersedes pending Settings status above

The parent completed the final Classic toggle CSS correction and directly opened the fresh desktop/mobile control captures. `phase-03-settings-final-browser.log` passed 22/22, followed by `phase-03-settings-controls-browser.log` passing 16/16 matrix cases. Each latter case checks focus, pointer reachability, a label touch area at least 44px tall, and the actual custom-switch geometry. Final build/bundle passed with unchanged limits.

The current CSV has **292 rows**: 252 accepted shell/system fixture images, 8 exact isolated shell images, and 32 fresh Settings/controls images in `artifacts/recovery-settings-20260925-1720/`. Its 16 original Settings rows now point to the fresh images; another 16 rows show the controls after focus/scroll. All paths were checked. Earlier pending-render statements above describe the initial mapping snapshot and are closed by this evidence. Later-phase workflows remain open under their documented owners.

Status: DONE
Summary: The mapping and final Settings evidence are complete for the phase-03 scope; no pending-render blocker remains.
