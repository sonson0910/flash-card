# Decision log

## 2026-09-25 — Bắt đầu thực thi bằng đội Luna

- User yêu cầu dùng tối đa 10 agent GPT-6 Luna, reasoning max; controller giám sát và verify. Đã giao 8 lane độc lập cho phase 01. Runtime từ chối tạo agent thứ 9 với `agent thread limit reached`; luân chuyển agent đã xong khi cần, không đổi model để lấp chỗ.
- Giữ nguyên scope mọi màn/workflow Canvas. Chỉ demo chọn hướng không thành route. Không deploy hoặc thao tác dữ liệu cloud.
- Baseline HEAD: `8d1ec44e3af7e08e45b90454c887055a902ef7d2`, branch `feat/ui-redesign`. 244 dirty/untracked files ban đầu được ghi path/hash trong `evidence/implementation-start-ledger.json`; không reset hoặc stage toàn repo.
- Phase01 đang làm. Năm lane đọc nguồn Canvas theo partition có ownership; một lane dịch hai catalog vi; một lane lập ledger; một lane chạy baseline checks. Controller giữ extraction, tích hợp, review và quyền commit theo scope đã chốt.
- Kết quả check, ngoại lệ và commit sẽ được ghi sau khi có bằng chứng; chưa xác nhận phase 01 hoàn tất.

## 2026-09-25 — Kết quả nền và hợp đồng để mở lane tiếp theo

- 122/122 board/component đã có mapping, 449 action trỏ tới task tồn tại; 219 artboard vẫn nằm trong inventory. Hash 456 source/reference files không đổi. Ledger 244 path khớp snapshot đầu; source chỉ đổi 5 file giao diện và 9 catalog thuộc i18n đã giao.
- Sau sửa i18n: 77 focused tests đạt; controller chạy lại i18n check, TypeScript lint, build và bundle đều exit 0. Initial JS 70,088/71,000 byte gzip. Baseline core trước sửa ghi 1,950 đạt/7 lỗi; không gọi core đã đạt. Functions còn 1 lỗi validation; Rules 65/65 đạt; integration 37/38 với 1 timeout, retry hẹp 2/2 đạt và giữ nguyên timeout. Chi tiết trong báo cáo baseline.
- R9: `decisions.md` và roadmap phase 01 chốt optional pair cấp deck, giữ schema v2. Plan 0906 đang pending đề xuất per-card khác phạm vi. Không mở rộng wire per-card để thỏa fixture không thể đi qua parser; legacy/mixed thiếu metadata phải giữ unknown, metadata target được contract chấp nhận vẫn giữ. Validator phải thống nhất với hợp đồng language code, từ chối tên như `english`.
- Phase 02.4 yêu cầu giữ AI disclosure: `origin` chỉ có enum `ai/manual`; lane contract sẽ bảo toàn giá trị an toàn này, với validation/projection/fingerprint/migration và test tương ứng, không kèm dữ liệu riêng. UI lấy ngày tạo/hết hạn từ public metadata thật; không bịa hoặc lộ danh tính tác giả khi public contract chưa có.
- Friends giữ required task 15.5; course switcher thật giữ task 10. Shell 03 không đổi nhãn Progress thành Friends hoặc bịa cặp ngôn ngữ để giả đã tích hợp. Ngoại lệ mốc sớm phải ghi cụ thể; final 13 vẫn yêu cầu hoàn tất chúng.

## 2026-09-25 12:29 — Owner chốt hai quyết định

- Quota tính khi AI tạo xong; hủy preview vẫn tính, Save không tính thêm. Giữ receipt/operation hiện tại, không đổi thành reserve/refund theo Save.
- Cho phép code và test local phase 08–10 trước G1. Không deploy hoặc mở cho người dùng; G1 và migration vẫn là gate phát hành riêng.

## 2026-09-25 — Đóng phase 01

- Hoàn tất baseline, source/action mapping và fixture contract. Không xác nhận các màn đã giống Canvas: đây là bằng chứng chuẩn bị cho các phase triển khai.
- Ba finding review i18n đã sửa: giữ chip `Lv`, tên `Crystal Star` và signature `LUMI · LINK`; aria và placeholders đầy đủ. 77 focused tests, i18n check, lint, build, bundle và diff check đạt. Controller kiểm lại source ba điểm sửa; build cuối có initial JS 70,081/71,000 byte gzip.
- Các lỗi R9 đã được ghi rõ và giao phase 02; baseline core/Functions chưa đạt, không đổi nhãn thành PASS. Timeout integration đầu tiên được giữ trong log cùng lần retry hẹp đạt.
- Commit phase 01 chỉ gồm hồ sơ baseline, kế hoạch và reports được chỉ định. Các sửa i18n gắn với DOM từ patch UI cũ chưa commit sẽ đi cùng component ở phase 03/04/12; không stage toàn file để vô tình đưa các phần UI chưa nghiệm thu vào commit nền. Những sửa này đã có trong worktree và đã verify, không bị bỏ.
- Nguồn/reference Canvas không đổi; không deploy, đổi credentials hoặc ghi cloud. Phase 02 contract/UI và phase 03 navigation/feedback/appearance được mở song song với ownership riêng. Controller giữ runtime integration và global verification.
