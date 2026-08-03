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
npm run verify
```

`verify:secrets` dừng release nếu phát hiện khóa provider đã cấu hình xuất hiện trong
`dist`. `test:rules` cần Java 21+ để chạy Firestore Emulator; trước lần chạy E2E đầu
tiên, cài ba engine bằng `npx playwright install chromium firefox webkit`. CI cố định
Node.js 22 + Java 21 và chạy unit, Functions, Rules, Chromium/Firefox/WebKit, build,
secret scan và dependency audit. Endpoint `/health.json` của mỗi artifact chứa version,
commit revision và build timestamp của chính artifact đó.

Gate deploy ngắn hơn có thể chạy riêng bằng `npm run verify:deploy`. Gate này gồm lint,
unit test của app và Functions, Functions build, Firestore Rules Emulator và audit dependency
của cả root lẫn Functions. Vì Rules Emulator là một security gate bắt buộc, deploy local
sẽ dừng với hướng dẫn cài Java nếu máy chưa có Java 21+; không được bỏ qua test Rules.

Workflow `Build release candidate` chỉ tạo artifact, không deploy. Nó yêu cầu GitHub
production environment secret `VITE_FIREBASE_APP_CHECK_SITE_KEY`; thiếu key sẽ làm
release gate thất bại.

## Triển khai Firebase

Project và named Firestore database đã được khai báo trong `firebase-applet-config.json`
và `firebase.json`. Trước lần deploy đầu:

```bash
npm install --prefix functions
npx firebase-tools login
npx firebase-tools functions:secrets:set GEMINI_API_KEY
npx firebase-tools functions:secrets:set PEXELS_API_KEY
export RELEASE_REVISION="$(git rev-parse HEAD)"
# Đặt VITE_FIREBASE_APP_CHECK_SITE_KEY trong .env.production (không commit file này).
npm run verify:deploy
npx firebase-tools deploy
```

Các hook trong `firebase.json` bắt buộc Functions, Firestore và Hosting đi qua cùng
`verify:deploy`, kể cả khi gọi trực tiếp `firebase deploy --only <target>`. Hosting chạy
thêm release-config, production build, secret scan và bundle budget. Gate chung không
tạo hoặc suy đoán production App Check key/revision; các giá trị đó vẫn phải được cung
cấp rõ ràng trước khi deploy Hosting.

Trong Firebase Console cần bật Google Sign-in và thêm domain production vào
Authentication → Settings → Authorized domains. Không đưa khóa provider vào biến
`VITE_*` trên production.

Triển khai web client có App Check trước, theo dõi Cloud Functions App Check metrics
để xác nhận request hợp lệ, rồi đặt deployment parameter `ENFORCE_APP_CHECK=true`
và deploy lại Functions. Không bật enforcement trước bước này vì mọi client chưa có
token hợp lệ sẽ bị từ chối. Service account của Functions cần quyền đọc/ghi Firestore
trên named database; bật TTL cho collection group `_functionRateLimitBudgets` với
field `expireAt` để dọn budget cũ. Đồng thời bật TTL cho collection group
`shared_decks` với field `expiresAt`; share mới tự hết hạn sau 30 ngày.

## Vận hành

- Firestore chỉ nghe trang đang mở (9 thẻ và một cursor look-ahead); thống kê/count có
  TTL. Nút Local Copy không quét lại toàn bộ kho. Chỉ Export mới chủ động đọc toàn bộ.
- Ghi offline dùng Firestore persistent cache và một hàng đợi retry riêng theo UID cho
  trường hợp quota/server từ chối; hàng đợi tự flush khi focus và mỗi phút.
- Card, category facet và custom deck dùng listener giới hạn nên Chrome/Safari cùng tài
  khoản nhận thay đổi cloud mà không tải cả thư viện.
- Callable AI yêu cầu đăng nhập, giới hạn instance và rate-limit theo người dùng.
- Tạo và thu hồi shared deck đi qua callable có Auth, App Check, schema allowlist,
  rate-limit và TTL; trình duyệt không có quyền ghi trực tiếp collection chia sẻ.
- Hosting áp CSP, HSTS, chống iframe/MIME sniffing và cache bất biến cho asset có hash.
- Trước khi mở công khai, bật Firebase App Check cho Hosting/Functions và theo dõi quota,
  error rate, latency trong Firebase Console.

Nếu một khóa từng được gửi qua chat, log hoặc bundle cũ, phải rotate khóa đó trước deploy.
