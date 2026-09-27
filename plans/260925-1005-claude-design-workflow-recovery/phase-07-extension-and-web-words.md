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

> **Staleness audit 2026-09-26** ([report](../reports/planner-260926-2229-old-plan-staleness-audit.md)). Phạm vi audit: 07.3, 07.4, 07B (07.5). 07.1 và 07.6 chỉ còn thiếu so hình Canvas, xem ghi chú bên dưới.
> - 07.3 NEEDS REWRITE: payload extension hiện chỉ có word/context ≤500 ký tự (`browserExtensionImport.ts:12,119-144`) và `src/types/card.ts` chưa có field nguồn. Thẻ được tạo qua callable `createCard` (`functions/src/cardPersistence.ts`, `canonicalCard`), nên metadata phải vào hợp đồng callable và field guard Rules đã gom nhóm, kèm `npm run test:rules` vì trần 1.000 expression. Acceptance đổi "reload/offline/export" thành "reload/export/import round-trip".
> - 07.4 NEEDS REWRITE: chưa có `src/features/webWords`. "Add-to-today" và strip trên Today phụ thuộc stage "từ mới" của 05.2 mới. Query nhóm theo site/ngày phải lọc `language`, có index và có paging, kèm số read.
> - 07.5 (07B) NEEDS REWRITE: không còn "signed-out draft". Người dùng signed-out bị đưa về landing (`AppRuntime.tsx:208-210`); intent import trong `sessionStorage` (`useBrowserExtensionImport.ts:22-33`) phải sống qua lần sign-in. Routing course nghĩa là ghi `language` đúng target, vì course lọc trên `language`.

## Checklist

- [x] 07.1 — Chuyển popup/options/in-page/context states sang Canvas ở cả hai families; SonFlash visible branding, Chrome i18n EN/VI. (2026-09-27, xem ghi chú)
- [x] 07.2 — Giữ selection/context capture, permission, audio, retry, deck chooser và app handoff; tổ chức options theo thiết kế. (2026-09-27, xem ghi chú)
- [ ] 07.3 — Bổ sung metadata nguồn có bounds vào wire và persistence: URL/title/context/capturedAt và cặp ngôn ngữ khi có; chốt schema trong contract trước code.
- [ ] 07.4 — WebWords page nhóm theo bài/site/ngày, xem câu gốc và status, filters, add-to-today; Today có web-words strip.
- [ ] 07.5 — After 10: mismatch detection, chọn/reopen/create course đích trước import; đọc/ghi locale từ course.
- [ ] 07.6 — Due-count badge theo trạng thái thật, link về session, phạm vi quyền và current origin giữ nguyên trong giai đoạn Firebase.
- [ ] Đối chiếu Canvas từng state của phase theo board/artboard inventory; reviewer kiểm tra cả hành vi và hình thức.
- [ ] Chạy focused checks rồi gates; ghi revision, kết quả và ngoại lệ trong log.

**Cập nhật 2026-09-27 (07.4, chưa tick — chờ diff controller):** [`fullstack-developer-260927-0200-web-words.md`](../reports/fullstack-developer-260927-0200-web-words.md)
- Đã có `src/features/webWords/**`: query phân trang (`where('language','==',target)` +
  `orderBy('source.capturedAt','desc')`, `limit(30)` + lookahead), nhóm theo bài/site/ngày (tái
  dùng `formatCardDate` của Library), filter site/ngày/status, "Add to today" thêm vào đầu
  `freshLogicalIds` của session đang chạy qua `promoteCardsToActiveSessionNewStage` (không nhân
  đôi, dùng đúng khoá dedup `logicalIdentity` của `dailyPlan.ts`), Today strip tự fetch `limit(5)`
  sau paint (không thêm read cho Today). Nửa "loop" của `ExtLoop` xong: popup hiện nhắc khi có
  lượt lưu (`kind:'create'` trong `recentLookups` đã có), nút mở app tới `?webWords=1` qua
  `OPEN_APP` mở rộng thêm field `target` (không thêm protocol id, không đổi manifest). 34 test
  vitest + 5 test extension mới, tất cả pass; `tsc` sạch; `extension:build` check pass.
- CHƯA tick vì tiêu chí "lưu từ → app → đúng group → thêm session → new-word stage" cần
  `?webWords=1` được mount trong `src/app/AppRuntime.tsx` (controller sở hữu) — diff chính xác đã
  đề xuất trong báo cáo, chưa áp. `e2e/web-words.spec.ts` viết đủ 2 test (không làm yếu assertion)
  nhưng chưa chạy được vì lý do trên. Gap phụ, không áp: `dailyPlan.ts` không đảm bảo "lên đầu
  hàng" khi thêm từ lúc session CHƯA bắt đầu (chỉ đảm bảo khi đã bắt đầu).
- Sự cố đã xảy ra và ĐÃ khôi phục đầy đủ: một `git checkout --` xoá tạm 15 key i18n của lane khác
  trong `extensions/lingoflash/_locales/{en,vi}/messages.json`; phục hồi 100% qua transcript
  JSONL, xem chi tiết trong báo cáo.

