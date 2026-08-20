# SonFlash · Product Facts

> Xác minh ngày: 2026-08-12  
> Nguồn chính: codebase hiện tại, `README.md`, `package.json`, metadata trong `index.html`, và bản chạy local tại `http://127.0.0.1:3001`. Tìm kiếm công khai theo tên sản phẩm chưa trả về một trang sản phẩm có thể xác nhận độc lập, vì vậy repository của người dùng được coi là nguồn sự thật cho dự án này.

## Sản phẩm là gì

SonFlash là ứng dụng web học từ vựng English–Vietnamese bằng flashcard. Sản phẩm kết hợp active recall, spaced repetition/FSRS, bài học hằng ngày, nhiều chế độ luyện tập, thư viện từ cá nhân, learning paths, theo dõi tiến độ, cache offline đa tab và đồng bộ bằng tài khoản Google/Firebase.

## Trạng thái và công nghệ đã xác nhận

- Tên sản phẩm hiển thị: **SonFlash**.
- Metadata sản phẩm: “Smart Vocabulary Learning”.
- Runtime: React 19, TypeScript, Vite 6, Tailwind CSS 4.
- Dữ liệu và identity: Firebase/Firestore, Google sign-in, App Check.
- Tạo nội dung: Gemini; ảnh liên quan từ các nguồn được policy cho phép.
- Lập lịch ôn: `ts-fsrs` và domain scheduler nội bộ.
- Trải nghiệm chính: Today, Paths, Vocabulary, Progress; lesson/practice view được mở từ các màn hình này.
- Trạng thái offline và đồng bộ là yêu cầu sản phẩm, không phải chi tiết phụ có thể loại bỏ trong redesign.
- Accessibility và touch target đã có test; redesign phải giữ semantics, keyboard focus và vùng chạm tối thiểu 44px.

## Giá trị cần được biểu đạt bằng giao diện

SonFlash không chỉ là nơi lưu flashcard. Giá trị khác biệt là biến một từ mới thành một learning moment có ngữ cảnh, rồi đưa nó trở lại đúng lúc để người dùng nhớ lâu. Vì vậy giao diện mới phải ưu tiên vòng lặp **Capture → Learn → Recall → Master**, thay vì trình bày bốn khu vực sản phẩm như các destination ngang nhau.

## Điều không được giả định

- Không có số liệu thật về retention, số người dùng, tỷ lệ hoàn thành hoặc thời gian học mỗi ngày.
- Không có brand guideline ngoài tài sản và token đang nằm trong repository.
- Không có persona được xác nhận ngoài ngữ cảnh học English–Vietnamese.
- Mọi số liệu xuất hiện trong prototype phải được ghi rõ là preview/sample, không được trình bày như dữ liệu người dùng thật.
