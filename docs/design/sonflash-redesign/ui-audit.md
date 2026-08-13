# SonFlash · UI/UX Audit

## Kết luận

Nền tảng sản phẩm và accessibility tốt hơn phần trình bày hiện tại. Vấn đề lớn nhất là **visual hierarchy không phản ánh learning hierarchy**: shell, sync, theme, metric, empty-state card và primary learning action thường dùng cùng một ngôn ngữ surface/border, nên người dùng phải tự suy ra điều gì quan trọng. Redesign nên giữ domain model và thay đổi trước ở shell + Today, sau đó lan grammar sang Paths, Vocabulary và Progress.

## Findings

### ⚠️ Quan trọng · Header có quá nhiều lớp chrome cạnh tranh nội dung

`DesktopNavigation` dùng outer `liquid-glass`, logo pill, navigation pill, sync button, utility group và card-count group trong cùng một hàng (`src/components/shell/DesktopNavigation.tsx:62`). CSS tiếp tục thêm pseudo highlight, blur, shadow và nested border cho cả `liquid-glass` lẫn `liquid-control` (`src/index.css:181`, `src/index.css:218`). Kết quả là header trở thành object giàu chi tiết nhất màn hình. Cần chuyển về một shell phẳng hơn, một active-state rõ, utility gom vào account/status control.

### ⚠️ Quan trọng · Trạng thái trống tạo dead space nhưng chưa hướng dẫn onboarding đủ tốt

Today empty state chỉ có heading, một card và CTA “Open Vocabulary” (`src/features/dailyLearning/TodayScreen.tsx:75`). Ở viewport desktop phần lớn diện tích còn lại trống; người dùng chưa hiểu tại sao tạo vocabulary sẽ tạo daily plan, hoặc có thể chọn Paths. Empty state nên giải thích learning loop trong một câu, đưa một primary action duy nhất và một secondary link có ngữ cảnh.

### ⚠️ Quan trọng · Progress empty state là ngõ cụt

`ProgressScreen` hiển thị ba metric 0 rồi thêm “Complete a review…” nhưng không có hành động để bắt đầu review hoặc tạo card (`src/features/dailyLearning/ProgressScreen.tsx:14-15`). Đây là một dead end có thể đoán trước. Empty state phải dẫn về prerequisite phù hợp; khi có data, metric nên chuyển thành insight/action thay vì ba count ngang cấp.

### ⚡ Cần sửa · Vocabulary và Today dùng mật độ/hierarchy khác nhau quá mạnh

Vocabulary có hero, metrics, form tạo card, onboarding explanation và content dock; Today/Progress lại tối giản đến mức trống. Sự khác biệt này khiến app giống nhiều mini-product ghép lại. Không cần làm mọi màn hình giống hệt, nhưng cần chung shell, heading scale, CTA tiers, surface rules và spacing rhythm.

### ⚡ Cần sửa · Action quản trị thư viện được đặt quá cao

Export và Clear Library nằm trực tiếp trong header ở desktop (`src/components/shell/DesktopNavigation.tsx:136-149`). Đây là tác vụ hiếm, trong đó Clear là destructive. Nên chuyển vào menu của Vocabulary/settings, giữ header cho learning navigation, account và trạng thái sync.

### ⚡ Cần sửa · Focus management đúng semantics nhưng tạo visual artifact lúc tải

Today và Progress chủ động focus heading (`src/features/dailyLearning/TodayScreen.tsx:49-69`, `src/features/dailyLearning/ProgressScreen.tsx:5-8`) trong khi global `[tabindex]:focus-visible` dùng outline cyan rõ (`src/index.css:89-97`). Ảnh chụp hiện trạng cho thấy outline bao toàn heading như hero border. Cần giữ focus management nhưng dùng focus treatment phù hợp cho programmatic page heading, hoặc chỉ hiện outline khi tương tác keyboard được xác định đáng tin cậy.

### 💡 Tối ưu · Dark theme đang gần “generic cyan SaaS”

Palette gốc hợp logo, nhưng canvas dark + cyan radial ambient + glass surface xuất hiện rộng (`src/index.css:101-165`). Đây là tổ hợp dễ làm brand bị chìm trong visual convention quen thuộc. Nên dùng cyan ít hơn, chuyển phần lớn canvas về neutral có temperature rõ, và để motif học/spaced repetition tạo nhận diện.

## Keep

- Navigation taxonomy Today / Paths / Vocabulary / Progress hợp với domain hiện tại.
- Touch target guard 45px và focus-visible foundation là nền tốt.
- Token màu đã tập trung trong `src/index.css`, thuận lợi cho redesign theo direction.
- Screen/domain orchestration đã tách khỏi nhiều component view; có thể redesign view layer mà không cần đổi scheduler/sync.
- Mobile bottom navigation rõ và dễ nhận diện; cần giảm độ dày chứ không cần thay mô hình.

## Quick wins sau khi chọn direction

1. Làm phẳng desktop header và gom utility hiếm vào menu.
2. Thiết kế lại Today zero-state thành một onboarding decision screen có một CTA chính.
3. Thêm next action cho Progress empty state và giảm ba metric 0 lặp lại.
