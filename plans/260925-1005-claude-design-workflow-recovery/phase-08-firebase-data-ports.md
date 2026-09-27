---
title: "Ports và hợp đồng dữ liệu Firebase cho đa ngôn ngữ"
status: in_progress
---

# 08. Ports và hợp đồng dữ liệu Firebase cho đa ngôn ngữ

## Kết quả và phụ thuộc

02. Owner đã cho phép code và test local lane 08–10 trước G1 ngày 25/09/2026. Quyền này không bao gồm deploy, mở wave 1 cho người dùng hay xác nhận G1 đã đạt. Giữ các gate phát hành và migration riêng.

Ước lượng: 6–8 ngày. Đây là công sức kỹ thuật dự kiến, không phải hạn giao; bao gồm sửa và verify phần phase. Trạng thái hiện tại lấy từ audit, chưa task nào được đánh dấu đạt chỉ vì có patch.

## Nguồn và file sở hữu

Nguồn: Frontend 04; roadmap phase 03/03b; backend contract và migration mapping.

Đường dẫn dưới đây tương đối với `/mnt/Projects/startup/flash-card` cho đến khi phase migration đổi root theo source plan.

proposed src/data/**; src/app/appDependencies.ts; src/lib/{cardRepository,cardNormalization,cardQuery}.ts; src/types/card.ts; librarySession/sync/intake consumers; firestore.rules + tests; Functions validation; courses profile adapter.

File `proposed` là file/module cần tạo, không phải tuyên bố đã tồn tại. File chung do controller chỉnh tuần tự theo [ownership](acceptance-contract.md).

## Công việc cụ thể

| Task | Thực hiện | Điều kiện đạt |
|---|---|---|
| 08.1 | Bọc data access bằng ports hiện hữu/mở rộng; Firebase adapters giữ query/paging/conflict behavior. | Consumers không truyền raw db xuyên UI; contract tests chứng minh không đổi behavior EN/VI. |
| 08.2 | Card language/translationLanguage độc lập lexeme identity theo R10; cập nhật validator, Rules allowlist, normalizer, storage/mirror/export/import. Shared-deck adoption chuyển pair cấp deck đã xác thực vào card qua intake; reload và re-share giữ pair. | Card legacy đọc như en/vi, card ko/vi plain round-trip; partial lexeme identity vẫn reject; backup restore và nhận rồi chia sẻ lại giữ pair. |
| 08.3 | Bounded owner-only users/{uid}/profile/courses, một course mỗi target, Goals/preferences/active course theo DTO thống nhất. | Exact keys, valid languages, duplicate/archived policy test; signed-out local fallback rõ; không ghi cloud trong phase planning. |
| 08.4 | Course filter phải áp dụng trước paging/count/practice loading, không lọc mỗi page cuối UI; owner+course generation guard và pending ops. | Rapid switching không lẫn card/count/result; offline queued op giữ course lúc tạo, không chuyển theo active course mới. |
| 08.5 | Đồng bộ backend migration mappings cho language fields, course/goals/profile, source metadata phase07. | Sau này migrate không mất trường; migration chưa được chạy. |
| 08.6 | Chốt cách tính course progress/XP từ review evidence, tránh tách/relabel tổng account thành số course giả. | Legacy XP còn nguyên; dữ liệu không đủ phân bổ được đánh dấu rõ và không nhân bản cho mọi course. |

## Checklist

- [ ] 08.1 — Bọc data access bằng ports hiện hữu/mở rộng; Firebase adapters giữ query/paging/conflict behavior.
- [ ] 08.2 — Card language/translationLanguage độc lập lexeme identity theo R10; cập nhật validator, Rules allowlist, normalizer, storage/mirror/export/import.
- [ ] 08.3 — Bounded owner-only users/{uid}/profile/courses, một course mỗi target, Goals/preferences/active course theo DTO thống nhất.
- [ ] 08.4 — Course filter phải áp dụng trước paging/count/practice loading, không lọc mỗi page cuối UI; owner+course generation guard và pending ops.
- [ ] 08.5 — Đồng bộ backend migration mappings cho language fields, course/goals/profile, source metadata phase07.
- [ ] 08.6 — Chốt cách tính course progress/XP từ review evidence, tránh tách/relabel tổng account thành số course giả.
- [ ] 08.7 — Hợp đồng mutation cho edit sheet: đổi headword (giữ lexeme identity), sửa part-of-speech, tags, difficulty/scheduling, thay/xoá ảnh của thẻ đã có. Đến khi có hợp đồng, EditCardDialog giữ ghi chú `data-edit-contract-note`, không render control trơ. (Tách từ 04.7, 2026-09-27.)
- [ ] Đối chiếu Canvas từng state của phase theo board/artboard inventory; reviewer kiểm tra cả hành vi và hình thức.
- [ ] Chạy focused checks rồi gates; ghi revision, kết quả và ngoại lệ trong log.

## Verification

Quyết định dữ liệu ngày 25/09: owner chọn chỉ mục course riêng, không sửa thẻ legacy. Chuẩn bị và test local bootstrap theo batch có checkpoint, generation hoàn tất, mirror create/update/review/delete/restore/clear và replay; chỉ mở query khi generation hoàn tất. Không chạy bootstrap/cloud mutation trong công việc này. [Phân tích query](../reports/architect-260925-1520-course-query-contract.md) giải thích vì sao query trực tiếp không thể chọn chính xác thẻ thiếu trường language.

Port contract tests; normalization/query/ownerRace tests; Functions package tests; npm run test:rules; legacy/new card+course emulator round trips; gates chung.

Hợp đồng chung: [acceptance-contract.md](acceptance-contract.md). Tên test mới là đề xuất; trước chạy phải kiểm inventory file thực, không báo file vắng là PASS. Với flow có mutation, test dùng emulator/fixtures, không dữ liệu người học hay Gemini thật.

## Rủi ro và rollback

Shared contract changes serial owner; không backfill/cloud migrate tự động. Snapshot/backup bắt buộc trước data mutation thật; flags không được làm dữ liệu course mới biến mất.

Rollback theo commit scope hoặc flag additive đã review; không delete/reset dữ liệu hay dirty work. Bước phụ thuộc sau chỉ nhận contract đã kiểm chứng. Không deploy trong công việc lập kế hoạch này.
