# SonFlash · Brand Spec

> Thu thập ngày: 2026-08-12
> Nguồn: tài sản chính thức trong repository và giao diện chạy local
> Mức đầy đủ: đủ cho exploration; chưa có VI/brand guideline chính thức

## Tài sản cốt lõi

### Logo

- Mark vector chính: `public/favicon.svg` — nền cyan bo góc, chữ **L** trắng.
- Mark PNG nền trong: `public/brand/sonflash-logo.png` — 1254×1254.
- Mark PNG cho app icon: `public/brand/sonflash-logo-320.png` — 320×320.
- Source: `public/brand/sonflash-logo-source.png` — 1254×1254.
- Cách dùng: luôn lấy file thật hoặc data URI được encode trực tiếp từ file thật; không vẽ lại glyph bằng CSS/SVG mới.
- Không kéo giãn, đổi hình chữ L, thêm glow hoặc đổi cyan thành màu không nằm trong palette của một direction đã được duyệt.
- Wordmark hiện tại là pattern chữ “SonFlash” đi cùng official mark trong shell. Repository chưa có wordmark vector riêng; prototype được phép giữ typography wordmark như giao diện hiện tại nhưng mark phải là asset thật.

### UI screenshots

- Today desktop hiện trạng: `docs/design/sonflash-redesign/current/current-desktop.png`.
- Today mobile hiện trạng: `docs/design/sonflash-redesign/current/current-mobile.png`.
- Paths: `docs/design/sonflash-redesign/current/current-paths.png`.
- Vocabulary: `docs/design/sonflash-redesign/current/current-vocabulary.png`.
- Progress: `docs/design/sonflash-redesign/current/current-progress.png`.
- Đây là ảnh chụp từ code hiện tại, không phải mockup marketing.

## Palette hiện tại

Nguồn trực tiếp: CSS variables trong `src/index.css`.

- Brand cyan: `#0891B2`.
- Brand hover/deep cyan: `#0E7490`.
- Dark canvas/ink: `#071014`.
- Light canvas: `#F6F8F8`.
- Light surface: `#FFFFFF`.
- Dark surface: `#102229`.
- Reward amber: `#FBBF24`.
- Success: `#047857` light / `#34D399` dark.
- Danger: `#BE123C` light / `#FB7185` dark.

Mỗi direction được phép thay đổi neutral temperature và mức chroma nhưng phải giữ cyan của official mark là điểm nhận diện. Không dùng purple gradient kiểu SaaS mặc định.

## Typography hiện tại

- Body/display: `Geist Variable`, sau đó `Geist`, `SF Pro Display`, `Segoe UI`, sans-serif.
- Prototype có thể thử serif display ở direction editorial, nhưng body và control vẫn phải ưu tiên readability và hỗ trợ đầy đủ tiếng Việt/tiếng Anh.

## Chữ ký cần giữ hoặc phát triển

- Mark chữ L trên nền cyan.
- Cyan là màu hành động/nhận diện, không phủ khắp mọi surface.
- Cảm giác thông minh, nhanh, đáng tin cậy; không trẻ con hóa quá mức.
- Offline/sync là năng lực quan trọng nhưng chuyển thành trạng thái yên tĩnh, không tranh CTA học tập.

## Cấm kỵ

- Glass card lồng nhiều lớp chỉ để trang trí.
- Mọi block đều có border + roundness giống nhau.
- Cyan glow khắp nền tối.
- Emoji làm icon điều hướng.
- Số liệu giả không có nhãn preview.
- Hình minh họa SVG/CSS giả làm “sản phẩm”.
