---
title: "Auth, upload, API/offline và các workflow phụ thuộc backend"
status: in-progress
---

# 14. Auth, upload, API/offline và các workflow phụ thuộc backend

## Kết quả và phụ thuộc

Gate migration trong roadmap phase04; phần UI/contracts có thể chuẩn bị theo source plan, không tự triển khai hạ tầng.

Ước lượng: Theo roadmap hiện có15–18 tuần backend/integration; cần re-estimate sau contract freeze. Đây là công sức kỹ thuật dự kiến, không phải hạn giao; bao gồm sửa và verify phần phase. Trạng thái hiện tại lấy từ audit, chưa task nào được đánh dấu đạt chỉ vì có patch.

## Nguồn và file sở hữu

Nguồn: ../260925-0907-post-ui-launch-roadmap/phase-04-migration-decision-gate.md và phase05/06; frontend13,14,17,19,20; backend00–09; shared S1.

Đường dẫn dưới đây tương đối với `/mnt/Projects/startup/flash-card` cho đến khi phase migration đổi root theo source plan.

Source roadmap owner files: proposed apps/api/apps/worker/packages/contracts after monorepo conversion; src/features/session/account; proposed src/data/api; offline queues/mirrors; uploads/storage/settings; hosting config chỉ khi được phép.

File `proposed` là file/module cần tạo, không phải tuyên bố đã tồn tại. File chung do controller chỉnh tuần tự theo [ownership](acceptance-contract.md).

## Công việc cụ thể

| Task | Thực hiện | Điều kiện đạt |
|---|---|---|
| 14.1 | Giữ toàn bộ backend roadmap: contract freeze, NestJS/BetterAuth/Postgres/Redis worker, learning/AI/entitlements/compliance/migration/ops. | Không vẽ lại stack tùy ý; map R9/R10 và source metadata mới. R1 giữ Firebase qua pilot cho đến khi thanh toán hoặc chi phí đo được biện minh migration; owner xác nhận bằng chứng trigger và ngày bắt đầu backend. |
| 14.2 | Auth đầy đủ Google + email/password/signup/verify/reset/session expiry/reauth và return location theo source contract. | Thiết kế bổ sung các state Canvas chưa có trước implement, cùng tokens; no account merge/overwrite bất ngờ. |
| 14.3 | Uploads PDF/EPUB/images: select/type/size/plan check → progress/cancel/retry → processing/results → attach/import; My Files/storage usage/delete. | Board mới cần được thiết kế; MIME/quota/ownership/server validation thật; signed URL ngắn hạn; task không mất vì112 board chưa vẽ. |
| 14.4 | Generated REST/OpenAPI adapters, course-aware offline mirror/queue/change feed, auth loss/reconnect/conflict. | Swap Firebase→API không đổi screen behavior; staleowner/course không publish; every existing critical sync contract retains tests. |
| 14.5 | Migration backup/dry-run/reconcile/restore, cloud hosting/origin/extension Part B/cutover và rollback. | Không chạy DB change thiếu backup; owner go từng deploy; giữ legacy data và no dual-write mất kiểm soát. |
| 14.6 | UI locale wave2/3 và target languages es/de/fr/pt theo gates; global landing/legal/policy readiness. | Bản dịch có review; không chỉ bật metadata disabled thànhenabled để tuyên bố hỗ trợ. |

## Checklist

**Ranh giới auth local 2026-10-03.** Runtime Firebase hiện chỉ đăng nhập Google, còn [backend identity plan](../260923-1831-global-multilingual-launch/backend/phase-02-identity-auth-authz.md) giả định người dùng cũ không có password hash để migrate. Vì vậy có thể chuẩn bị state/form và contract auth bằng local tests, nhưng không tự mở Firebase email/password account creation trước R1/contract freeze hoặc quyết định owner sửa giả định migration. Account deletion hiện reauth bằng Google; trước khi mở tài khoản mật khẩu phải nối reauth đúng credential và giữ owner guard. 14.2 vẫn mở cho backend thật, verify/reset, browser/Canvas và gate phát hành.

