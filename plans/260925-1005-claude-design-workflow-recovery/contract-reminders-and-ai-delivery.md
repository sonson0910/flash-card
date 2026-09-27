# Contract: reminder delivery và AI progressive generation/tutor transport

Phạm vi: task 11.1 (11A), contract-only, không có feature code. Không có
`src/features/reminders/**`/`aiTutor/**` hay callable/scheduled function reminder/tutor
nào tồn tại tại HEAD `e25165e` — mọi phần dưới đây là thiết kế mới, nối vào hạ tầng
thật đã có (rate limit, AI quota reservation, scheduled sweep) theo staleness audit
`plans/reports/planner-260926-2229-old-plan-staleness-audit.md` mục "11.1 (11A)".

Owner priority tuyệt đối: chi phí/quota Firebase
(`plans/260926-0917-firebase-cost-rebuild/plan.md`). Mọi thiết kế dưới đây tránh
scheduled Function quét toàn bộ user (per-user fan-out).

## 1. Reminder contract

### 1.1 Schedule, timezone, DST

`days: Weekday[]` (0–6) + `sendAtLocal: "HH:mm"` + `timezone` là IANA name thật (ví dụ
`Asia/Ho_Chi_Minh`), không phải UTC offset tĩnh. Server không cộng offset một lần rồi
lưu mãi: mỗi lần cần "lần gửi kế tiếp", tính lại instant UTC từ
`(days, sendAtLocal, timezone)` bằng `Intl.DateTimeFormat({timeZone})` tại thời điểm
tính, nên DST tự đúng vì offset được hỏi lại mỗi lần. Trường lưu là instant UTC đã tính
sẵn (`nextEligibleSendAt: Timestamp`); local time chỉ là input hiển thị/tính lại. Cùng
nguyên tắc "tính lại từ đồng hồ thật mỗi lần" mà `freePeriod`
(`functions/src/aiQuota.ts:32-40`) đã dùng cho `periodKey` theo `config.pilotTimezone`.

### 1.2 Quiet hours; only-if-due / not-studied-today

`quietHours: { startLocal, endLocal }` cùng `timezone`. `sendAtLocal` rơi vào quiet
hours → giờ hiệu lực dời sang `endLocal` cùng ngày, không bỏ ngày. "Only-if-due": khi
cron chạm `nextEligibleSendAt`, Function kiểm tra due bằng đúng field due-check hiện có
của Practice (`nextReviewDate <= now` trên `users/{uid}/cards`) — chỉ đọc `cards` của
đúng những user đã lọt qua bước 1.4 (nhỏ), không phải toàn bộ user. "Not-studied-today":
đọc `lastStudiedDay` (`YYYY-MM-DD` theo `timezone`) ngay trên doc reminder-state (1.4),
được ghi cùng transaction review commit (`reviewCardV2`,
`src/lib/cardReviewRepository.ts:111-118`) — không cần đọc collection nào khác.

### 1.3 Opt-in/revoke theo channel

`channels: { push: boolean, emailDigest: boolean }`, độc lập nhau; extension badge
không có cờ ở đây (2.3). Tắt channel phải xoá điều kiện gửi ngay: tắt `push` xoá
`pushTokens` tương ứng; tắt `emailDigest` đặt `nextWeeklyDigestAt: null`. Bật lại tính
lại `nextEligibleSendAt`/`nextWeeklyDigestAt` từ đồng hồ hiện tại, không bù các lần đã
bỏ lỡ.

### 1.4 Firestore shape và ngân sách đọc/ghi — tránh fan-out

`sweepAiOperations` (`functions/src/index.ts:659`, `every 15 minutes`) không quét toàn
bộ user: nó chạy một `collectionGroup('ai_operations').where('status','==','reserved').where('reservedAt','<=',cutoff)`
(`functions/src/aiQuota.ts:149-150`) trên composite index có sẵn
(`firestore.indexes.json`, `ai_operations`: `status` ASC + `reservedAt` ASC), trả về
chỉ các operation thật sự due-để-sweep. Reminder Function áp cùng nguyên tắc:

