# Phạm vi và nguồn quyết định

## Thứ tự thẩm quyền

1. Chỉ đạo user ngày 25/09 trong phiên hiện tại: phải giống Claude Design, không sót màn, có cả workflow mới; mọi màn gen để tích hợp trừ demo lựa chọn. Yêu cầu hiện tại là audit và plan, không triển khai thêm.
2. Các quyết định cụ thể đã chốt trong [decisions.md](../260923-1831-global-multilingual-launch/decisions.md), gồm R1–R10, cùng quyết định trong hội thoại hiện tại. Dùng chúng để điều chỉnh dữ liệu/điều kiện mở tính năng, không để xóa các màn khỏi master plan.
3. Canvas source + seed + các trạng thái được generator khai báo. Đây là chuẩn bố cục và tương tác; dữ liệu mẫu không phải quyền bịa số liệu người học.
4. [Handoff UI](../reports/handoff-260924-1610-codex-ui-redesign.md), [handoff roadmap](../reports/handoff-260925-0920-codex-post-ui-roadmap.md), source frontend/backend phases. Phạm vi pilot hẹp trong handoff cũ không còn được dùng để giới hạn master plan này.
5. Các `design-spec.md` / `implementation-spec.md` cũ mô tả direction exploration/Focussed Momentum. Không dùng câu “không đổi behavior” trong các bản cũ để phủ định workflow Canvas đã được user yêu cầu sau đó.

## Trao đổi Claude gốc đã kiểm tra

Nguồn riêng trên máy: session `5e520499-5fed-45db-bd78-9a938ff7db56`, project `-mnt-Projects-startup-flash-card`. Chỉ lưu mốc và nội dung quyết định, không sao chép toàn bộ transcript hay dữ liệu riêng.

| Thời điểm UTC / dòng JSONL | Nội dung có ảnh hưởng phạm vi |
|---|---|
| 23/09 05:57, 378 | User yêu cầu thiết kế lại toàn bộ, **cả extension**. |
| 23/09 06:34, 1302 | Chọn hướng 1 cho dark và hướng 2 cho light. Aurora/Atelier là hướng đã chọn, không được bỏ chỉ vì tên có chữ Direction. |
| 23/09 07:09, 2163 | Bao gồm các trang và popup, đủ cả app. |
| 23/09 07:36–07:38, 2716–2772 | Claude đề xuất thống nhất phiên học, web words, onboarding aha, nhắc học, weekly recap, inline/sheet, AI tiến trình và các vòng thương mại; user yêu cầu xử lý các phần trên. |
| 23/09 10:55, 5847 | Người Việt học Hàn; chuyển giữa các ngôn ngữ; cặp khác như Anh–Pháp/Đức. |
| 23/09 10:56, 5880 | Vẽ hoàn chỉnh Canvas đa ngôn ngữ trước. |
| 23/09 11:17, 6133 | Bỏ từ ngữ game/MOBA, dùng từ học tập dễ thương. |
| 23/09 11:54, 6916 | Goals như IELTS/TOEIC/du học/giao tiếp; gói/quota và gamification phải được đánh giá, không tự chốt. |
| 24/09 02:31, 8457 | Settings đổi qua lại đủ ba theme. |
| 25/09 02:20, 10110 | Shared deck ra cùng UI; mở wave 1 trên Firebase trước migration; Claude lập plan để Codex thực thi. |

## Không bỏ toàn bộ board vì một phần chưa được mở