Thiết kế chuẩn bị local (2026-10-01): bốn source Canvas Auth/Upload cho Classic và
Crystal cùng 106 comparison boards desktop/mobile đã được thêm và kiểm kê. Builder
compile 116 source/329 artboard; JavaScript của bốn source mới qua syntax check.
Review tĩnh độc lập đã kiểm các state, input/consent, mobile và quota. Lệnh render
reference đã được phép và thử ngày 2026-10-01 nhưng Playwright Chromium dừng trước
khi mở trang (`sandbox_host_linux.cc: Operation not permitted`); 331 PNG cũ hợp lệ,
114 PNG mới vẫn thiếu. Đối chiếu visual, backend contract và UI thật còn chờ nghiệm
thu, nên 14.2/14.3 chưa được đánh dấu hoàn tất.

Kiểm lại 2026-10-02: `build.py --check` compile 116 components; chỉ mục
`project/canvas.json` có 329 boards, `generate-tokens.mjs --check` đạt và thư
mục reference có 331 PNG. Đây là kiểm tra nguồn tĩnh; 114 ảnh phase 14 vẫn chưa
được render hay so trực quan vì Chromium bị sandbox chặn.

Kiểm lại 2026-10-03: Chromium cục bộ chạy được lệnh renderer đã duyệt;
`node docs/design/sonflash-redesign/canvas/render-reference.mjs --check` xác nhận
đủ **445/445 PNG**, gồm 114 ảnh phase 14 trước đó thiếu. Đây là bằng chứng render
và kiểm file; đối chiếu từng ảnh với UI thật, auth/upload backend và nghiệm thu
Canvas của phase vẫn mở.

Hợp đồng return location Firebase hiện tại có thêm hai test mount `AppRuntime`:
khôi phục nguyên URL chứa `?view=` và extension import sau đăng nhập mô phỏng,
và không phát lại intent khi owner A đổi sang B. Vitest tích hợp cùng Lesson
39/39 đạt; đây không phải kiểm thử Google/Firebase provider hay backend mới.

- [ ] 14.1 — Giữ toàn bộ backend roadmap: contract freeze, NestJS/BetterAuth/Postgres/Redis worker, learning/AI/entitlements/compliance/migration/ops.
  > **Phần local đã hoàn tất (2026-10-15):** Đã đồng bộ đầy đủ bảng ánh xạ Firestore → Postgres tại [`plans/260923-1831-global-multilingual-launch/backend/phase-07-firebase-migration-tooling.md`](../260923-1831-global-multilingual-launch/backend/phase-07-firebase-migration-tooling.md) theo đúng tên collection/field thực tế trong code (`profile/courses`, `japanesePitchAccent`, `masteredAt`, `source`, `coverPresets`, `profile/rewards`, `card_create_receipts`, `review_receipts`, `review_xp_awards`, `practice_sessions`, `reminderState`, `reminderReceipts`, `pushTokens`, `pushTokenSessionCutoffs`, `pushTokenOwners`, `mail`, `entitlements`, `payment_receipts`, `payment_settlements`, `catalog_progress`, `lexemes`/`track_memberships`/`catalog_revisions`). **Phần còn mở:** Quyết định chuyển khỏi Firebase (`R1` / `post-ui-launch-roadmap/phase-04`) và xây dựng monorepo backend self-hosted vẫn mở.
- [ ] 14.2 — Auth đầy đủ Google + email/password/signup/verify/reset/session expiry/reauth và return location theo source contract.
  > **Phần local đã hoàn tất (2026-10-15):** Luồng Google Sign-In hiện hữu, khôi phục return-location (`?view=`, `?lesson=`, extension import) kèm owner-switch guard (`src/app/AppRuntimeSignInReturn.test.tsx`), đăng xuất về landing xóa sạch dữ liệu phiên cũ (`e2e/account-signout-emulator.spec.ts` **1/1 PASS**), xuất JSON tài khoản không kèm thẻ có owner guard (`exportAccountData` bao phủ đủ 22 subcollections/collections người dùng; `e2e/landing-dialogs-visual.spec.ts` download test **PASS**), và xóa tài khoản fail-closed với `expectedUid` + `account_tombstones` 65 phút + notice trạng thái qua reload (`accountDataFirestore.integration.test.ts` **6/6 PASS** trên emulator). Bộ 114 ảnh tham chiếu Canvas cho Auth/Upload đã render đủ (`445/445 PNG`). **Phần còn mở:** Email/password signup/verify/reset và nối reauth đa phương thức chờ quyết định chuyển khỏi Firebase (`R1`).
