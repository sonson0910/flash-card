---
title: "Nhắc học, âm/rung, AI tiến trình và tutor"
status: todo
---

# 11. Nhắc học, âm/rung, AI tiến trình và tutor

## Kết quả và phụ thuộc

11A: tasks11.1 và11.3 sau05,07A, chốt contract/delivery cùng test design. 11B: tasks11.2,11.4–11.6 sau10 và backend delivery contract sẵn sàng. Nếu11A chọn worker/API tự-host,11B cần capability tương ứng ở14; nếu chọn Firebase thì cần adapter/Functions và gate vận hành đã duyệt. Không đợi toàn14 chỉ để lập contract; không gọi11 hoàn tất khi mới xong11A.

Ước lượng: 5–9 ngày sau khi chốt delivery/AI contract; provisional. Đây là công sức kỹ thuật dự kiến, không phải hạn giao; bao gồm sửa và verify phần phase. Trạng thái hiện tại lấy từ audit, chưa task nào được đánh dấu đạt chỉ vì có patch.

## Nguồn và file sở hữu

Nguồn: ReminderSettings/AnimeSettings; AiStreaming; DlgTutor/AnimeDlgStudy; MotionStoryboard/AnimeMotion/FeedbackSheet; R7; trao đổi Claude 2761–2772.

Đường dẫn dưới đây tương đối với `/mnt/Projects/startup/flash-card` cho đến khi phase migration đổi root theo source plan.

proposed src/features/{reminders,aiTutor}/**; settings; extensions/lingoflash background/badge; AI/intake service & Functions contract; existing sound/motion helpers; API/worker lane khi cần.

File `proposed` là file/module cần tạo, không phải tuyên bố đã tồn tại. File chung do controller chỉnh tuần tự theo [ownership](acceptance-contract.md).

## Công việc cụ thể

| Task | Thực hiện | Điều kiện đạt |
|---|---|---|
| 11.1 | Chốt reminder contract: schedule days/time/timezone, quiet hours, only-if-due/not-studied, opt-in/revoke, receipts. Chốt AI/tutor transport: partial-event schema, operation/cancel/resume, edited-field ownership, quota và data owner. | Ghi rõ service/kênh delivery, schema và kiểm thử hợp đồng trước11B; app đóng vẫn có reminder delivery bằng service phù hợp, không dùng setTimeout trang để hứa push. |
| 11.2 | Browser push, weekly email digest, extension badge có state permission-denied/unsupported/error; timezone/DST/account switch. | Mỗi kênh chỉ gửi theo consent; không duplicate/midnight spam; không có kênh thật thì UI nói chưa bật, task vẫn chưa xong. |
| 11.3 | Âm flip/correct/combo, mobile haptics và setting riêng; transitions Today→review/bridge/reveal/recap. | Respect user prefs, visibility/reduced motion, browser capability; không sound trước interaction cho phép. |
| 11.4 | AI progressive generation thật: stages/partial structured fields, edits không bị chunk sau ghi đè, cancel/regenerate/save/timeout và quota. | Không fake progress bằng timer; một operation/receipt, partial invalid không persist; mất mạng resume/retry theo policy phí đã chốt. |
| 11.5 | Tutor theo thẻ/ngữ cảnh và active pair: entry, bounded conversation, thinking/answer/error, suggest example/explain, usage limit. | Khác generate-dialogue hiện tại; contract + server limits trước UI live; không đưa raw unbounded prompt xuyên trust boundary. |
| 11.6 | Review API/security/cost contract và kết nối UI; nếu cần worker tự-host, nối phase14 với task cụ thể. | Không đổi model fallback; không demo response giả trong app; khả năng chưa bật được ghi rõ trong evidence. |

## Checklist

- [ ] 11.1 — Chốt reminder và AI/tutor delivery contracts, schema, ownership, quota và kiểm thử trước11B.
- [ ] 11.2 — Browser push, weekly email digest, extension badge có state permission-denied/unsupported/error; timezone/DST/account switch.
- [ ] 11.3 — Âm flip/correct/combo, mobile haptics và setting riêng; transitions Today→review/bridge/reveal/recap.
- [ ] 11.4 — AI progressive generation thật: stages/partial structured fields, edits không bị chunk sau ghi đè, cancel/regenerate/save/timeout và quota.
- [ ] 11.5 — Tutor theo thẻ/ngữ cảnh và active pair: entry, bounded conversation, thinking/answer/error, suggest example/explain, usage limit.
- [ ] 11.6 — Review API/security/cost contract và kết nối UI; nếu cần worker tự-host, nối phase14 với task cụ thể.
- [ ] Đối chiếu Canvas từng state của phase theo board/artboard inventory; reviewer kiểm tra cả hành vi và hình thức.
- [ ] Chạy focused checks rồi gates; ghi revision, kết quả và ngoại lệ trong log.

## Verification

Reminder clock/timezone/permission/idempotency tests; AI partial/cancel/edited-field/race tests; tutor quota/owner tests; visual all states; gates chung và extension:check.

Hợp đồng chung: [acceptance-contract.md](acceptance-contract.md). Tên test mới là đề xuất; trước chạy phải kiểm inventory file thực, không báo file vắng là PASS. Với flow có mutation, test dùng emulator/fixtures, không dữ liệu người học hay Gemini thật.

## Rủi ro và rollback

Reminder transport và AI streaming chưa có source spec hoàn chỉnh. Phase bắt buộc tạo contract review trước code, không coi task contract là completion của feature.

Rollback theo commit scope hoặc flag additive đã review; không delete/reset dữ liệu hay dirty work. Bước phụ thuộc sau chỉ nhận contract đã kiểm chứng. Không deploy trong công việc lập kế hoạch này.