| Nhóm | Tích hợp phải có | Điều kiện mở/điều chỉnh |
|---|---|---|
| Today/Bridge/Recap | Phiên bốn chặng, trạng thái chuyển, bước học kế tiếp | XP thật, không chép +160/bonus từ mẫu; league/bonus do phase 15 quyết định. |
| Onboarding | Native/target, Goals, level/script, pace, trải nghiệm thẻ đầu tiên, tùy chọn reminder | Gộp các board thành một journey có nhánh; bỏ thử Pro tự động khi chưa được phép. |
| Weekly recap | Báo cáo, chọn thông tin hiện, caption, tải ảnh/chia sẻ có chủ động | Chưa có referral reward thì không hứa thưởng; không bịa study time/recall. |
| Streak | Thông tin streak, mốc/động viên, trạng thái tiếp tục/mất streak | Repair/freeze và mua vật phẩm có task phase 15; chưa mở trong pilot. |
| Pricing/Paywall/Checkout/Pro | Màn và luồng đầy đủ, nối entitlement thật theo hợp đồng cuối | R5/R6/R8 vẫn quyết định giá/quota. Thanh toán chờ doanh nghiệp/gateway; pilot chỉ purchase intent. |
| Referral/League | Màn, empty/loading/error, luồng mời/xếp hạng theo policy | Chưa có quyết định 8 thì chưa bật reward/league cho pilot. |
| Tutor/AI streaming | Flow thật, định nghĩa request, output, quota, lỗi/cancel/save | R7 có allowance cho AI ngoài tạo thẻ; không được tự đánh dấu Tutor bị cấm. Không giả streaming bằng timer. |
| Landing/Sales/LangLanding | Tích hợp sections, demo và journey chuyển đổi theo Canvas | `sonflash.app` đã chốt. Chỉ claim các tính năng đã mở; review/testimonials phải có nguồn. |

## Demo và biến thể

Sáu HTML trong `docs/design/sonflash-redesign/design-demos/direction-{a,b,c}-*.html` là exploration để chọn hướng. Chúng không tạo sáu route sản phẩm. Các file seed Aurora/Atelier, FlashFront/Back, CardStates, Review, Library/Today là evidence cần map vào component hiện tại. Paired boards là cách so sánh theme, không phải “demo nên bỏ”; mọi state/prop trong chúng vẫn cần coverage.

Hai tên board cho cùng chức năng được gộp vào một runtime route/component có biến thể, không tạo nhiều màn trùng nhau. Ví dụ LandingScreen + LandingSales + LangLanding là các yêu cầu của một landing; Onboarding + LangOnboarding là một flow với các nhánh.

## Phụ thuộc và điểm chưa thể tự chốt

| Điểm | Bằng chứng / đề xuất trong plan | Chặn gì |
|---|---|---|
| G1 và frontend mở rộng | Owner chốt 25/09: cho phép code/test local 08–10 trước G1, giải quyết mâu thuẫn giữa roadmap và handoff. | G1 vẫn chặn phát hành tương ứng; không có quyền deploy trong công việc này. |
| Quota, giá, VAT, feature entitlements | R5–R8 là giá trị đã chốt; decision 8 còn mở. | Live checkout, paywall, rewards, streak purchase, league. |
| Reminder delivery | Canvas có browser push, email digest, extension badge; repo chưa có hợp đồng reminder. Phase 11 phải thiết kế/kiểm chứng kênh, timezone, opt-in và hủy. | Delivery thật khi app đóng; không được chỉ lưu toggle rồi gọi xong. |
| Streaming/tutor | UI có design, backend hiện trả kết quả một lần và chưa có tutor chat contract hoàn chỉnh. | Streaming/chấm/tutor live; phase 11 có task contract trước code. |
| Progress dự báo band/coverage, combo thưởng | Canvas có số mẫu; chưa có model/data và chưa chốt quy tắc thưởng. | Claim band/coverage hoặc cộng XP bonus; giữ task phân tích và nghiệm thu mô hình. |
| Migration/auth/upload | Gate migration trong roadmap 04; auth và upload có source phases nhưng thiếu board chi tiết. | Hạ tầng live. Phải thiết kế bổ sung cùng hệ Canvas trước khi implement các màn thiếu. |

Không cần hỏi lại quyền làm landing, domain hay phạm vi “mọi màn”: user đã chốt. Khi tới gate kinh doanh/hạ tầng, trình phương án cụ thể và phần đã chuẩn bị để owner quyết định.

## Làm rõ quota preview ngày 25/09

Owner chọn giữ cách tính hiện tại: quota card tăng khi AI tạo xong. Hủy preview vẫn tính; Save không tính thêm. Regenerate có chủ ý là lần tạo mới; retry cùng operationId giữ semantics idempotent đã chốt. Không thêm cơ chế refund/reserve theo Save. UI giải thích thời điểm dùng quota trước thao tác tạo.
