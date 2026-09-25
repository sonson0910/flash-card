---
title: "Hoàn tất shared-deck language contract R9"
status: completed
---

# 02. Hoàn tất shared-deck language contract R9

## Kết quả và phụ thuộc

01. Có thể độc lập với lane UI 03; bắt buộc cùng đợt UI theo R9.

Hoàn tất local ngày 25/09/2026. [Báo cáo nghiệm thu](../reports/verification-260925-1653-shared-deck.md) ghi tree, các lượt kiểm tra, đối chiếu Canvas và ngoại lệ cụ thể. Chưa deploy.

## Nguồn và file sở hữu

Nguồn: ../260925-0907-post-ui-launch-roadmap/phase-01-shared-deck-language-metadata.md; ../reports/worker-260925-1002-shared-deck-language-handoff.md.

Nguồn visual bắt buộc: `DlgShare`/`DlgShareIn` cho Classic và `AnimeDlgLibrary` với `kind=share|sharein` cho Crystal. `AnimeDlgManage` chỉ là nguồn phụ của hệ dialog, không thay nhánh share riêng. `kind=extract|insights` vẫn thuộc phase 04.

Đường dẫn dưới đây tương đối với `/mnt/Projects/startup/flash-card` cho đến khi phase migration đổi root theo source plan.

src/features/sharing/sharedDeckService.ts; sharedDeckSessionController.ts; functions/src/{inputValidation,sharedDeckPersistence,legacySharedDeckMigration}.ts; firestore.rules; tests cùng module; backend/phase-07-firebase-migration-tooling.md.

File `proposed` là file/module cần tạo, không phải tuyên bố đã tồn tại. File chung do controller chỉnh tuần tự theo [ownership](acceptance-contract.md).

## Công việc cụ thể

| Task | Thực hiện | Điều kiện đạt |
|---|---|---|
| 02.1 | Review patch đang dở thay vì bắt đầu lại; kiểm tra optional pair đầy đủ/hợp lệ, fingerprint và shape classifier. | Cả hai field đi cùng nhau; unexpected keys/invalid code bị reject; retry không sinh share khác không chủ ý. |
| 02.2 | Giữ targetLanguage/nativeLanguage trên payload, stored share và preview nhận; deck đồng nhất dùng cặp thật. | Deck mới đồng nhất hiện đúng pair; mixed và legacy không bị đoán là en/vi. |
| 02.3 | Đồng bộ Rules exact keys, migration classifiers và digest/fingerprint của share ở mọi vị trí. | Document mới đọc được; dry-run/migration nhận dạng hợp lệ; field injection bị chặn. |
| 02.4 | Giữ import/provenance, expiry, revoke, owner boundaries; restyle share dialogs theo DlgShare/DlgShareIn và AnimeDlgLibrary (share/sharein). | Sender → link → receiver → import/revoke hoạt động; không làm mất AI disclosure. |
| 02.5 | Cập nhật mapping migration và decision log sau test package đúng. | Có emulator round-trip và migration test; báo cáo pre-change 46/3 không bị coi là PASS sau patch. |

## Checklist

- [x] 02.1 — Review patch đang dở thay vì bắt đầu lại; kiểm tra optional pair đầy đủ/hợp lệ, fingerprint và shape classifier.
- [x] 02.2 — Giữ targetLanguage/nativeLanguage trên payload, stored share và preview nhận; deck đồng nhất dùng cặp thật.
- [x] 02.3 — Đồng bộ Rules exact keys, migration classifiers và digest/fingerprint của share ở mọi vị trí.
- [x] 02.4 — Giữ import/provenance, expiry, revoke, owner boundaries; restyle share dialogs theo DlgShare/DlgShareIn và AnimeDlgLibrary (share/sharein).
- [x] 02.5 — Cập nhật mapping migration và decision log sau test package đúng.
- [x] Đối chiếu Canvas từng state của phase theo board/artboard inventory; reviewer kiểm tra cả hành vi và hình thức.
- [x] Chạy focused checks rồi gates; ghi revision, kết quả và ngoại lệ trong log.

## Verification

Vitest src/features/sharing/*test.ts và firestoreRulesSource.test.ts; npm --prefix functions test -- inputValidation.test.ts sharedDeckPersistence.test.ts legacySharedDeckMigration.test.ts; npm run test:rules; gates chung.

Hợp đồng chung: [acceptance-contract.md](acceptance-contract.md). Tên test mới là đề xuất; trước chạy phải kiểm inventory file thực, không báo file vắng là PASS. Với flow có mutation, test dùng emulator/fixtures, không dữ liệu người học hay Gemini thật.

## Rủi ro và rollback

Không đổi dữ liệu cloud. Hợp đồng additive; Rules/Functions/web release order chỉ được thực thi khi có quyền deploy.

Rollback theo commit scope hoặc flag additive đã review; không delete/reset dữ liệu hay dirty work. Bước phụ thuộc sau chỉ nhận contract đã kiểm chứng. Không deploy trong công việc lập kế hoạch này.