**Cập nhật 2026-09-26 (con của 07.1 và 07.6, không tick hai dòng cha vì vẫn thiếu so hình Canvas):**
- 07.6 due-count: đã đóng đúng blocker mà báo cáo 07A nêu (`plans/reports/fullstack-developer-260925-2240-phase07a-extension.md`) — thêm emitter phía app (`src/features/extensionBridge/useExtensionDueCountBridge.ts`, mount một dòng trong `src/app/AppRuntime.tsx`) gửi due count thật (từ `library.model.cloudStats.due`, không đọc Firestore thêm) qua đúng contract `LINGOFLASH_EXTENSION_DUE_COUNT`/`_CLEAR` đã có sẵn ở `extensions/lingoflash/app-bridge.js`/`background-core.js`. Owner switch/sign-out phát `_CLEAR` trước khi tạo scope mới; test xác nhận không rò số của owner trước. Badge trong popup giờ nhận số thật (trước đây luôn `null`). `manifest.json` không đổi (đã diff-check).
- 07.1 Crystal Star (phần token/font còn thiếu theo báo cáo 07A): đã áp token thật của family Crystal Star ("Starry Night" tối / "Prism Day" sáng) vào `extensions/lingoflash/design-tokens.css`, lấy từ `public/theme-crystal.css` và `docs/design/sonflash-redesign/canvas/tokens.json` (crystal-dark/crystal-light) — không tự sáng tác màu. Vendor font Kanit/Nunito (đã có sẵn trong `extensions/lingoflash/fonts/crystal/` từ 07A nhưng chưa wire) nay được khai báo trong `design-fonts.css`. Thêm lựa chọn family (Classic/Crystal Star) vào `options.html`/`options.js`, và `shared.js` có `applyThemeFamily` set `data-theme-family` (popup/options áp khi boot và khi đổi trong options). Vẫn CHƯA làm: so hình trực tiếp với board `AnimeExtPopup`/`AnimeExtOptions`/`AnimeExtInPage`/`AnimeExtContextMenu` trên Canvas (không có trình duyệt trong lượt này); `ExtLoop` (loop/quota) vẫn chưa triển khai như 07A đã ghi; chamfer/góc vát đặc trưng Crystal Star trong app KHÔNG được port sang extension (dùng border-radius đơn giản 14px, một giản lược có ghi chú trong code/báo cáo).

**Cập nhật 2026-09-27 (07.1/07.2, đóng luôn hai dòng cha — báo cáo đầy đủ: [fullstack-developer-260927-0025-extension-canvas.md](../reports/fullstack-developer-260927-0025-extension-canvas.md)):**
- 07.1 — 7 state điều kiện đạt (loading/saved/duplicate/error/quota/sign-in/unavailable) nay đều có trong popup (`popup.js`/`popup.html`/`popup.css`), đã Playwright-screenshot và xem bằng mắt ở cả 4 tổ hợp family×scheme (Classic Midnight Aurora/Ink & Paper, Crystal Star Starry Night/Prism Day) — 32 ảnh tại `plans/reports/assets/extension-260927/`. Duplicate/saved dùng chung result-card nhưng tách tone bằng `data-status` (badge lục cho created, hổ phách cho existing); quota là state riêng suy ra client-side từ 3 cụm từ khóa `captureFailureMessage.ts` đảm bảo có trong message lỗi (không có protocol status mới, không sửa enum `status`). Chamfer Crystal Star đã port sang `popup.css` và `options.css` (biến `--sf-chamfer`/`--sf-chamfer-sm` mới trong `design-tokens.css`, lấy verbatim từ `public/theme-crystal.css`). In-page bubble (`background-ui.js`) được phân biệt tone duplicate/quota (badge hổ phách riêng, quota có note + nút "Mở SonFlash · Nâng cấp Pro" thay vì nút thử lại) nhưng KHÔNG chamfer — bubble này không đọc `data-theme-family` (nó là style inline cố định tiêm vào trang bất kỳ qua `executeScript`, không có gì để chamfer theo family). Gap còn lại, cố ý: `ExtLoop` chỉ làm nửa "quota"; nửa "loop" (nhắc ôn web-words hằng tuần) cần dữ liệu 07.4/WebWords chưa tồn tại — không giả lập.
- 07.2 — Không đổi bất kỳ storage key, protocol identifier hay `manifest.json` nào (`git diff --stat -- extensions/lingoflash/manifest.json` rỗng). Retry giờ hoạt động từ cả content-script bubble (có `sender.tab`) lẫn popup (không có `sender.tab`, fallback qua `activeTab()` có sẵn) — cùng một `RETRY_QUICK_ADD` handler, cùng nonce/owner check. `npm run extension:build` (test + check + build + zip check) pass sạch, 172 test (thêm 12 test mới cho retry fallback, tone quota/duplicate, chamfer options).

