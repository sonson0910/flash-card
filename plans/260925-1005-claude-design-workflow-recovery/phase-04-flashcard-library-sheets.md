---
title: "Flashcard, thư viện, tạo/sửa thẻ và toàn bộ dialog/sheet"
status: todo
---

# 04. Flashcard, thư viện, tạo/sửa thẻ và toàn bộ dialog/sheet

## Kết quả và phụ thuộc

03. Sửa broken create CTA là task đầu.

Ước lượng: 3–5 ngày. Đây là công sức kỹ thuật dự kiến, không phải hạn giao; bao gồm sửa và verify phần phase. Trạng thái hiện tại lấy từ audit, chưa task nào được đánh dấu đạt chỉ vì có patch.

## Nguồn và file sở hữu

Nguồn: Seed Aurora/Atelier/FlashFront/FlashBack/CardStates/LibraryScreen; AnimeVocabulary/Review/Reveal/EditSheet/DlgLibrary/DlgManage; DlgCreate/Edit/Extract/Import/DeckNew/DeckDelete/Share/ShareIn/Clear/Insights; frontend 06,09.

Đường dẫn dưới đây tương đối với `/mnt/Projects/startup/flash-card` cho đến khi phase migration đổi root theo source plan.

src/features/library/**; src/features/cardEdit/**; src/components/Flashcard.tsx; src/components/flashcard/**; src/components/study/**; src/app/useAppLearningCoordination.ts; src/features/{intake,importExport,sharing}/** qua contract owner.

File `proposed` là file/module cần tạo, không phải tuyên bố đã tồn tại. File chung do controller chỉnh tuần tự theo [ownership](acceptance-contract.md).

## Công việc cụ thể

| Task | Thực hiện | Điều kiện đạt |
|---|---|---|
| 04.1 | Chuyển Create card vào workflow modal Canvas; CTA phải mở UI và focus trường nhập. Bỏ phụ thuộc scroll vào details đang đóng. | Từ CTA visible mở dialog visible/focused; Esc/cancel quay focus về nút; test tái hiện lỗi hiện tại fail trước sửa. |
| 04.2 | Tạo thẻ: input/context/deck → generate → preview/edit → regenerate chọn phần → save; manual path và quota/error/retry/cancel. | Không tự save trước ý định user; quota tính khi AI tạo xong, hủy preview vẫn tính, Save không tính thêm (owner chốt 25/09). Retry giữ operationId theo policy, không tạo card trùng; state từng bước khớp DlgCreate. |
| 04.3 | Library compact grid/list, deck rail, search và filters All/Due/New/Learning/Mastered/bookmark; sorting/paging/bulk tools theo Canvas. | Tile mở full card với audio/flip/bookmark/deck/edit/report; grid không làm mất chức năng. Empty-first-use khác empty-filter. |
| 04.4 | Full card front/back/Zen giữ tilt, spotlight, aura, 3D flip, star pop, blind blur, audio waves; tier rims và hover wings đúng board. | Tất cả effects có kiểm tra, cả reduced-motion fallback; AI disclosure/report luôn reachable. |
| 04.5 | EditSheet desktop + MobileSheet: pause session/timer, draft preview, discard/dirty exit, save/error, resume đúng card/index. | FSRS/review history không reset; thay đổi từ sync không bị draft ghi đè ngoài field đã sửa; không mất answer/timer khi đóng sheet. |
| 04.6 | Đưa create/delete deck, extractor chọn kết quả, import mapping/results, share in/out, clear, insights vào đúng dialog/sheet board. | Mỗi overlay có open/working/success/fail/cancel/focus-return; export JSON/XLSX/mini vẫn hoạt động; clear/delete có confirm thật. |
| 04.7 | Tách field có hợp đồng chưa hỗ trợ (đổi headword/POS/image/upload) thành task data contract nối phase 08/14; không render nút inert. | Đầy đủ nhu cầu của board được giữ trong backlog; không chấp nhận editor ít field hơn Canvas là xong. |

## Checklist

- [ ] 04.1 — Chuyển Create card vào workflow modal Canvas; CTA phải mở UI và focus trường nhập. Bỏ phụ thuộc scroll vào details đang đóng.
- [ ] 04.2 — Tạo thẻ: input/context/deck → generate → preview/edit → regenerate chọn phần → save; manual path và quota/error/retry/cancel.
- [ ] 04.3 — Library compact grid/list, deck rail, search và filters All/Due/New/Learning/Mastered/bookmark; sorting/paging/bulk tools theo Canvas.
- [ ] 04.4 — Full card front/back/Zen giữ tilt, spotlight, aura, 3D flip, star pop, blind blur, audio waves; tier rims và hover wings đúng board.
- [ ] 04.5 — EditSheet desktop + MobileSheet: pause session/timer, draft preview, discard/dirty exit, save/error, resume đúng card/index.
- [ ] 04.6 — Đưa create/delete deck, extractor chọn kết quả, import mapping/results, share in/out, clear, insights vào đúng dialog/sheet board.
- [ ] 04.7 — Tách field có hợp đồng chưa hỗ trợ (đổi headword/POS/image/upload) thành task data contract nối phase 08/14; không render nút inert.
- [ ] Đối chiếu Canvas từng state của phase theo board/artboard inventory; reviewer kiểm tra cả hành vi và hình thức.
- [ ] Chạy focused checks rồi gates; ghi revision, kết quả và ngoại lệ trong log.

## Verification

LibraryCardGrid/LibraryScreen/EditCardDialog and intake/import/share focused suites; e2e/library-visual.spec.ts, flashcard-effects.spec.ts, pilot-capture-edit-review.spec.ts; add create/edit-resume journey; gates chung.

Hợp đồng chung: [acceptance-contract.md](acceptance-contract.md). Tên test mới là đề xuất; trước chạy phải kiểm inventory file thực, không báo file vắng là PASS. Với flow có mutation, test dùng emulator/fixtures, không dữ liệu người học hay Gemini thật.

## Rủi ro và rollback

Không xóa form/Flashcard cũ trước khi behavior mới đạt. Seeded visual fixtures không nằm trong product runtime. AI streaming thực nối phase 11.

Rollback theo commit scope hoặc flag additive đã review; không delete/reset dữ liệu hay dirty work. Bước phụ thuộc sau chỉ nhận contract đã kiểm chứng. Không deploy trong công việc lập kế hoạch này.