- [ ] 14.3 — Uploads PDF/EPUB/images: select/type/size/plan check → progress/cancel/retry → processing/results → attach/import; My Files/storage usage/delete.
  > **Phần local đã hoàn tất (2026-10-15):** Bốn source Canvas (`UploadStates`, `AnimeUploadStates`, `AuthStates`, `AnimeAuthStates`) và 106 comparison boards đã compile và render đủ trong `445/445 PNG` (`render-reference.mjs --check`). **Phần còn mở:** Thực thi upload PDF/EPUB/ảnh qua Cloudflare R2, signed URL, malware scan, worker xử lý tài liệu và hạn mức lưu trữ theo gói chờ quyết định chuyển khỏi Firebase (`R1`).
- [ ] 14.4 — Generated REST/OpenAPI adapters, course-aware offline mirror/queue/change feed, auth loss/reconnect/conflict.
  > **Phần local đã hoàn tất (2026-10-15):** Trên runtime Firebase V2 hiện tại (sau đợt `260926-0917-firebase-cost-rebuild` bỏ `cardMirror.ts`/`pendingOperationStore.ts`), ứng dụng dùng truy vấn Firestore theo `language` của course đang active, các server-authority callables kèm operation receipts idempotent, dọn cache/phiên khi đổi owner hoặc xóa tài khoản, và kiểm tra đồng bộ hai thiết bị (`e2e/gamification-two-device-sync.spec.ts` **2/2 PASS**). **Phần còn mở:** Tầng `src/data/` ports, generated REST/OpenAPI adapters và course-aware offline mirror/queue cho kiến trúc API mới chờ quyết định chuyển khỏi Firebase (`R1`).
- [ ] 14.5 — Migration backup/dry-run/reconcile/restore, cloud hosting/origin/extension Part B/cutover và rollback.
  > **Phần local đã hoàn tất (2026-10-15):** Các công cụ migration/backfill trên Firebase (`legacyLibraryMigration`, `legacySharedDeckMigration`, `backfill-card-language`, `backfill-review-xp-awards` kèm tombstone race guard), script kiểm tra composite index (`scripts/verify-entitlement-index.mjs`) và allowlist Functions (`scripts/staging-functions-allowlist.test.mjs`) đã có mặt và đạt 100% unit/emulator integration tests (`npm run test:rules`: **95 Rules + 59 Functions integration PASS**). **Phần còn mở:** Exporter/transformer/importer/verifier sang Postgres và cutover hạ tầng chờ quyết định chuyển khỏi Firebase (`R1`).
- [ ] 14.6 — UI locale wave2/3 và target languages es/de/fr/pt theo gates; global landing/legal/policy readiness.
  > **Phần local đã hoàn tất (2026-10-15):** 12 catalog `en`/`vi` và pseudo-locale `en-XA` đạt `npm run i18n:check`; trang pháp lý song ngữ `public/terms.html` & `public/privacy.html`, `noindex` trên staging (`scripts/locale-pages.test.mjs` **7/7 PASS**), và kiểm tra danh mục ngôn ngữ trên landing (`e2e/landing-locales.spec.ts` **4/4 PASS**) cùng Wave 1 (`en`, `ko`, `ja`, `zh`) đã hoàn tất local. **Phần còn mở:** UI locale Wave 2/3 và mở các gói ngôn ngữ `es`/`de`/`fr`/`pt` chờ sau pilot và quyết định chuyển khỏi Firebase.