**Cập nhật 2026-09-27 (07.5, integration lane, chưa tick — xem giới hạn dưới):**
- Phát hiện giới hạn wire protocol: `BrowserExtensionImportIntent` (`browserExtensionImport.ts`) không mang field ngôn ngữ nào, và `extensions/lingoflash/background-core.js:535` chốt cứng `sourceLanguage:'en'` khi tạo job capture — nghĩa là extension chỉ có một giả định ngôn ngữ cố định (Anh→Việt), không phải một lựa chọn động cần đọc từ trang. `extensions/lingoflash/**` không nằm trong file ownership của lượt này nên không sửa mã nguồn extension.
- Dựa trên giả định cố định đó (là một hằng số đã biết, không cần extension gửi thêm gì), đã thêm gate `ensureCaptureCourse` mới vào `BrowserExtensionImportOptions` (`src/features/browserExtension/browserExtensionImportRuntime.ts`) chạy ngay trước khi một capture **silent** (one-click, không qua review) được generate. Gate gọi lại `resolveShareCourseAction`/`createSharedDeckCoursePort` (đúng pattern 10.6/`shareCourseMatching.ts`) với cặp ngôn ngữ cố định `{targetLanguage:'en', translationLanguage:'vi'}` so với course đang active; nếu khớp hoặc không có course, generate chạy y như cũ (0 hành vi đổi). Nếu lệch, `window.confirm` (i18n id mới, xem dưới) hỏi người dùng trước khi gọi `ensureCourseForIncomingShare` (switch/reopen/create đúng course tiếng Anh) rồi mới generate. Huỷ (Cancel) xoá luôn entry `sessionStorage` đang chờ, giải phóng `activeIntentKey`, và gửi một kết quả `status:'error'` sạch cho extension — không còn generate nửa chừng, không card nào được tạo.
- Capture **manual** (mode khác `silent`, mở library rồi chờ người dùng bấm Generate) CHỦ Ý không thêm gate riêng: `applyUnverifiedDraft` đã mở library, nơi `CourseSwitcherSlot` (nav thật) đã hiển thị sẵn trước khi người dùng generate — người dùng tự chọn course qua UI có sẵn, không cần gate trùng lặp.
- "Đọc/ghi locale từ course" trong điều kiện đạt CHƯA làm ở lượt này: không tìm thấy yêu cầu cụ thể tương ứng trong phạm vi 6 sub-task được giao cho lane integration; cần owner làm rõ có phải là UI locale (EN/VI) của popup extension đồng bộ theo `nativeLanguage` của course active hay không, trước khi triển khai — nếu không, dễ đổi sai hành vi hiện tại (locale popup đang theo Chrome i18n, không theo course).
- Sai lệch có chủ đích so với "chọn/reopen/create course đích" theo nghĩa một UI chọn 3 chiều: `resolveShareCourseAction` đã tự quyết định ĐÚNG một hành động (switch/reopen/create) từ dữ liệu course thật, nên người dùng chỉ cần xác nhận "có" hoặc "không" (`window.confirm`, không CSS mới, không bundle mới) — không cần dựng modal 3 lựa chọn.
- i18n mới: `extension.import.course-mismatch-confirm` — "This word was captured assuming English, but your active course isn't English. Switch to (or create) your English course to save it?" / VI: "Từ này được lưu theo giả định là tiếng Anh, nhưng khoá học đang hoạt động của bạn không phải tiếng Anh. Chuyển sang (hoặc tạo) khoá học tiếng Anh để lưu từ này?"
- Test: 3 test mới trong `browserExtensionImportRuntime.test.ts` (cancel không sinh card + xoá sessionStorage + gửi kết quả lỗi sạch; proceed sinh card như cũ; gate reject vẫn sinh card theo đúng hợp đồng best-effort của `createSharedDeckCoursePort`). Đọc "intent sống qua sign-in" xác nhận bằng specification (không cần code mới): `sessionStorage` tồn tại theo top-level browsing context của tab, sống qua cả `signInWithPopup` (tab chính không điều hướng) và `signInWithRedirect` (điều hướng cùng tab, round-trip cùng origin) — `identitySessionFirebaseAdapter.ts:74-78` dùng đúng hai API này.

## Verification

npm run extension:check; browserExtension focused suites; extension popup/options screenshots; controlled fixture webpage capture→app→session integration; gates chung.

Hợp đồng chung: [acceptance-contract.md](acceptance-contract.md). Tên test mới là đề xuất; trước chạy phải kiểm inventory file thực, không báo file vắng là PASS. Với flow có mutation, test dùng emulator/fixtures, không dữ liệu người học hay Gemini thật.

## Rủi ro và rollback

Source URL/context là dữ liệu riêng, giới hạn độ dài/protocol/schemes và render text an toàn. Backend contract mới cần review; không fake WebWords bằng seed trong app.

Rollback theo commit scope hoặc flag additive đã review; không delete/reset dữ liệu hay dirty work. Bước phụ thuộc sau chỉ nhận contract đã kiểm chứng. Không deploy trong công việc lập kế hoạch này.
