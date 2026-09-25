---
title: "Auth, upload, API/offline và các workflow phụ thuộc backend"
status: todo
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
| 14.1 | Giữ toàn bộ backend roadmap: contract freeze, NestJS/BetterAuth/Postgres/Redis worker, learning/AI/entitlements/compliance/migration/ops. | Không vẽ lại stack tùy ý; map R9/R10 và source metadata mới; owner quyết định migration timing. |
| 14.2 | Auth đầy đủ Google + email/password/signup/verify/reset/session expiry/reauth và return location theo source contract. | Thiết kế bổ sung các state Canvas chưa có trước implement, cùng tokens; no account merge/overwrite bất ngờ. |
| 14.3 | Uploads PDF/EPUB/images: select/type/size/plan check → progress/cancel/retry → processing/results → attach/import; My Files/storage usage/delete. | Board mới cần được thiết kế; MIME/quota/ownership/server validation thật; signed URL ngắn hạn; task không mất vì112 board chưa vẽ. |
| 14.4 | Generated REST/OpenAPI adapters, course-aware offline mirror/queue/change feed, auth loss/reconnect/conflict. | Swap Firebase→API không đổi screen behavior; staleowner/course không publish; every existing critical sync contract retains tests. |
| 14.5 | Migration backup/dry-run/reconcile/restore, cloud hosting/origin/extension Part B/cutover và rollback. | Không chạy DB change thiếu backup; owner go từng deploy; giữ legacy data và no dual-write mất kiểm soát. |
| 14.6 | UI locale wave2/3 và target languages es/de/fr/pt theo gates; global landing/legal/policy readiness. | Bản dịch có review; không chỉ bật metadata disabled thànhenabled để tuyên bố hỗ trợ. |

## Checklist

- [ ] 14.1 — Giữ toàn bộ backend roadmap: contract freeze, NestJS/BetterAuth/Postgres/Redis worker, learning/AI/entitlements/compliance/migration/ops.
- [ ] 14.2 — Auth đầy đủ Google + email/password/signup/verify/reset/session expiry/reauth và return location theo source contract.
- [ ] 14.3 — Uploads PDF/EPUB/images: select/type/size/plan check → progress/cancel/retry → processing/results → attach/import; My Files/storage usage/delete.
- [ ] 14.4 — Generated REST/OpenAPI adapters, course-aware offline mirror/queue/change feed, auth loss/reconnect/conflict.
- [ ] 14.5 — Migration backup/dry-run/reconcile/restore, cloud hosting/origin/extension Part B/cutover và rollback.
- [ ] 14.6 — UI locale wave2/3 và target languages es/de/fr/pt theo gates; global landing/legal/policy readiness.
- [ ] Đối chiếu Canvas từng state của phase theo board/artboard inventory; reviewer kiểm tra cả hành vi và hình thức.
- [ ] Chạy focused checks rồi gates; ghi revision, kết quả và ngoại lệ trong log.

## Verification

Theo source frontend13/14/17/19/20 và backend phase gates; contract integration, auth/security, file quota, offline migration and restore evidence; common visual/behavior acceptance.

Hợp đồng chung: [acceptance-contract.md](acceptance-contract.md). Tên test mới là đề xuất; trước chạy phải kiểm inventory file thực, không báo file vắng là PASS. Với flow có mutation, test dùng emulator/fixtures, không dữ liệu người học hay Gemini thật.

## Rủi ro và rollback

Đây là scope có điều kiện, không phải việc bị bỏ. Ước lượng của roadmap cũ cần cập nhật khi backend contract chốt; không gộp vào lời hứa vài ngày sửa UI.

Rollback theo commit scope hoặc flag additive đã review; không delete/reset dữ liệu hay dirty work. Bước phụ thuộc sau chỉ nhận contract đã kiểm chứng. Không deploy trong công việc lập kế hoạch này.
