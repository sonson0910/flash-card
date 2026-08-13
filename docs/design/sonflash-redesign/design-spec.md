# Design Spec · SonFlash Learning Experience Redesign

## Objective

Tái cấu trúc giao diện SonFlash để sản phẩm được cảm nhận như một learning companion cao cấp, rõ ràng và hiệu quả, thay vì một tập hợp dashboard/card có trọng số ngang nhau. Người dùng cần hiểu trong vài giây: hôm nay nên làm gì, hành động tiếp theo là gì, vì sao hành động đó hữu ích, và có thể đi đâu khi muốn quản lý vốn từ hoặc xem tiến độ. Redesign ở giai đoạn direction exploration không thay đổi domain behavior, dữ liệu, authentication, sync, FSRS hoặc lesson engine. Nó tìm ra một visual/information architecture đủ mạnh để sau khi được duyệt có thể áp dụng tăng dần vào React app.

## Assumptions

1. Đây là responsive web app/PWA, desktop và mobile đều là first-class; không phải native iOS prototype.
2. Audience chính là người Việt học tiếng Anh, muốn tiến bộ đều đặn trong các phiên ngắn.
3. “Đẳng cấp cao” được hiểu là có hierarchy, restraint, typography và interaction có chủ đích; không đồng nghĩa với nhiều blur, gradient hoặc animation.
4. Today là home và phải dẫn dắt learning loop. Paths, Vocabulary và Progress là ba không gian hỗ trợ.
5. Prototype dùng một “sample learning snapshot” có nhãn rõ ràng để biểu diễn state giàu nội dung; các con số không phải dữ liệu người dùng thật.
6. Logo và màu gốc trong repository là tài sản thương hiệu chính thức cho exploration này.

## Audience and context

Người dùng mở SonFlash trước hoặc sau giờ học, trong commute hoặc ở bàn làm việc. Trên mobile, khoảng cách mắt khoảng 30–40cm và phiên tương tác có thể chỉ vài phút; CTA phải chạm được bằng một tay và bottom navigation không che nội dung. Trên desktop, khoảng cách mắt khoảng 60–80cm; layout có thể dùng rail/secondary panel nhưng nhiệm vụ học vẫn phải nổi bật hơn utility. Người dùng mới cần một empty state có đường đi rõ đến “tạo từ đầu tiên” hoặc “chọn learning path”; người dùng quay lại cần tiếp tục daily session ngay lập tức.

## Core information and content blocks

- Global shell: official SonFlash mark/wordmark, Today, Paths, Vocabulary, Progress; trạng thái sync/account/theme được gom thành utility yên tĩnh.
- Daily focus: lời chào/ngữ cảnh ngắn, progress của phiên, primary CTA “Start daily session” hoặc “Continue review”.
- Plan composition: due review, weak/needs practice, first look/new; thể hiện như một hành trình hoặc một cụm có quan hệ, không phải ba metric card rời rạc.
- Continue learning: learning path hoặc bài đang dở.
- Quick capture: tạo smart card từ một từ mới; không lặp cùng action ở nhiều surface.
- Practice modes: secondary action, mở khi người dùng muốn đổi mode; không đặt sáu mode ngang cấp với CTA chính ở home.
- Progress: chỉ hiện insight có thể hành động; empty state phải dẫn về tạo card hoặc hoàn thành phiên đầu tiên.
- System status: online/offline/sync/error luôn truy cập được nhưng không dùng diện tích tương đương navigation chính.

## Emotional tone

Ba direction cùng phải truyền đạt: tập trung, tiến bộ, trí nhớ được xây dựng có phương pháp, và cảm giác sản phẩm riêng của SonFlash. Dải exploration đi từ immersive/daring đến action-first/friendly rồi calm/editorial. Không direction nào được biến thành generic AI SaaS dark mode. Cảm giác mong muốn: “mở ra là muốn bắt đầu học”, “ít phải suy nghĩ về công cụ”, “mỗi chi tiết có lý do”.

