# SonFlash

Ứng dụng flashcard English–Vietnamese có phân trang Firestore, cache offline đa tab,
spaced repetition và tạo nội dung bằng Gemini. Bản production gọi Gemini/Pexels qua
Firebase callable functions; khóa nhà cung cấp không được đưa vào bundle trình duyệt.

## Chạy local

Yêu cầu Node.js 22 và npm. Repository pin major runtime trong `.nvmrc`; clean install
sẽ fail nếu không chạy Node 22.

```bash
nvm use
npm ci
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

Các lệnh lint/unit/build riêng vẫn chạy local. Full `npm run verify` tạo release
evidence và vì vậy chỉ hợp lệ trong clean checkout có `RELEASE_REVISION` là full
40/64-character commit SHA. Không dùng `revision: local` hoặc HEAD SHA để đại diện
cho một dirty worktree.

`verify:secrets` dừng release nếu phát hiện khóa provider đã cấu hình xuất hiện trong
`dist`. `test:rules` cần Java 21+ để chạy Firestore Emulator; trước lần chạy E2E đầu
tiên, cài ba engine bằng `npx playwright install chromium firefox webkit`. CI cố định
Node.js 22 + Java 21 và chạy unit, Functions, Rules, Chromium/Firefox/WebKit, build,
secret scan và dependency audit. Endpoint `/health.json` của mỗi artifact chứa version,
commit revision và build timestamp của chính artifact đó.

Gate predeploy ngắn hơn có thể chạy riêng bằng `npm run verify:deploy`. Gate này gồm lint,
unit test của app và Functions, Functions build, Firestore Rules Emulator và audit dependency
của cả root lẫn Functions. Vì Rules Emulator là một security gate bắt buộc, gate local
sẽ dừng với hướng dẫn cài Java nếu máy chưa có Java 21+; không được bỏ qua test Rules.

Workflow `Build release candidate` chỉ tạo artifact, không deploy. Nó yêu cầu GitHub
production environment secret `VITE_FIREBASE_APP_CHECK_SITE_KEY`; thiếu key sẽ làm
release gate thất bại.

## Triển khai Firebase

Project và named Firestore database đã được khai báo trong `firebase-applet-config.json`
và `firebase.json`. Repository không hỗ trợ local production deploy. Production entry
points duy nhất là các GitHub workflows có protected environments:

1. `Build release candidate` chạy Node 22/Java 21, build đúng một lần, verify chính
   artifact đó rồi seal `dist`, compiled Functions, Rules, Firebase deploy/client config
   và readiness evidence vào một revision/digest manifest. Ghi lại workflow run ID, full
   revision và candidate SHA-256 từ summary.
2. `Deploy production artifact` tải artifact từ đúng successful candidate run, kiểm tra
   workflow provenance, revision, protected project/named-database target và mọi file
   digest. Chạy lần đầu với
   `promote_functions=false` để chỉ promote Hosting qua `production-hosting`.
3. Sau authorized smoke và App Check observation, chạy lại cùng candidate với
   `promote_functions=true` và `app_check_observation_ref`. Functions chỉ được promote
   sau approval riêng của `production-functions`; workflow không deploy Firestore Rules.
4. `Deploy production Firestore Rules cutover` là entry point Rules riêng. Nó fail closed
   nếu thiếu protected approval, exact candidate digest và fresh Admin migration/rollback
   evidence bound với project, database, client revision, Rules digest và encrypted
   rollback-snapshot ciphertext. Plaintext learning data không được đưa vào Actions artifact;
   khóa giải mã external KMS phải tách khỏi GitHub.

Configure `GCP_SERVICE_ACCOUNT_JSON` trong ba deployment environments, public
`FIREBASE_PROJECT_ID` và `FIRESTORE_DATABASE_ID` environment variables trong cả
Hosting/Functions/Rules. `VITE_FIREBASE_APP_CHECK_SITE_KEY`
chỉ cần ở environment dùng build release candidate. Secret provisioning, production
environment protection và Admin migration vẫn là operator actions ngoài local workflow.

Trong Firebase Console cần bật Google Sign-in và thêm domain production vào
Authentication → Settings → Authorized domains. Không đưa khóa provider vào biến
`VITE_*` trên production.

Promote web client có App Check trước và theo dõi Cloud Functions App Check metrics để
xác nhận request hợp lệ. Chỉ sau đó mới approve Functions stage, nơi default deployment
parameter `ENFORCE_APP_CHECK=true` được áp dụng. Không gộp hai bước này vì client chưa
có token hợp lệ sẽ bị từ chối. Service account của Functions cần quyền đọc/ghi Firestore
trên named database; bật TTL cho collection group `_functionRateLimitBudgets` với
field `expireAt` để dọn budget cũ. Đồng thời bật TTL với field `expiresAt` cho cả
hai collection group `shared_decks` và `shared_deck_owners`; share mới và metadata
quyền sở hữu tương ứng sẽ tự hết hạn sau 30 ngày.

Mỗi liên kết chia sẻ hiện chứa tối đa 100 thẻ. Luồng client gửi tối đa 100 thẻ đầu
tiên của category, callable từ chối payload vượt giới hạn và UI cảnh báo rõ khi
category còn thẻ chưa được đưa vào liên kết. Vì vậy không mô tả một category lớn
hơn 100 thẻ là đã được chia sẻ đầy đủ. `expiresAt` do callable trả về là thời điểm
hết hạn của liên kết, không phải cam kết rằng TTL đã xóa vật lý document ngay tại
thời điểm đó.

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