```
users/{uid}/reminderState/current
  timezone, days, sendAtLocal, quietHours
  channels: { push: boolean, emailDigest: boolean }
  nextEligibleSendAt: Timestamp | null
  nextWeeklyDigestAt: Timestamp | null
  lastStudiedDay: string | null
  consecutiveIgnored: number   // backoff, xem mục 5
  updatedAt: Timestamp
```

Cần thêm composite index (11B) `reminderState`, COLLECTION_GROUP, `channels.push` ASC +
`nextEligibleSendAt` ASC (tương tự cho `emailDigest`). Function chạy đúng một
`collectionGroup('reminderState').where('channels.push','==',true).where('nextEligibleSendAt','<=',now)`
— không lặp qua `users`. Ngân sách mỗi user mỗi ngày mỗi channel bật: đọc ≤ 2 (candidate
query chia sẻ chi phí + due-check `.limit(1)` trên index `nextReviewDate` sẵn có) + 1
read `pushTokens` khi due; ghi ≤ 2 (receipt 1.5 + advance `nextEligibleSendAt`). Không
bước nào là O(tổng số user). `nextEligibleSendAt` được viết lại bởi: callable
`updateReminderSettings` khi đổi lịch (đồng bộ, không cần cron); Function sau khi gửi
xong; transaction review commit cập nhật `lastStudiedDay` (gắn vào transaction đã có,
không thêm write riêng).

### 1.5 Delivery receipt và idempotency key theo user/ngày/channel

```
users/{uid}/reminderReceipts/{day}_{channel}   // ví dụ "2026-09-27_push"
  sentAt: Timestamp
  channel: "push" | "emailDigest"
  opId: string   // chỉ để trace log
```

Idempotency key thật là **document ID** `${day}_${channel}`. Function gọi `create()`
(không phải `set`) trước khi gửi; nếu `ALREADY_EXISTS`, bỏ qua — loại double-send do
cron trùng hoặc retry runtime. Khác `ai_operations` (nhiều lần `set({merge:true})` qua
các state): receipt reminder write-once vì hành động gửi (push/email) không refund
được như một AI generation.

### 1.6 Account switch

`reminderState`/`pushTokens` namespace theo `users/{uid}/...` nên không tự lẫn, nhưng
FCM token là theo thiết bị, không theo uid. Sign-out (hoặc đổi account) phải xoá
`pushTokens/{tokenId}` của owner cũ ngay tại lúc đó (client-side, không đợi cron), theo
đúng tinh thần scope-clear-before-create mà `useExtensionDueCountBridge` đã làm cho
due-count (`src/features/extensionBridge/useExtensionDueCountBridge.ts:39-43`) — áp
cùng nguyên tắc cho push token.

## 2. Channels

### 2.1 FCM web push qua scheduled Function

Client xin Notification permission chỉ khi user bấm bật switch (không xin lúc load
trang), lưu token vào `users/{uid}/pushTokens/{tokenId}`
(`{token, platform, createdAt, lastSeenAt}`). Scheduled Function (`onSchedule('every 15 minutes')`,
`region: REGION` như hiện có, `functions/src/index.ts:130`) chỉ đọc `pushTokens` của
uid đã lọt candidate query 1.4, gọi `admin.messaging().sendEachForMulticast` theo
batch, ghi receipt (1.5) cùng lượt. Lỗi
`messaging/registration-token-not-registered` → xoá token, không retry vô hạn cùng
token. **Không setTimeout trang nào hứa push** — app đóng vẫn phải nhận nhắc học, đúng
yêu cầu phase file (không dùng setTimeout trang để hứa push).

### 2.2 Weekly email digest

