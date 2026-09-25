---
title: "Khóa nguồn chuẩn, kiểm kê và xử lý nền đang dở"
status: todo
---

# 01. Khóa nguồn chuẩn, kiểm kê và xử lý nền đang dở

## Kết quả và phụ thuộc

Không. Đây là phase đầu khi user chuyển từ plan sang triển khai.

Ước lượng: 0,5–1 ngày kỹ thuật. Đây là công sức kỹ thuật dự kiến, không phải hạn giao; bao gồm sửa và verify phần phase. Trạng thái hiện tại lấy từ audit, chưa task nào được đánh dấu đạt chỉ vì có patch.

## Nguồn và file sở hữu

Nguồn: scope-and-decisions.md; board-inventory.csv; artboard-inventory.csv; audit report; git diff hiện tại.

Đường dẫn dưới đây tương đối với `/mnt/Projects/startup/flash-card` cho đến khi phase migration đổi root theo source plan.

Plan/evidence; src/i18n/locales/{en,vi,en-XA}/{library,landing}.po; e2e/fixtures/** khi cần bổ sung fixture. Không reset source/UI đang dở.

File `proposed` là file/module cần tạo, không phải tuyên bố đã tồn tại. File chung do controller chỉnh tuần tự theo [ownership](acceptance-contract.md).

## Công việc cụ thể

| Task | Thực hiện | Điều kiện đạt |
|---|---|---|
| 01.1 | Lập ledger dirty files trước khi sửa; phân biệt patch UI, R9 và thay đổi khác của user. Đọc handoff worker R9. | Mọi file được giữ, có owner; không stage toàn repo. |
| 01.2 | Đọc từng board và mọi prop/state trong paired artboards; map vào entry/action sản phẩm. Dùng danh mục 112 source + 10 seed + 219 artboard của plan. | Không có dòng unmapped; chỉ sáu direction demo có lý do loại khỏi route. |
| 01.3 | Khóa reference Canvas và fixture so hình. Với các phần policy khác mẫu, lập ngoại lệ theo từng vùng; không đổi chuẩn theo app. | Fixture có card/data tương đương để so ready screen; có cả empty state riêng. |
| 01.4 | Hoàn thiện extraction đang dở: 16 chuỗi vi/library và một vi/landing còn thiếu tại audit; kiểm tra các pilot surface chưa extract. | i18n check ổn định, không blank translation; không chỉ dịch cho hết count nếu feature còn hardcode. |
| 01.5 | Chạy baseline source checks và ghi thất bại thật; lập danh sách regression trước sửa. | lint, core, build, bundle được ghi đúng revision/dirty state; không lấy PASS commit cũ cho worktree mới. |

## Checklist

- [x] 01.1 — Lập ledger dirty files trước khi sửa; phân biệt patch UI, R9 và thay đổi khác của user. Đọc handoff worker R9.
- [x] 01.2 — Đọc từng board và mọi prop/state trong paired artboards; map vào entry/action sản phẩm. Dùng danh mục 112 source + 10 seed + 219 artboard của plan.
- [x] 01.3 — Khóa reference Canvas và fixture so hình. Với các phần policy khác mẫu, lập ngoại lệ theo từng vùng; không đổi chuẩn theo app.
- [x] 01.4 — Hoàn thiện extraction đang dở: 16 chuỗi vi/library và một vi/landing còn thiếu tại audit; kiểm tra các pilot surface chưa extract.
- [x] 01.5 — Chạy baseline source checks và ghi thất bại thật; lập danh sách regression trước sửa.
- [x] Đối chiếu Canvas từng state của phase theo board/artboard inventory; reviewer kiểm tra cả hành vi và hình thức.
- [x] Chạy focused checks rồi gates; ghi revision, kết quả và ngoại lệ trong log.

## Verification

npm run i18n:check; npm run verify:core; npm run build; npm run verify:bundle; python3 docs/design/sonflash-redesign/canvas/build.py --check.

Hợp đồng chung: [acceptance-contract.md](acceptance-contract.md). Tên test mới là đề xuất; trước chạy phải kiểm inventory file thực, không báo file vắng là PASS. Với flow có mutation, test dùng emulator/fixtures, không dữ liệu người học hay Gemini thật.

## Rủi ro và rollback

Check i18n có mutation extraction. Không xóa thay đổi sẵn có; review diff từng catalog. Baseline lỗi không được che bằng cập nhật snapshot.

Rollback theo commit scope hoặc flag additive đã review; không delete/reset dữ liệu hay dirty work. Bước phụ thuộc sau chỉ nhận contract đã kiểm chứng. Không deploy trong công việc lập kế hoạch này.

## Bằng chứng thực thi ngày 25/09

Các task chuẩn bị của phase này đã hoàn tất. Xem [decision log](decision-log.md), [baseline report](../reports/tester-260925-1147-baseline-verification.md), [i18n repair](../reports/worker-260925-1147-catalog-translations.md), và [independent review](../reports/reviewer-260925-1147-i18n-repair.md). Các lỗi R9 còn lại thuộc phase 02; chưa có xác nhận toàn bộ core hoặc UI đạt.
