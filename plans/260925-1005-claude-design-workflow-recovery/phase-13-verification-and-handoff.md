---
title: "Nghiệm thu theo mốc và bàn giao có bằng chứng"
status: todo
---

# 13. Nghiệm thu theo mốc và bàn giao có bằng chứng

## Kết quả và phụ thuộc

Các phase thuộc mốc tương ứng. Mốc cuối chỉ đạt khi14/15 và mọi board required đều đạt hoặc owner đổi phạm vi cụ thể.

Ước lượng: 2–4 ngày cho mỗi đợt tích hợp lớn; phụ thuộc số lỗi. Đây là công sức kỹ thuật dự kiến, không phải hạn giao; bao gồm sửa và verify phần phase. Trạng thái hiện tại lấy từ audit, chưa task nào được đánh dấu đạt chỉ vì có patch.

## Nguồn và file sở hữu

Nguồn: acceptance-contract.md; board/artboard inventories; mọi phase; e2e suite; source reports.

Đường dẫn dưới đây tương đối với `/mnt/Projects/startup/flash-card` cho đến khi phase migration đổi root theo source plan.

e2e/**; evidence trong plans/reports hoặc plan evidence directory; ui-track-log/roadmap track-log; plan status; không tự sửa baseline Canvas.

File `proposed` là file/module cần tạo, không phải tuyên bố đã tồn tại. File chung do controller chỉnh tuần tự theo [ownership](acceptance-contract.md).

## Công việc cụ thể

| Task | Thực hiện | Điều kiện đạt |
|---|---|---|
| 13.1 | Đối chiếu từng dòng board/artboard với route/action, state và test; tìm orphan button/view/menu. | Coverage112 source+10 seed+219 artboard accounted; paired states không bị bỏ vì board summary đãchecked. |
| 13.2 | Chạy journey tổng: new→onboard→course→capture/create→daily→edit→recap→weekly→reminder; legacy/offline/account switch; share/extension. | Mọi entry point và return path có assertions; người test đi qua UI, không chỉ mount component và chụp. |
| 13.3 | So Canvas trực tiếp bốn theme × desktop/mobile và trạng thái critical; gate a11y, motion, vi/en/pseudo và languages được mở. | Visual mismatch report rỗng hoặc có ngoại lệ cụ thể được chấp nhận; không refresh hàng loạt snapshot để che mismatch. |
| 13.4 | Chạy toàn bộ gates và cross-browser critical flows; review cross-module/contract/performance. | lint/core/build/bundle/i18n/extension cùng source state; skipped/flake ghi đúng; không nhận screenshot pass là feature pass. |
| 13.5 | Ghi log sau từng phase, commit theo quyền đã có và handoff checklist còn lại cho Claude/owner. | Commit chỉ file scope, có revision và test evidence. Không gọi toàn bộ xong nếu còn gate hoặc workflow chưa implement. |
| 13.6 | Lập release checklist và rollback artifact; phân biệt local/staging/production revision. | Không deploy ở task này; link website cũ không được mô tả là UI mới. |

> **Staleness audit 2026-09-26** ([report](../reports/planner-260926-2229-old-plan-staleness-audit.md)).
> - 13.1, 13.3, 13.5, 13.6 STILL VALID.
> - 13.2 NEEDS REWRITE: thay "legacy/offline/account switch" bằng "legacy (đã backfill language) / mất mạng báo lỗi trung thực và retry cùng operationId / sign-out về landing / đổi account". Journey bắt đầu bằng sign-in; không còn nhánh guest.
> - 13.4 NEEDS REWRITE (nhỏ): harness e2e hiện không có Functions emulator (`package.json:36`), nên các flow review/create/bulk không chạy được. Đây là điều kiện tiên quyết (phase 05 task 05.0). Thêm `npm run test:rules` và test Functions vào bộ gate vì Rules đã bị cắt gọn và có callable bulk mới.

## Checklist

- [ ] 13.1 — Đối chiếu từng dòng board/artboard với route/action, state và test; tìm orphan button/view/menu. — Audit 2026-09-27 tại revision `ab3bcdc` đếm 245 covered, 36 implemented-untested, 9 missing (AnimeReveal ceremonies thuộc 04; drill LangPractice/AnimeLangPractice thuộc 09), 51 out-of-scope-locked. Sau audit đã nối `openStats` vào menu Library/dialog Insights, gỡ `LumiBubble` và `DeckCreationForm`, đổi caught-up Today sang Vocabulary và nối `LibraryClearDialog`. Chưa tick vì tổng đếm theo CSV và các luồng kiểm thử cần rà lại trên revision hiện tại.
  > **Rà lại nguồn 2026-09-29.** Số 9 “missing” là ảnh chụp ở revision `ab3bcdc`, không còn mô tả code hiện tại: `AppRuntime.tsx` lazy-mount `AnimeReveal` từ reward event; `anime-reveal-journey.spec.ts` kiểm đường producer/return và `anime-reveal-visual.spec.ts` kiểm ba ceremony ở bốn theme × desktop/mobile. `PracticeScreen.tsx` lazy-mount `LanguagePracticeDrill`; `language-practice-visual.spec.ts` kiểm en/ko/ja/zh ở cùng ma trận, bao gồm Japanese sentence. `course-onboarding-visual.spec.ts` nay chụp cả Goal với TOPIK được chọn trên tám tổ hợp và kiểm Continue/Back ở mobile. Các nguồn này chưa thay cho việc rà lại từng dòng trong CSV 341 hàng, nên giữ 13.1 mở và không tái dùng tổng đếm cũ làm số liệu hiện tại.
  > **Bảng coverage 2026-09-29.** [CSV 341 dòng](evidence/board-artboard-coverage-260929.csv) hợp nhất audit 27/09 với bằng chứng mã/test mới cho đúng 45 dòng từng `missing` hoặc `implemented-untested`: 6 dialog, 3 AnimeReveal, 1 Mobile tổng hợp, 3 extension in-page, 6 language drill, 26 course/onboarding/settings. Bảng hiện ghi 290 `covered`, 51 `out-of-scope-locked`; không có dòng trống hay lặp. Đã kiểm 41 đường dẫn test và mọi đường dẫn production ghi tường minh trong các dòng covered còn tồn tại. Chromium visual 83/83, emulator Insights/ceremony 4/4 và course/onboarding/settings 12/12 pass trên revision này. `covered` chỉ là route + test, không có nghĩa Canvas MATCH; nhiều ngoại lệ hình ảnh và gate chủ dự án vẫn nằm ở các phase. 13.1 giữ mở đến khi rà lại hành vi 245 dòng carried-forward và quét orphan trên mã hiện tại; kiểm file tồn tại chưa chứng minh đường đi đó vẫn hoạt động.
  > **Rà tiếp 2026-09-29.** Đối chiếu 8 nút không có handler trực tiếp do quét cú pháp đánh dấu: Radix `asChild`, submit form hoặc handler cùng dòng đều vận hành; không tìm thấy nút orphan trong nhóm này. Tám dòng CSV carried-forward đã được cập nhật bằng đường mount hiện tại cho DlgClear/Dialogs3, test emulator đi qua UI thật cho DlgDeckNew (tạo deck, focus quay về, reload giữ dữ liệu; Chromium 1/1), và panel Hangul review có test front/back trên tám tổ hợp. Ghi chú audit cũ vẫn nằm trong cột `historic_note` để giữ provenance. 13.1 còn mở cho phần hành vi chưa rà trong 245 dòng cũ.
  > **Gate extension 2026-09-29.** 29 dòng carried-forward không trỏ `e2e/` đều thuộc extension và dẫn test `extensions/lingoflash/tests/`; `npm run extension:check` pass 200/200 cùng kiểm manifest/protocol. Đã ghi kết quả vào `verification_basis` của đúng 29 dòng, không coi Node test là hành trình extension cài thật trong browser. Phần 13.1 còn cần rà các đường app carried-forward khác.
  > **Quiz/Spelling 2026-09-29.** Ca emulator Chromium mới đi từ Today qua menu practice, trả lời câu đầu, kiểm phản hồi, sang câu hai và Exit về Library cho cả Quiz và Spelling (1/1 pass). `usePracticeSession.close()` hiện đưa practice về Library, đúng với đường test cũ; ca mới kiểm đích này tường minh. Đã bổ sung bằng chứng vào 14 dòng carried-forward Quiz/Spelling. Các biến thể paired/mobile vẫn dựa vào visual fixture; Story chưa có ca production tương tự, nên 13.1 tiếp tục mở.
  > **Xóa deck 2026-09-29.** Mở rộng ca Library production: tạo deck, reload, hủy xóa, xác nhận xóa, reload và kiểm deck không quay lại; emulator Chromium 1/1 pass. Đã bổ sung vào 6 dòng DlgDeckDelete/AnimeDlgManage/Dialogs3. Hình Crystal/Anime vẫn là bằng chứng fixture; không suy ra Canvas MATCH.
  > **Edit/menu 2026-09-29.** Ca `pilot-capture-edit-review.spec.ts` chạy lại qua emulator Chromium 1/1 pass: Library Edit → lưu → bookmark → mở thẻ → study. Bổ sung vào 3 dòng DlgEdit/Dialogs1 trước đó chỉ nêu fixture. Rà tĩnh các menu trong `LibraryManagementMenu`, `ThemeMenu`, `LanguageMenu` và nav desktop: các mục hiển thị có handler hoặc href; chưa thấy menu orphan trong nhóm này. Vẫn cần kiểm các view/menu khác và phân biệt fixture với đường production trên các dòng carried-forward còn lại.
  > **Import CSV 2026-09-29.** Ca `app-shell-remediation.spec.ts` đi từ Library tools qua dialog import CSV có `Word,Translation`, xác nhận hoàn tất và reload còn thẻ; emulator Chromium 1/1 pass. Ca đợi cloud báo `Synced` trước mutation vì kiểm tra `libraryEpoch` bất đồng bộ; những lần chạy trước thao tác quá sớm nên báo storage chưa sẵn sàng. Bổ sung bằng chứng vào 3 dòng DlgImport/Dialogs3. Story vẫn chưa có hành trình production tương ứng; 13.1 tiếp tục mở.
  > **Scan text 2026-09-29.** Hai ca production trong `app-shell-remediation.spec.ts` đi từ Library tools và Empty Library tới `WordExtractorModal`, kiểm trường nhập, trạng thái nút, đóng/mở lại và focus quay về nút mở; emulator Chromium 1/1 mỗi ca. Lần chạy đầu phát hiện focus không trở về, đã nối `restoreFocusRef` cho cả hai entry point; 25 unit tests Library liên quan pass. Không gọi AI nên chỉ xác nhận entry/dialog, chưa xác nhận kết quả trích xuất hay tạo thẻ. Bổ sung bằng chứng vào 3 dòng DlgExtract/Dialogs2.
  > **Share 2026-09-29.** Hai ca production trong `app-shell-remediation.spec.ts` tạo/thu hồi link và cho tài khoản emulator thứ hai nhận một thẻ qua link; reload Library người nhận vẫn còn thẻ (Chromium 1/1 mỗi ca). Lần chạy đầu phát hiện dialog báo hoàn tất trước khi `createCardV2` xác nhận, nên reload làm mất mutation đang chờ. Nhánh intake `shared` nay đợi mọi cloud settlement, trả lỗi nếu có thẻ chưa xác nhận, và báo retry trung thực khi một phần thẻ đã lưu. Timeout nhận deck cho phép đủ số đợt ghi cloud tối đa 100 thẻ; 83 unit tests intake/session liên quan pass, gồm retry chỉ thẻ còn thiếu, không báo timeout giả sau 20 giây, và vẫn báo timeout cho tác vụ treo. Bổ sung bằng chứng vào 5 dòng DlgShare/ShareIn/Dialogs2. Ca production ở revision đó chỉ nhận một thẻ; Canvas fidelity vẫn là gate riêng.
  > **Share batch 2026-09-29.** Mở rộng ca người nhận lên 12 thẻ, vượt một đợt ghi cloud. Lần đầu chỉ lưu 9/12: sáu lệnh `createCardV2` đồng thời tranh chấp rate-limit storage, dialog giữ link và báo lỗi thay vì báo thành công giả. Giới hạn riêng Share còn hai lệnh ghi đồng thời và timeout nhận deck được tính theo số đợt; ca emulator Chromium sau đó pass 1/1, Firestore người nhận đủ 12/12 và reload tìm được thẻ đầu/cuối. Unit test khóa concurrency và 49/49 test intake/session liên quan pass. `npm run verify:core` pass trên source cuối: app 2342/2342, Functions unit 430/430, Rules 93/93 và Functions integration 44/44. Một lần core trước đó timeout ở test Share transaction với ngưỡng mặc định 5 giây; log emulator xác nhận lock contention, chạy chẩn đoán 15 giây pass 2/2, rồi đặt timeout riêng 15 giây theo mẫu integration hiện có mà giữ nguyên assertion. `findVocabularyImage` nền vẫn có log timeout khi nạp 12 thẻ, nên chưa gọi Functions runtime sạch; chưa thử đủ 100 thẻ hay Canvas fidelity.
  > **Ảnh nền khi nhận Share 2026-09-29.** Test controller tái hiện sáu request ảnh đồng thời khi thẻ mới đứng đầu danh sách trong lúc ba thẻ cũ còn đang tải: giới hạn ba trước đây chỉ áp dụng theo từng lần `hydrateLibrary()`. Controller nay gom các lần gọi chồng nhau thành một lượt tối đa ba request, xử lý thẻ mới sau lượt đang chạy và không thử lại thẻ lỗi ngay trong cùng lượt. Một test khác tái hiện thẻ cũ còn xếp hàng sau đổi tài khoản; lượt tải nay bỏ qua thẻ đó. Test controller 12/12 và typecheck pass trên source cuối; trước guard đổi tài khoản một dòng, toàn bộ app unit 2344/2344 và ca Share 12 thẻ trên emulator Chromium 1/1 pass. `findVocabularyImage` vẫn báo `RateLimitStorageTimeoutError` trong emulator; không coi giới hạn phía client là cách khắc phục đầy đủ cho timeout Firestore hoặc bằng chứng ảnh đã hiện. Cần điều tra riêng đường ảnh nếu muốn đóng gate runtime sạch.
  > **Đo rate-limit ảnh 2026-09-29.** Phép đo độc lập trên Firestore emulator gọi cùng ngân sách ảnh của một owner: một request hoàn tất sau 1,36 giây; hai và ba request đồng thời đều hết hạn ở 2 giây nhưng vẫn ghi ngân sách sau đó (lượt đo hai request đã đợi cả hai giao dịch nền hoàn tất và thoát sạch). Nguồn ảnh nền nay mặc định chạy một request mỗi lần, còn giới hạn có thể truyền tường minh cho controller vẫn được test. Test controller 13/13, toàn bộ app unit 2346/2346 và typecheck pass; ca Share 12 thẻ trên emulator Chromium pass 1/1, tám lần `findVocabularyImage` trong log không có `RateLimitStorageTimeoutError`, log Firestore của lượt đó không có transaction lock timeout. Chưa khẳng định mọi ảnh đã hiện hoặc production sẽ không timeout; tải ảnh tuần tự có thể chậm hơn khi Library nhiều thẻ thiếu ảnh.
  > **Share giới hạn 100 thẻ 2026-09-30.** Ca người nhận ở mức tối đa lần đầu chỉ lưu 92/100 thẻ và dialog báo lỗi trung thực; log Functions có `RateLimitStorageTimeoutError` ở `createCardV2` cùng Firestore transaction lock timeout. Nhánh Share nay ghi tuần tự từng thẻ và tính timeout theo 100 đợt ghi; các nguồn intake khác giữ giới hạn cũ. Ca emulator Chromium sau sửa pass 1/1, Firestore người nhận đủ 100/100 thẻ, reload tìm được thẻ đầu/cuối; ca 12 thẻ chạy lại pass 1/1. Test intake/session 49/49, lint và `npm run verify:core` pass trên source cuối: app 2346/2346, Functions unit 430/430, Rules 93/93, Functions integration 44/44. Log của ca 100 thẻ không có rate-limit storage hay transaction lock timeout. Đây là bằng chứng emulator cho đường Share, chưa chứng minh production hoặc Canvas MATCH; 13.1 và các gate tổng vẫn mở.
- [ ] 13.2 — Chạy journey tổng: new→onboard→course→capture/create→daily→edit→recap→weekly→reminder; legacy/offline/account switch; share/extension.
- [ ] 13.3 — So Canvas trực tiếp bốn theme × desktop/mobile và trạng thái critical; gate a11y, motion, vi/en/pseudo và languages được mở.
- [ ] 13.4 — Chạy toàn bộ gates và cross-browser critical flows; review cross-module/contract/performance.
- [ ] 13.5 — Ghi log sau từng phase, commit theo quyền đã có và handoff checklist còn lại cho Claude/owner.
- [x] 13.6 — Lập release checklist và rollback artifact; phân biệt local/staging/production revision. Xem [release-checklist.md](release-checklist.md) (snapshot 2026-09-27, không deploy).
- [ ] Đối chiếu Canvas từng state của phase theo board/artboard inventory; reviewer kiểm tra cả hành vi và hình thức.
- [ ] Chạy focused checks rồi gates; ghi revision, kết quả và ngoại lệ trong log.

## Verification

npm run verify:core; npm run build; npm run verify:bundle; npm run i18n:check; npm run extension:check; selected Chromium/Firefox/WebKit and mobile review suites; audit release-specific checks khi bước đó được phép.

Hợp đồng chung: [acceptance-contract.md](acceptance-contract.md). Tên test mới là đề xuất; trước chạy phải kiểm inventory file thực, không báo file vắng là PASS. Với flow có mutation, test dùng emulator/fixtures, không dữ liệu người học hay Gemini thật.

## Rủi ro và rollback

Review agreement không thay thực nghiệm. Trước start preview kiểm PID/port, dừng process do phiên tạo khi xong; không giết process của user.

Rollback theo commit scope hoặc flag additive đã review; không delete/reset dữ liệu hay dirty work. Bước phụ thuộc sau chỉ nhận contract đã kiểm chứng. Không deploy trong công việc lập kế hoạch này.
