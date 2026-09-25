# Hợp đồng nghiệm thu và cách chia việc

## Một task chỉ xong khi đạt cả bốn mặt

| Mặt | Bằng chứng bắt buộc |
|---|---|
| Bố cục | Board/state cụ thể + ảnh app cùng theme/viewport/content fixture; typography, geometry, asset, material, thứ tự và responsive đúng. |
| Hành vi | Trigger → trạng thái → thao tác → kết quả → nơi quay lại; có kiểm tra cancel, retry và failure liên quan. |
| Dữ liệu | Dữ liệu thật/adapter thật trong app; fixture chỉ ở test. Reload, offline, đổi account/course không mất hoặc lẫn dữ liệu. |
| Kiểm tra | Focused tests, gate bắt buộc, reviewer và log ghi đúng kết quả. Missing/skipped/timeout không phải PASS. |

“Giống Canvas” không có nghĩa chép cứng số liệu mẫu. Dùng fixture có nội dung tương đương để so hình. Production dùng dữ liệu thật và empty/error states được thiết kế cùng ngôn ngữ hình ảnh. Khác biệt do accessibility, policy hoặc nội dung phải ghi từng trường hợp với lý do và ảnh, không dùng ngoại lệ chung để thay toàn bộ bố cục.

## Ma trận visual

- Bốn tổ hợp từ tokens: classic dark Midnight Aurora, classic light Ink & Paper, crystal dark Starry Night, crystal light Prism Day. Cụm “six combinations” trong handoff cũ mâu thuẫn với bốn exports thực; không phát minh hai theme mới.
- Web: 1440×900 và 390×844 cho mọi screen/state chính; kiểm tra thêm 360px với pseudo-locale cho phần có text dài. Extension dùng đúng kích thước từng board popup/options/in-page và overflow thực tế.
- UI vi/en đầy đủ; en-XA dùng kiểm tra. Target-language content en/ko/ja/zh sau phase 09–10; UI locale độc lập với ngôn ngữ nghĩa và ngôn ngữ học.
- Trạng thái chung: signed out/in, empty, ready, loading, unavailable, offline, failure/retry, quota; trạng thái tương tác chi tiết nằm trong từng phase.
- Reduced motion và Lumi off không mất thao tác; keyboard, focus return, 44px touch, mobile safe area, axe serious/critical = 0.

## So hình có nguồn chuẩn

1. Giữ nguyên snapshot Canvas trong `docs/design/sonflash-redesign/canvas/reference/`; không sửa nguồn chuẩn để chạy theo app.
2. Chụp app cùng board/state/viewport; kiểm tra side-by-side hoặc overlay và ghi mismatch theo vùng: shell, hero, card, controls, feedback, overlay/mobile.
3. Ghi `board / state / app route / theme / viewport / fixture / image path / visual verdict / behavior test` trong evidence của phase. Không dùng một screenshot empty để nghiệm thu ready screen.
4. Chỉ sau khi so trực tiếp Canvas đạt mới chấp nhận/update baseline app. Snapshot app PASS chỉ chứng minh không đổi so với chính nó.
5. Reviewer kiểm tra các vùng sửa và toàn bộ đường đi của flow; nếu có ngoại lệ còn mở thì task chưa đạt visual hoặc behavior tương ứng.

## Gate lệnh sau mỗi phase code

Focused test của phase trước, sau đó `npm run i18n:check`, `npm run verify:core`, `npm run build`, `npm run verify:bundle`. Khi extension đổi: thêm `npm run extension:check`. Lệnh Playwright từng phase dùng artifact vừa build, không trộn dev và dist.

Giữ ngân sách trong `scripts/bundle-budget.mjs`; không nâng để qua test. Crystal CSS/font, packs và màn phụ phải lazy. `npm run i18n:check` hiện chạy extraction và có thể cập nhật `.po`; kiểm tra diff sinh ra, không gọi đây là read-only.

Khi Rules/Functions đổi, chạy đúng package Functions và emulator bằng các scripts hiện có; lệnh Vitest root liệt kê file Functions không đủ thay cho test Functions/emulator. Không gọi Gemini thật trong kiểm tra UI. Golden set cần quyền và gate riêng trước mở ngôn ngữ.

## Quyền sở hữu và parallel

| Lane | Phạm vi độc quyền | Điểm tích hợp |
|---|---|---|
| Controller | `src/app/**`, `useAppNavigation.ts`, `src/index.css`, config, shared types, catalogs chung, Rules/Functions sequencing, kế hoạch/log | Tích hợp tuần tự; chỉ một người sửa file chung. |
| Library/cards | `src/features/library/**`, `cardEdit/**`, `components/Flashcard.tsx`, `components/flashcard/**` | Trả callback/state contract cho lane learning trước khi viết song song. |
| Learning/practice | `dailyLearning/**`, `practice/**`, `components/study/**`, `components/stats/**`, `catalogWorkspace/**` | Không chia hai agent sửa recap hay study cùng lúc. |
| Extension | `extensions/lingoflash/**`, `src/features/browserExtension/**`, scripts extension | Wire schema/types do controller giữ; duyệt payload trước tích hợp. |
| Platform/languages | `src/data/**`, `languagePacks/**`, `courses/**`, `onboarding/**`, `settings/**` | Chạy sau shell; nhận types/read-write contracts đã chốt. |

Có thể giao landing/pilot dialogs riêng khi không chạm shared styles/catalogs. Mỗi delegate đọc phase, có file ownership, acceptance và báo checks thật. Không giao nhiệm vụ mơ hồ “làm đẹp màn X”.

## Commit, log và rollback

Sau mỗi đơn vị nghiệm thu (phase độc lập hoặc subphase07A/07B,11A/11B,12A/12B đã định nghĩa): một conventional commit theo quyền user đã cho, chỉ stage file thuộc phase; ghi decision log gồm revision, board/state coverage, tests, ngoại lệ và task còn lại. Không reset/clean/đè dirty work. Công việc hiện tại chỉ lập plan nên chưa commit code.

UI rollback theo commit tập trung; giữ domain/data fixes độc lập. Các hợp đồng Firebase mới additive, giữ card/share cũ đọc được. Trước migration/data change thật phải backup và có restore evidence. Flag rollback không được ẩn hoặc xóa course/card đã tạo.

Không deploy trong kế hoạch đang được chuẩn bị. Staging/production là bước phát hành riêng với quyền cụ thể; G1 không tự đạt vì local UI/tests đạt.
