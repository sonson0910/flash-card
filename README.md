# SonFlash

Ứng dụng flashcard English–Vietnamese có phân trang Firestore, cache offline đa tab,
spaced repetition và tạo nội dung bằng Gemini. Bản production gọi Gemini/Pexels qua
Firebase callable functions; khóa nhà cung cấp không được đưa vào bundle trình duyệt.

## Chạy local

Yêu cầu Node.js 22 và npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Điền `GEMINI_API_KEY` và, nếu cần, `VITE_PEXELS_API_KEY`/`VITE_UNSPLASH_API_KEY`
trong `.env.local`. Các biến `VITE_*` chỉ được dùng bởi dev server; production không
đọc khóa Pexels/Unsplash từ trình duyệt.

App Check dùng reCAPTCHA Enterprise. Sau khi đăng ký web app và production domain
trong Firebase Console, điền public site key vào `VITE_FIREBASE_APP_CHECK_SITE_KEY`.
Khi chạy local, chỉ bật `VITE_FIREBASE_APP_CHECK_DEBUG=true` và safelist debug token
hiển thị trong console trình duyệt; không commit token này.

Mở [http://localhost:3000](http://localhost:3000). Dữ liệu dev có thêm kho chung trên
máy tại `~/.lingoflash-device-sync/lingoflash-2-cards.json`; production dùng Firestore
persistent cache và tài khoản Google để đồng bộ trình duyệt/thiết bị. Mọi trình duyệt
phải đăng nhập cùng một tài khoản Google; cache của tài khoản này không được hiển thị
cho tài khoản khác hoặc phiên chưa đăng nhập.

## Kiểm tra trước khi phát hành

```bash
npm test -- --run
npm run test:rules
npm --prefix functions test
npm run test:e2e
npm run lint
npm --prefix functions run build
npm run build
npm run verify:secrets
npm audit
npm --prefix functions audit
```

`verify:secrets` dừng release nếu phát hiện khóa provider đã cấu hình xuất hiện trong
`dist`. `test:rules` cần Java 21+ để chạy Firestore Emulator; trước lần chạy E2E đầu
tiên, cài Chromium bằng `npx playwright install chromium`. Endpoint kiểm tra sức khỏe
sau deploy là `/health.json`.

## Triển khai Firebase

Project và named Firestore database đã được khai báo trong `firebase-applet-config.json`
và `firebase.json`. Trước lần deploy đầu:

```bash
npm install --prefix functions
npx firebase-tools login
npx firebase-tools functions:secrets:set GEMINI_API_KEY
npx firebase-tools functions:secrets:set PEXELS_API_KEY
npm run build
npx firebase-tools deploy
```

Trong Firebase Console cần bật Google Sign-in và thêm domain production vào
Authentication → Settings → Authorized domains. Không đưa khóa provider vào biến
`VITE_*` trên production.

Triển khai web client có App Check trước, theo dõi Cloud Functions App Check metrics
để xác nhận request hợp lệ, rồi đặt deployment parameter `ENFORCE_APP_CHECK=true`
và deploy lại Functions. Không bật enforcement trước bước này vì mọi client chưa có
token hợp lệ sẽ bị từ chối. Service account của Functions cần quyền đọc/ghi Firestore
trên named database; bật TTL cho collection group `_functionRateLimitBudgets` với
field `expireAt` để dọn budget cũ.

## Vận hành

- Firestore chỉ nghe trang đang mở (9 thẻ và một cursor look-ahead); thống kê/count có
  TTL. Nút Local Copy không quét lại toàn bộ kho. Chỉ Export mới chủ động đọc toàn bộ.
- Ghi offline dùng Firestore persistent cache và một hàng đợi retry riêng theo UID cho
  trường hợp quota/server từ chối; hàng đợi tự flush khi focus và mỗi phút.
- Card, category facet và custom deck dùng listener giới hạn nên Chrome/Safari cùng tài
  khoản nhận thay đổi cloud mà không tải cả thư viện.
- Callable AI yêu cầu đăng nhập, giới hạn instance và rate-limit theo người dùng.
- Hosting áp CSP, HSTS, chống iframe/MIME sniffing và cache bất biến cho asset có hash.
- Trước khi mở công khai, bật Firebase App Check cho Hosting/Functions và theo dõi quota,
  error rate, latency trong Firebase Console.

Nếu một khóa từng được gửi qua chat, log hoặc bundle cũ, phải rotate khóa đó trước deploy.
