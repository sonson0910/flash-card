---
title: "Thiết kế extension và vòng lưu từ web → học"
status: todo
---

# 07. Thiết kế extension và vòng lưu từ web → học

## Kết quả và phụ thuộc

07A phụ thuộc04,05: tasks07.1–07.4 và07.6. 07B là task07.5, phụ thuộc10. Phase10 chỉ phụ thuộc07A. CảA/B đều required; không đánh dấu toàn07 xong sauA.

Ước lượng: 3–5 ngày. Đây là công sức kỹ thuật dự kiến, không phải hạn giao; bao gồm sửa và verify phần phase. Trạng thái hiện tại lấy từ audit, chưa task nào được đánh dấu đạt chỉ vì có patch.

## Nguồn và file sở hữu

Nguồn: ExtPopup/ExtPopupState/ExtOptions/ExtInPage/ExtContextMenu/ExtLoop; AnimeExt*; WebWords/AnimeWebWords; LangExt/LangExtInPage; frontend 15A/B.

Đường dẫn dưới đây tương đối với `/mnt/Projects/startup/flash-card` cho đến khi phase migration đổi root theo source plan.

extensions/lingoflash/**; src/features/browserExtension/**; proposed src/features/webWords/**; src/types/card.ts; intake/normalization/Rules contract qua controller; scripts/*browser-extension*.mjs.

File `proposed` là file/module cần tạo, không phải tuyên bố đã tồn tại. File chung do controller chỉnh tuần tự theo [ownership](acceptance-contract.md).

## Công việc cụ thể

| Task | Thực hiện | Điều kiện đạt |
|---|---|---|
| 07.1 | Chuyển popup/options/in-page/context states sang Canvas ở cả hai families; SonFlash visible branding, Chrome i18n EN/VI. | Loading/saved/duplicate/error/quota/sign-in/unavailable hoạt động; không đổi storage key/protocol identifier chỉ để rebrand. |
| 07.2 | Giữ selection/context capture, permission, audio, retry, deck chooser và app handoff; tổ chức options theo thiết kế. | Vẫn nonce/origin/owner isolation; chỉ user-initiated capture, không background scraping. |
| 07.3 | Bổ sung metadata nguồn có bounds vào wire và persistence: URL/title/context/capturedAt và cặp ngôn ngữ khi có; chốt schema trong contract trước code. | Context không chỉ được gửi prompt rồi mất; round-trip reload/offline/export giữ metadata; legacy card không bị đoán nguồn. |
| 07.4 | WebWords page nhóm theo bài/site/ngày, xem câu gốc và status, filters, add-to-today; Today có web-words strip. | Lưu một từ từ extension → app → đúng group → thêm session → new-word stage, không nhân đôi từ/card. |
| 07.5 | After 10: mismatch detection, chọn/reopen/create course đích trước import; đọc/ghi locale từ course. | Người đang học Anh lưu từ Hàn không rơi vào queue Anh; signed-out draft và cancel giữ dữ liệu phù hợp. |
| 07.6 | Due-count badge theo trạng thái thật, link về session, phạm vi quyền và current origin giữ nguyên trong giai đoạn Firebase. | Không đổi host permissions trước cutover; reconnect/account switch không rò count người trước. |

## Checklist

- [ ] 07.1 — Chuyển popup/options/in-page/context states sang Canvas ở cả hai families; SonFlash visible branding, Chrome i18n EN/VI.
- [ ] 07.2 — Giữ selection/context capture, permission, audio, retry, deck chooser và app handoff; tổ chức options theo thiết kế.
- [ ] 07.3 — Bổ sung metadata nguồn có bounds vào wire và persistence: URL/title/context/capturedAt và cặp ngôn ngữ khi có; chốt schema trong contract trước code.
- [ ] 07.4 — WebWords page nhóm theo bài/site/ngày, xem câu gốc và status, filters, add-to-today; Today có web-words strip.
- [ ] 07.5 — After 10: mismatch detection, chọn/reopen/create course đích trước import; đọc/ghi locale từ course.
- [ ] 07.6 — Due-count badge theo trạng thái thật, link về session, phạm vi quyền và current origin giữ nguyên trong giai đoạn Firebase.
- [ ] Đối chiếu Canvas từng state của phase theo board/artboard inventory; reviewer kiểm tra cả hành vi và hình thức.
- [ ] Chạy focused checks rồi gates; ghi revision, kết quả và ngoại lệ trong log.

## Verification

npm run extension:check; browserExtension focused suites; extension popup/options screenshots; controlled fixture webpage capture→app→session integration; gates chung.

Hợp đồng chung: [acceptance-contract.md](acceptance-contract.md). Tên test mới là đề xuất; trước chạy phải kiểm inventory file thực, không báo file vắng là PASS. Với flow có mutation, test dùng emulator/fixtures, không dữ liệu người học hay Gemini thật.

## Rủi ro và rollback

Source URL/context là dữ liệu riêng, giới hạn độ dài/protocol/schemes và render text an toàn. Backend contract mới cần review; không fake WebWords bằng seed trong app.

Rollback theo commit scope hoặc flag additive đã review; không delete/reset dữ liệu hay dirty work. Bước phụ thuộc sau chỉ nhận contract đã kiểm chứng. Không deploy trong công việc lập kế hoạch này.