- [ ] Đối chiếu Canvas từng state của phase theo board/artboard inventory; reviewer kiểm tra cả hành vi và hình thức.
  > **Trạng thái local (2026-10-15):** Đã xác nhận `445/445` reference PNGs (`node docs/design/sonflash-redesign/canvas/render-reference.mjs --check`), nghiệm thu Chromium + Firebase Emulators cho các dialog Account/Plan/Report hiện hữu (`e2e/landing-dialogs-visual.spec.ts` **10/10 PASS**) và luồng đăng xuất (`e2e/account-signout-emulator.spec.ts` **1/1 PASS**). Đối chiếu UI thực tế của các màn email/password Auth và Uploads vẫn mở cho tới khi triển khai backend.
- [x] Chạy focused checks rồi gates cho toàn bộ phần local của phase; ghi revision, kết quả và ngoại lệ trong log (xem `decision-log.md` mục 2026-10-15).

## Verification

Theo source frontend13/14/17/19/20 và backend phase gates; contract integration, auth/security, file quota, offline migration and restore evidence; common visual/behavior acceptance.

## Account-deletion callable contract

`deleteMyAccount` accepts exactly `{ confirmation, expectedUid }`. The client must capture the owner before reauthentication and send that UID; the callable rejects missing or mismatched values before starting deletion. This fail-closed change requires every deployed client calling the callable to include `expectedUid`.

**Owner-switch race 2026-10-01.** Client kiểm lại owner sau popup và token refresh; server so `expectedUid` với auth UID trước khi bắt đầu xóa. Nếu owner đổi trong lúc callable chạy, client chỉ dọn key của owner cũ, không đăng xuất owner mới hoặc xóa session/cache chung. Test client 11/11 và callable 3/3 pass; toàn Functions unit 507 pass. Lệnh `npm run test:rules` sau contract mới chạy emulator thật: 95/95 Rules và 52/52 Functions Firestore integration pass, gồm account export/delete; emulator tự dừng. TypeScript/lint frontend và Functions, Functions build và review độc lập pass. Phải cập nhật mọi client đã phát hành trước khi triển khai callable fail-closed này; chưa deploy trong lượt local.

**Export owner guard 2026-10-01.** Export JSON chụp User/UID lúc bắt đầu và kiểm lại ngay sau callable, trước Blob/link/click; nếu đã đổi tài khoản, dữ liệu của A không tải xuống ở phiên B. Focused account service 12/12, frontend `src` + deploy gate 2360/2360, Rules 95/95 và Functions integration 54/54, lint/build/bundle và review độc lập pass. Server export vốn chỉ trả dữ liệu theo auth UID; patch này khóa thời điểm client dùng kết quả. Browser download thật đã được nghiệm thu trên Chromium + Firebase Emulators ngày 2026-10-15 (`e2e/landing-dialogs-visual.spec.ts`).

**Phạm vi tệp xuất 2026-10-01.** Nút JSON và trang quyền riêng tư nay nói rõ tệp này không chứa thẻ; nút Excel dành riêng cho thẻ theo hợp đồng pilot đã duyệt. Không đổi callable hay định dạng dữ liệu. Account UI 9/9, i18n 12 catalog, lint/build/bundle và diff check pass; browser download thật đã được nghiệm thu ngày 2026-10-15 (`e2e/landing-dialogs-visual.spec.ts`).

Hợp đồng chung: [acceptance-contract.md](acceptance-contract.md). Tên test mới là đề xuất; trước chạy phải kiểm inventory file thực, không báo file vắng là PASS. Với flow có mutation, test dùng emulator/fixtures, không dữ liệu người học hay Gemini thật.

## Rủi ro và rollback

Đây là scope có điều kiện, không phải việc bị bỏ. Ước lượng của roadmap cũ cần cập nhật khi backend contract chốt; không gộp vào lời hứa vài ngày sửa UI.

Rollback theo commit scope hoặc flag additive đã review; không delete/reset dữ liệu hay dirty work. Bước phụ thuộc sau chỉ nhận contract đã kiểm chứng. Không deploy trong công việc lập kế hoạch này.