Cùng cơ chế `nextWeeklyDigestAt` 1.4, cron `every 15 minutes` (điều kiện "đúng thứ
trong tuần" đã nằm trong việc field này chỉ đổi sang đúng ngày đã chọn). **Nhà cung cấp
để owner chọn** (mục 4): Firebase Extension "Trigger Email" (ghi doc vào collection
`mail`, không cần secret ngoài SMTP config) hoặc gọi SDK SendGrid/Resend/Postmark qua
secret quản lý bằng `defineSecret` giống `geminiApiKey`/`analyticsPseudonymKey`
(`functions/src/index.ts:121-123`) — cả hai tương thích idempotency `${day}_emailDigest`
ở trên. Nội dung digest dùng field due-count/streak đã có
(`libraryFacetPersistence.ts` `categories`/`complete`), không quét `cards` riêng.

### 2.3 Extension badge — REUSE, không phải channel mới

Kênh này đã có thật: `useExtensionDueCountBridge`
(`src/features/extensionBridge/useExtensionDueCountBridge.ts:34-56`) publish due count
thật qua `window.postMessage`, scope opaque theo owner
(`extensionDueCountBridge.ts:30-35`) tự clear khi đổi owner
(`useExtensionDueCountBridge.ts:39-43`). Contract này không thiết kế lại kênh này: badge
không cần opt-in riêng, không cần scheduled Function hay Firestore doc mới, hoàn toàn
client-side, không tính vào ngân sách 1.4. Badge luôn `null` vì chưa có nơi app phát
`LINGOFLASH_EXTENSION_DUE_COUNT` (decision-log 2026-09-26, lane phase07A) — thuộc
phạm vi 11B/07, không phải contract này.

## 3. AI progressive generation và tutor transport

### 3.0 Nền tảng hiện có — không tái phát minh

Đường AI hiện tại (single-shot): client gọi `generateVocabulary` qua `callProductionAI`
(`src/lib/gemini.ts:15-34`) với `{action, input, operationId}`; input đã cắt độ dài
client-side (`word` ≤ 80, `context` ≤ 500 ký tự, `src/lib/gemini.ts:92-95`); server
ràng buộc `maxOutputTokens` theo action (`functions/src/aiGeneration.ts:3-7`: word 2048,
story 1024, translate 1536). Quota theo operation: `reserveWordOperation`
(`functions/src/aiQuota.ts:55-100`) ghi `ai_operations/{operationId}`
(`status: reserved|completed|failed`, `attemptId`, `requestHash` chặn đổi request cùng
id), TTL sweep 10 phút cho reservation treo (`sweepExpiredWordOperations`,
`functions/src/aiQuota.ts:148-159`, gọi từ `sweepAiOperations`,
`functions/src/index.ts:659`). Owner đã chốt (decision-log 2026-09-25 12:29): quota
tính khi AI tạo xong; hủy preview vẫn tính; Save không tính thêm — giữ nguyên
receipt/operation hiện tại. Streaming dưới đây mở rộng cơ chế này, không thay thế.

### 3.1 Partial-event schema

`firebase-functions@7.2.5` (`functions/package.json:21`) hỗ trợ streaming callable
(`response.sendChunk(chunk)` nhiều lần trước return cuối) — SDK có sẵn, chưa dùng ở đâu
(`grep sendChunk functions/src` rỗng). Mỗi chunk:

```
{
  operationId: string,
  stage: "reserving" | "drafting" | "field" | "done" | "error",
  field?: "translation" | "explanation" | "exampleSentence" | ...,  // khi stage="field"
  value?: string,          // giá trị field đã HOÀN CHỈNH, không phải token/diff
  errorReason?: string,    // khi stage="error"
}
```

Đơn vị stream là field hoàn chỉnh, không phải token-by-token, vì "edited-field
ownership" (3.3) chỉ an toàn khi biết chắc field nào server vừa quyết định xong.
`stage: "done"` mang response shape callable hiện tại (`WordInfo` qua `parseWordInfo`,
`src/lib/wordInfo.ts`) — dùng lại parser cũ cho happy path.

### 3.2 operationId, cancel, resume — retry qua mạng, không hàng đợi local

`operationId` do client sinh (`globalThis.crypto.randomUUID()`, `src/lib/gemini.ts:91`),
giữ nguyên xuyên suốt một lượt kể cả khi mất mạng giữa chừng. **Cancel**: client đóng
stream, gọi callable `cancelCardGeneration({operationId})` để server dừng gọi Gemini và
ghi `ai_operations/{operationId}.status = "failed"` ngay — tái dùng
`settleWordOperation(..., result: null, ...)` (`functions/src/aiQuota.ts:102-119`,
nhánh refund quota có sẵn). **Resume/retry sau mất mạng**: owner đã bỏ toàn bộ offline
layer (`plans/260926-0917-firebase-cost-rebuild/plan.md`), nên không có hàng đợi local
giữ operation. Khi mạng khôi phục, client gọi lại đúng callable với **cùng
`operationId`**: nếu đã `completed`, server trả `result` cũ ngay, không gọi Gemini lại,
không tính quota lần hai (`functions/src/aiQuota.ts:70-73`); nếu còn `reserved` và mới
(< 90s), trả `operation-in-flight` (`functions/src/aiQuota.ts:75-77`), không tạo
reservation thứ hai. `operationId` khác cho cùng từ là generation mới, tính quota mới.

### 3.3 Edited-field ownership

Client giữ `editedFields: Set<FieldName>` cho phiên generation hiện tại (rỗng khi bắt
đầu operation); user sửa tay một field → `editedFields.add(field)` ngay lúc sửa. Khi
nhận partial event `stage: "field"`: nếu `editedFields.has(event.field)`, bỏ qua giá
trị mới, giữ giá trị người dùng đã sửa; ngược lại áp `event.value`. State này thuần
client-side (không cần field Firestore mới) vì "edited" chỉ có nghĩa trong đúng phiên
của đúng `operationId`; khi `"done"` hoặc Save, `editedFields` bị bỏ, giá trị cuối cùng
đang hiển thị (đã merge) là nguồn ghi vào `cards/{cardId}` qua đường ghi thẻ hiện có.

### 3.4 Quota và cost ownership; server limits

Tái dùng `reserveWordOperation`/`settleWordOperation` cho quota theo operation (3.0) và
`MAX_AI_OUTPUT_TOKENS` cho chi phí output (3.0). **Tutor** (11.5, cùng transport, khác
scope code) không dùng quota "một operation = một thẻ": mỗi lượt hội thoại tiêu một
unit của `reserveNonCardAction`/`refundNonCardAction`
(`functions/src/aiQuota.ts:121-146`, đã có `freeDailyAiActions`/`proDailyAiActions`),
không phải ngân sách thẻ hằng tháng (`ai_usage`). Rate limit tầng callable qua
`consumeBudget` (`functions/src/index.ts:342-368`) với scope riêng (ví dụ
`'ai-card-generation'`, `'ai-tutor-turn'`), theo mẫu các `MAX_*_PER_HOUR` đã khai báo
(`functions/src/index.ts:132-147`). Cost thật đo bằng `readAiTokenUsage`/`AiCallOutcome`
(`functions/src/aiCostLedger.ts:6-33`) tại `stage: "done"` hoàn chỉnh, không đo per-chunk
— giống cách single-shot đo hiện nay.

### 3.5 Trust boundary: không có raw unbounded prompt

Client không gửi free-text "system prompt" để server forward thẳng vào Gemini. Mẫu
hiện tại: `word`/`term` ≤ 80, `context` ≤ 500 (`src/lib/gemini.ts:92-95`),
`translateText` ≤ 2048 (`src/lib/gemini.ts:117`) — input có cấu trúc
(`{term, language, context, partOfSpeech}`, `src/lib/gemini.ts:99-107`), server tự dựng
prompt template. Tutor phải theo cùng khuôn: input `{cardId, question}`, `question` cắt
độ dài (đề xuất ≤ 300 ký tự, mục 4), server tự tra `cardId` trong Firestore để lấy dữ
liệu thẻ thật rồi mới dựng prompt — client không tự chèn nội dung thẻ, tránh giả mạo
ngữ cảnh/prompt injection vượt cỡ. `maxOutputTokens` server-side là giới hạn cứng bất kể
input dài hay ngắn.

## 4. Contract tests cần viết trước 11B

1. `nextEligibleSendAt` đúng qua hai lần chuyển DST (ví dụ `America/New_York` tháng
   3/11), không lệch giờ hiển thị local.
2. Quiet hours dời giờ gửi sang `endLocal` cùng ngày, không bỏ ngày.
3. Only-if-due/not-studied-today: không due hoặc đã học hôm đó → không tạo receipt,
   không gọi FCM/email.
4. Idempotency: gọi logic gửi hai lần cùng `(uid, day, channel)` → `create()` lần hai
   ném `ALREADY_EXISTS`, chỉ một receipt tồn tại.
5. Account switch: sign-out A trên thiết bị đã có push token → `pushTokens` của A bị
   xoá trước khi B đăng nhập cùng thiết bị; B không kế thừa token/lịch của A.
6. Candidate query không fan-out: số doc đọc trong một tick tăng theo số candidate due
   đúng tick, không tăng theo tổng số user giả lập N.
7. Edited-field ownership: field bị user sửa trước khi partial event của field đó tới →
   giá trị cuối là giá trị user sửa, không phải giá trị server gửi sau.
8. Resume trả kết quả cũ: generate với `operationId` đã `completed` → không gọi lại
   Gemini (mock đếm = 0), trả đúng `result` cũ, không tính quota thêm.
9. In-flight: gọi lại cùng `operationId` khi còn `reserved` và mới (< 90s) → nhận
   `operation-in-flight`, không tạo reservation thứ hai.
10. Cancel: gọi cancel giữa lúc `reserved` → chuyển `failed` ngay, quota refund, không
    đợi sweep 10 phút.
11. Tutor quota tách bạch: một lượt hỏi tiêu `ai_daily.nonCardActions`, không đụng
    `ai_usage`; assert hai counter độc lập.
12. Trust boundary: `question` vượt độ dài cho phép → `InputValidationError` trước khi
    build prompt; không có đường forward input gốc thẳng vào model.

## 5. Quyết định owner (2026-09-27)

1. **Email digest:** dùng Firebase Extension "Trigger Email". Không gọi thẳng SDK của provider. Extension đọc collection `mail`, nên Function chỉ ghi một doc cho mỗi digest.
2. **Tutor:** dùng chung hạn mức `ai_daily.nonCardActions` với các hành động AI không-thẻ khác. Không thêm counter riêng.
3. **Độ dài câu hỏi tutor:** tối đa 300 ký tự.
4. **Tần suất push:** owner giao cho controller đề xuất, và chốt như sau.
   - Trần cứng: 1 push mỗi ngày mỗi channel (mục 1.5), tức tối đa 7 push/tuần. Không thêm hạn mức tuần riêng.
   - Backoff khi bị bỏ qua. Thêm field `consecutiveIgnored: number` vào `reminderState/current`. Function cập nhật field này trong chính write advance `nextEligibleSendAt` đã có, nên không tốn thêm read/write:
     - lần gửi trước mà `lastStudiedDay` vẫn cũ hơn ngày gửi đó thì `+1`;
     - ngược lại thì reset về `0`.
   - Mức gửi theo `consecutiveIgnored`:
     - 0–2: gửi theo lịch người dùng chọn;
     - 3–6: chỉ gửi cách một ngày theo lịch;
     - ≥7: ngừng push. Weekly digest vẫn chạy nếu đã bật.
   - Học lại một phiên là đủ để trở về mức 0 ở tick kế tiếp. Không cần write riêng khi review.
   - Lý do: người dùng im lặng nhiều ngày thì push liên tục chỉ dẫn tới thu hồi quyền thông báo. Backoff còn giảm read/write với chính những user không hoạt động, đúng ưu tiên quota Firebase.
   - Contract test bổ sung:
     - chuỗi 0→3→7 bỏ qua cho ra lịch gửi đúng;
     - một ngày học reset về gửi hằng ngày;
     - không phát sinh read thêm.
5. **Badge extension trong Settings:** có. Hiện một dòng thông tin, chỉ đọc, giải thích rằng badge trên extension hiển thị số thẻ đến hạn khi đã cài extension. Không có toggle server, vì badge không gửi gì ra ngoài.