## Output format and dimensions

- Ba file HTML/CSS/JS độc lập trong `docs/design/sonflash-redesign/design-demos/`.
- Desktop comparison frame: 1440×900 CSS pixels.
- Mobile verification: 390×844 CSS pixels.
- Mỗi direction phải responsive, keyboard-focusable, có ít nhất navigation state và một CTA tương tác được.
- Mỗi file phải embed official logo bằng data URI để có thể double-click mở mà không vỡ ảnh.
- Screenshot desktop và mobile cho từng direction.

## Direction constraints

### Direction A · Recall Orbit

Anchor bắt buộc từ seconds roulette số 7: **Cosmic Retro-Futurism**. Dùng dark ink, cream, official cyan; orbit/trajectory là visual motif cho spaced repetition. Layout dùng left rail và main orbital learning path. Đây là direction novel nhất. Không dùng video; các orbital line chỉ là structural visualization bằng CSS/SVG.

### Direction B · Daily Momentum

Reality benchmark: **Duolingo Design System**, đã xác minh tại `https://design.duolingo.com/`. Mượn action-first hierarchy, visible path progress và tactile controls; không sao chép green/mascot/brand. Layout top bar + main quest + progress rail. Friendly nhưng không trẻ con, dùng SonFlash cyan và amber có kiểm soát.

### Direction C · Study Atelier

Best-fit design philosophy: **Khan Academy Wonder Blocks/humanist education design**, được xác minh qua Khan Academy Blog và Design Systems reference. Layout editorial, warm paper, serif display + clean sans controls, ít container hơn và navigation rail tĩnh. Đây là direction calm/premium, đặt sự tập trung và khả năng đọc lên trước gamification.

## Form derivation five questions

- **Narrative role:** Today là hero/decision screen; không phải report page.
- **Viewer distance:** 30–40cm mobile, 60–80cm desktop; body ≥14px, controls ≥44px.
- **Visual temperature:** A cinematic/curious, B energetic/encouraging, C calm/assured.
- **Capacity:** first viewport chỉ chứa một primary task, plan relationship, một continue item và utility tối thiểu; phần còn lại progressive disclosure.
- **Visual motif:** “memory returning on an interval” — orbit, stepping path hoặc annotated study sheet. Motif xuất phát trực tiếp từ spaced repetition, không phải trang trí tùy ý.

## Success criteria

- Trong 5 giây, người xem xác định được primary learning action mà không cần đọc toàn màn hình.
- Shell không có hơn hai cấp surface lồng nhau.
- Today, Paths, Vocabulary và Progress có cùng grammar thị giác, nhưng không bị ép thành cùng một card layout.
- Empty state luôn có một next step duy nhất và hữu ích.
- Sync/account/theme không cạnh tranh với CTA học tập.
- Desktop 1440×900 và mobile 390×844 không overflow ngang; nav label không vỡ; CTA và control đạt tối thiểu 44px.
- Screenshot không có page error/console error; axe không có lỗi accessibility nghiêm trọng ở prototype.

## Boundaries

- **Always:** giữ logo thật, semantic controls, readable contrast, reduced-motion fallback, responsive behavior.
- **Ask first:** thay đổi navigation taxonomy, bỏ feature, đổi brand cyan chính thức, thay đổi lesson behavior.
- **Never:** sửa Firebase/domain logic trong direction phase; thêm dependency; bịa product metrics; dùng purple neon gradient hoặc glass-card slop.

## Commands

- Dev app: `npm run dev`
- Build app: `npm run build`
- Type check: `npm run lint`
- Unit tests: `vitest run`
- Prototype screenshot: `npx playwright screenshot --viewport-size='1440,900' file:///ABSOLUTE/PATH.html output.png`

## Open decision

Người dùng cần chọn một direction hoặc chỉ định cách mix các direction sau khi xem screenshot. Chưa được triển khai vào `src/` trước quyết định đó.
