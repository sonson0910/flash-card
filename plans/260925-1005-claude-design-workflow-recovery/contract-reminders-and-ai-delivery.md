# Contract: reminder delivery và AI progressive generation/tutor transport

Phạm vi: task 11.1 (11A) và phần reminder của 11.2 (11B). Tại revision `e25165e`
chưa có `src/features/reminders/**`/`aiTutor/**` hay callable/scheduled function
reminder/tutor; từ đó reminder, AI progressive và tutor đã có patch nội bộ, chưa deploy
hoặc nghiệm thu Canvas/emulator sau patch AI/tutor. Thiết kế nối vào hạ tầng thật đã có
(rate limit, AI quota reservation, scheduled sweep) theo staleness audit
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

Hàm thuần `functions/src/reminderSchedule.ts` đã tính lần kế tiếp cùng
`scheduledDay` (ngày local người dùng chọn): giờ không tồn tại khi DST nhảy tới
được dời theo độ dài gap; giờ lặp khi DST lùi chọn occurrence còn lại đầu tiên
sau `now`. Scheduled Functions dùng lịch này để claim push receipt hoặc xếp hàng
weekly email; FCM và Trigger Email thật vẫn cần gate delivery riêng của 11.2.

### 1.2 Quiet hours; only-if-due / not-studied-today

`quietHours: { startLocal, endLocal }` cùng `timezone`. `sendAtLocal` rơi vào quiet
hours → giờ hiệu lực dời sang `endLocal`; quiet hours qua nửa đêm có thể đẩy sang
ngày local kế tiếp nhưng `scheduledDay` của lượt nhắc vẫn là ngày được chọn. "Only-if-due": khi
cron chạm `nextEligibleSendAt`, Function đếm thẻ đến hạn bằng `count()` trên
`users/{uid}/cards` với `nextReviewDate <= now` — chỉ cho đúng những user đã lọt
qua bước 1.4. Owner chọn số thật cho nội dung push; phép đếm này thay truy vấn
`.limit(1)` ban đầu và phát sinh phí đọc aggregate theo số index entry được quét.
Nếu cron xử lý muộn và đã bước vào quiet hours, Function dời timestamp đến cuối
quiet hours trong cùng state doc, giữ nguyên ngày lịch gốc và chưa tạo receipt hay
gửi. Việc dời này thêm một state write cho candidate đó. Chỉ dời lượt còn trong
cửa sổ freshness: 1 giờ cho push, 24 giờ cho email; lượt đã stale vẫn advance
theo lịch kế tiếp, không hồi sinh thông báo cũ. Giờ kết thúc được tính lại theo
timezone IANA, kể cả khi quiet hours qua nửa đêm hoặc DST đổi giờ.
"Not-studied-today":
Function đọc `lastVerifiedReviewAt` từ `users/{uid}/profile/stats` cho từng candidate
đến lịch, rồi đổi timestamp sang ngày local theo `reminderState.timezone`. Field này
đã được thêm vào `statsPatch` của verified review trong transaction `reviewCardV2`
(`functions/src/verifiedGamification.ts`); stats doc đã được đọc/ghi ở đó. Chỉ
review thành công, không phải request trùng, lỗi hoặc hành động AI, mới cập nhật
timestamp bằng thời điểm server nhận review. Transaction đến muộn không ghi lùi
timestamp đã mới hơn. Parser legacy XP save chấp nhận field Timestamp/null tùy chọn
trên stats có verified schema và từ chối giá trị sai kiểu. Chưa có live DB mutation
hoặc deploy. Delivery service hiện có trong patch 11B. Cách owner chọn không thêm document
write theo mỗi review, nhưng thêm **1 stats document read cho mỗi candidate đến lịch**.

Cached V2 client thiếu timezone đọc thêm `reminderState/current` trong strict
review. Khi một channel đã bật và state có timezone hợp lệ, server dùng timezone
đó để bootstrap verified stats ngay trong transaction đang có; không ghi
`reminderState` sau review. Nếu chưa opt-in hoặc state không hợp lệ, review vẫn
hợp lệ theo contract cũ và không tạo stats mới. `not-studied-today` phải coi
`lastVerifiedReviewAt` vắng là **không rõ**, không được kết luận chưa học để gửi.
Ở candidate tick, so ngày của timestamp và ngày gửi theo timezone nhắc học;
`studiedOnLocalDay` đã có unit test qua UTC midnight và giờ DST lặp.

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
  onlyIfNotStudiedToday: boolean
  channels: { push: boolean, emailDigest: boolean }
  nextEligibleSendAt: Timestamp | null
  nextEligibleLocalDay: string | null  // ngày lịch gốc, kể cả khi quiet hours dời sang hôm sau
  nextWeeklyDigestAt: Timestamp | null
  nextWeeklyDigestLocalDay: string | null
  consecutiveIgnored: number   // backoff, xem mục 5
  lastPushReceiptId: string | null
  lastEvaluatedSentAt: Timestamp | null
  backoffSkipNext: boolean
  updatedAt: Timestamp

users/{uid}/profile/stats  // đường doc hiện dùng cho verified review
  lastVerifiedReviewAt: Timestamp | null  // server receivedAt của strict review đã commit
```

Cần thêm composite index (11B) `reminderState`, COLLECTION_GROUP, `channels.push` ASC +
`nextEligibleSendAt` ASC (tương tự cho `emailDigest`). Function chạy đúng một
`collectionGroup('reminderState').where('channels.push','==',true).where('nextEligibleSendAt','<=',now)`
— không lặp qua `users`. Ngân sách mỗi candidate đến lịch của **mỗi channel**:
1 candidate query document read + **1 stats document read** + due-count aggregate
query trên index `nextReviewDate` sẵn có; khi gửi push còn đọc `pushTokens` theo
số token của chính uid. Push và weekly digest chạy ở hai scheduler riêng, nên
nếu cả hai đến lịch cho cùng uid thì mỗi scheduler đọc stats và đếm due cards một
lần; chưa có chia sẻ kết quả đọc giữa hai channel. Weekly digest chỉ tra địa chỉ
email đã xác minh khi due-count dương. Push có tối đa
2 writes cho lượt claim (receipt 1.5 + advance `nextEligibleSendAt`), thêm
1 receipt update `sentAt` khi FCM xác nhận ít nhất một token nhận; email enqueue còn có
`mail` write theo mục 2.2. Query không có kết quả vẫn có chi phí tối thiểu theo
Firestore; test emulator đo số lần gọi SDK theo candidate, không đo hóa đơn thật.
Không bước nào là O(tổng số user).
Mỗi scheduler phân trang 100 candidate cho tới khi hết query hoặc đạt ngân sách
240 giây trong timeout 300 giây, xử lý tối đa 5 candidate đồng thời. Candidate
chưa bắt đầu khi hết ngân sách giữ nguyên lịch để lượt 15 phút sau truy vấn lại;
warning chỉ ghi số đã xử lý và số lỗi, không ghi UID/token. Giới hạn cũ 10 trang
đã bỏ; unit kiểm cohort 1.001 candidate. Đây là giới hạn thời gian và throughput,
không bảo đảm mọi cohort lớn được gửi trước cửa sổ stale của push (1 giờ) hoặc
email (24 giờ). Cần đo độ trễ và số lần hết ngân sách trên staging trước rollout;
ca Firestore emulator qua ranh giới trang đã có trong test nhưng chưa chạy trên
source mới. Receipt claim trước FCM vẫn theo lựa chọn tránh gửi trùng: Function
dừng sau claim có thể bỏ lỡ lượt đó.
`nextEligibleSendAt` được viết lại bởi callable `updateReminderSettings` khi đổi
lịch và Function ở mỗi candidate tick, kể cả khi skip do đã học/backoff. Callable
hiện validate lịch/múi giờ, yêu cầu token trước khi bật push, xác minh email
trước khi bật digest, giới hạn token và xoá token trong transaction khi tắt push.
`endPushSession` được gọi sau khi các lần lưu đang chờ kết thúc và trước sign-out.
Nó đọc tối đa 21 token của owner, từ chối trường hợp vượt giới hạn 20, rồi trong
một transaction xoá toàn bộ token đã đăng ký, ghi cutoff `auth_time` cho từng token
và `pushTokenSessionCutoffs/session`, rồi tắt lịch push. Mọi lần bật push đọc thêm
session cutoff và từ chối `auth_time` cũ kể cả với token chưa từng đăng ký; lần
đăng nhập mới có `auth_time` lớn hơn có thể bật lại. Không có read/write mới theo
mỗi review. Thao tác này vẫn chạy khi trình duyệt mất token cục bộ; đăng
xuất trên một thiết bị sẽ tắt push của tài khoản trên các thiết bị khác cho tới
khi người học bật lại. Nếu callable lỗi, sign-out báo lỗi và giữ owner để thử lại.
`revokePushToken` vẫn dùng cho việc thay token hoặc token FCM hết hiệu lực. Rules cho owner
đọc state, token/receipt chỉ Admin; hai composite index candidate đã có trong
manifest và đã qua Rules/Functions integration trên emulator; chưa deploy. Review
commit chỉ cập nhật stats doc đã ghi sẵn, không ghi `reminderState`.

### 1.5 Delivery receipt và idempotency key theo user/ngày/channel

```
users/{uid}/reminderReceipts/{day}_{channel}   // ví dụ "2026-09-27_push"
  claimedAt: Timestamp
  channel: "push" | "emailDigest"
  opId: string   // chỉ để trace log
```

Idempotency key thật là **document ID** `${day}_${channel}`. Function gọi `create()`
(không phải `set`) trước khi gửi; nếu `ALREADY_EXISTS`, bỏ qua — loại double-send do
cron trùng hoặc retry runtime. Khác `ai_operations` (nhiều lần `set({merge:true})` qua
các state): receipt reminder write-once vì hành động gửi (push/email) không refund
được như một AI generation.

Owner chọn tránh gửi trùng. Receipt FCM được `create()` **trước** lệnh gửi, nên
chỉ bảo đảm tối đa một lần thử; Function dừng sau claim có thể làm lỡ một lượt.
Kết quả FCM không rõ không retry cùng ngày/channel. Owner chọn thêm đúng một
receipt update `sentAt` sau FCM success; backoff chỉ tính lượt có `sentAt`, nên
crash sau claim không bị tính là người học bỏ qua. Candidate tick kế tiếp đọc
receipt trước đó khi có `lastPushReceiptId`; đây là một read bổ sung cho backoff,
không phải write sau mỗi review. Với email
qua Trigger Email, Firestore batch tạo đồng thời receipt và
`mail/{uid}_{day}_emailDigest` để không mất enqueue giữa hai write; trùng khóa
phải fail cả batch. Test crash-window và chạy trùng cron vẫn là gate 11B.

### 1.6 Account switch

`reminderState`/`pushTokens` namespace theo `users/{uid}/...` nên không tự lẫn, nhưng
FCM token là theo thiết bị, không theo uid. Sign-out (hoặc đổi account) phải xoá
`pushTokens/{tokenId}` của owner cũ ngay tại lúc đó (client-side, không đợi cron), theo
đúng tinh thần scope-clear-before-create mà `useExtensionDueCountBridge` đã làm cho
due-count (`src/features/extensionBridge/useExtensionDueCountBridge.ts:39-43`) — áp
cùng nguyên tắc cho push token.
Admin duy trì `pushTokenOwners/{sha256(token)}` với một owner và `bindingId` cho
mỗi token. Đăng ký ở account mới chuyển token trong transaction và chặn phiên
cũ đăng ký lại bằng cutoff theo `auth_time` đã xác minh; sign-out chờ các save
đang chạy rồi gọi `endPushSession` để ghi cutoff kể cả khi token cục bộ đã mất. Callable
mới phải được triển khai trước client gọi nó; nếu chưa có callable, sign-out báo lỗi
và giữ phiên để thử lại. `pushTokenOwners` và
`pushTokenSessionCutoffs` chỉ Admin được đọc/ghi. Token legacy chưa có registry
không được gửi cho đến khi đăng ký lại; không suy owner từ bản ghi legacy.

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
Trước FCM, Function kiểm lại owner và `bindingId` của từng token đã claim;
token chuyển account giữa claim và lần kiểm này bị bỏ qua. FCM vẫn không giao
dịch với Firestore: nếu chuyển owner sau lần kiểm cuối, một push đang gửi có
thể đến muộn. Không tuyên bố bảo đảm tuyệt đối rằng push cũ không bao giờ xuất
hiện sau đổi account.

### 2.2 Weekly email digest

Cùng cơ chế `nextWeeklyDigestAt` 1.4, cron `every 15 minutes`. Canvas ghi email
Chủ nhật; schedule writer dùng Chủ nhật theo cùng `sendAtLocal`/timezone và giữ
`nextWeeklyDigestLocalDay` khi quiet hours dời giờ qua hôm sau. Owner đã chọn
Firebase Extension "Trigger Email" (mục 5): Function ghi một doc vào collection
`mail` cho mỗi digest; không gọi thẳng SDK email provider. `sweepWeeklyDigests`
tính due count bằng aggregate query trên cards và đọc `verifiedStreak` trong stats;
nội dung recap en/vi chỉ nêu hai số thật này. Transaction advance lịch và
`create()` đồng thời receipt `${day}_emailDigest` cùng
`mail/{uid}_${day}_emailDigest`, nên cron lặp không tạo mail doc thứ hai.
Nếu email chưa xác minh, thiếu verified study signal hoặc lượt đã trễ hơn 24 giờ,
cron advance lịch mà không enqueue. Firebase Trigger Email extension cần được
cài/cấu hình riêng ở môi trường được duyệt; chưa có bằng chứng email được giao thật.
Khi chưa có bằng chứng đó, cả `REMINDER_EMAIL_ENABLED` của Functions và
`VITE_REMINDER_EMAIL_ENABLED` của client mặc định tắt: callable không nhận opt-in
email, cron không tạo mail và Settings báo kênh chưa khả dụng. Chỉ bật hai cờ
sau khi cấu hình Trigger Email và kiểm giao nhận ở môi trường được duyệt.

### 2.3 Extension badge — REUSE, không phải channel mới

Kênh này đã có thật: `useExtensionDueCountBridge`
(`src/features/extensionBridge/useExtensionDueCountBridge.ts:34-56`) publish due count
thật qua `window.postMessage`, scope opaque theo owner
(`extensionDueCountBridge.ts:30-35`) tự clear khi đổi owner
(`useExtensionDueCountBridge.ts:39-43`). Contract này không thiết kế lại kênh này: badge
không cần opt-in riêng, không cần scheduled Function hay Firestore doc mới, hoàn toàn
client-side, không tính vào ngân sách 1.4. Kể từ sau decision-log 2026-09-26,
`AppRuntime.tsx` đã gọi `useExtensionDueCountBridge` với `cloudStats.due` khi thư viện
của owner sẵn sàng; hook phát `LINGOFLASH_EXTENSION_DUE_COUNT` và clear scope khi đổi
tài khoản. Trạng thái extension thực cài trong Chrome và Canvas vẫn cần nghiệm thu riêng.

## 3. AI progressive generation và tutor transport

### 3.0 Nền tảng hiện có — không tái phát minh

Đường AI nền (single-shot): client gọi `generateVocabulary` qua `callProductionAI`
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

`firebase-functions@7.2.5` hỗ trợ streaming callable (`response.sendChunk(chunk)`
nhiều lần trước return cuối). Patch hiện dùng Firebase callable stream cùng
Gemini `generateContentStream` cho action `word`; story/translate giữ single-shot.
Mỗi chunk:

```
{
  operationId: string,
  stage: "reserving" | "drafting" | "field" | "done" | "error",
  field?: "translation" | "explanation" | "exampleSentence" | ...,  // khi stage="field"
  value?: unknown,         // giá trị field đã HOÀN CHỈNH, type theo WordInfo field
  errorReason?: string,    // khi stage="error"
  result?: WordInfo,       // khi stage="done"
}
```

Server chỉ phát field khi phần JSON top-level đó đã đóng hợp lệ, rồi xác minh cả
response cuối trước khi settle quota. Đơn vị stream là field hoàn chỉnh, không phải token-by-token, vì "edited-field
ownership" (3.3) chỉ an toàn khi biết chắc field nào server vừa quyết định xong.
`stage: "done"` mang response shape callable hiện tại (`WordInfo` qua `parseWordInfo`,
`src/lib/wordInfo.ts`) — dùng lại parser cũ cho happy path.

### 3.2 operationId, cancel, resume — retry qua mạng, không hàng đợi local

`operationId` do client sinh (`globalThis.crypto.randomUUID()`),
giữ nguyên xuyên suốt một lượt kể cả khi mất mạng giữa chừng. **Cancel**: client abort
stream bằng `AbortSignal` rồi gọi `cancelCardGeneration({operationId})` để refund
reservation còn chạy. Kết nối đóng làm `CallableResponse.signal` abort Gemini;
callable dùng `settleWordOperation(..., result: null, ...)` để đánh dấu `failed`
và hoàn quota nếu operation vẫn `reserved`. Nếu đã `completed`, cancel không hoàn quota.
**Resume/retry sau mất mạng**: owner đã bỏ toàn bộ offline
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
`MAX_AI_OUTPUT_TOKENS` cho chi phí output (3.0). **Tutor** (`askCardTutor`, cùng callable, khác
scope code) không dùng quota "một operation = một thẻ": mỗi lượt hội thoại tiêu một
unit của `reserveNonCardAction`/`refundNonCardAction`
(`functions/src/aiQuota.ts:121-146`, đã có `freeDailyAiActions`/`proDailyAiActions`),
không phải ngân sách thẻ hằng tháng (`ai_usage`). Rate limit tầng callable qua
`consumeBudget` (`functions/src/index.ts:342-368`) với scope riêng (ví dụ
`'ai-card'`, `'ai-tutor-turn'`), theo mẫu các `MAX_*_PER_HOUR` đã khai báo
(`functions/src/index.ts:132-147`). Cost thật đo bằng `readAiTokenUsage`/`AiCallOutcome`
(`functions/src/aiCostLedger.ts:6-33`) tại `stage: "done"` hoàn chỉnh, không đo per-chunk
— giống cách single-shot đo hiện nay. Patch đặt trần tutor 60 request/giờ/owner và
`maxOutputTokens: 768`; lượt thành công giữ `nonCardActions`, lỗi model/parser hoàn
lượt. Client không tự retry sau lỗi mạng để tránh tính hai lượt khi kết quả server
không rõ. Modal chỉ giữ 3 lượt hỏi đáp trong phiên, xóa khi đổi thẻ/tài khoản;
không lưu transcript vào Firestore.
Tutor client dùng Firebase callable streaming transport để nhận kết quả cuối và
truyền `AbortSignal`. Đóng modal, đổi thẻ hoặc đổi owner ngắt HTTP request đang
chạy; server chuyển disconnect tới Gemini và hoàn daily allowance khi request
kết thúc bằng lỗi/hủy. Nếu kết quả đã hoàn thành trước disconnect thì lượt đã dùng
vẫn tính. Hủy là best effort; cần nghiệm thu browser và provider thật trước rollout.

### 3.5 Trust boundary: không có raw unbounded prompt

Client không gửi free-text "system prompt" để server forward thẳng vào Gemini. Mẫu
hiện tại: `word`/`term` ≤ 80, `context` ≤ 500 (`src/lib/gemini.ts:92-95`),
`translateText` ≤ 2048 (`src/lib/gemini.ts:117`) — input có cấu trúc
(`{term, language, context, partOfSpeech}`, `src/lib/gemini.ts:99-107`), server tự dựng
prompt template. Tutor theo cùng khuôn: input `{cardId, question, history?}`;
`question` dài hơn 300 ký tự bị từ chối, `history` tối đa 3 cặp với mỗi câu ≤300
và đáp ≤1500 ký tự. Server tra `users/{auth.uid}/cards/{cardId}`, chỉ lấy các trường
từ vựng cần thiết và giới hạn từng trường trước khi dựng prompt. Card/history/question
đều được đánh dấu là dữ liệu không tin cậy; client không gửi nguyên prompt đến model.
`maxOutputTokens` server-side là giới hạn cứng bất kể input dài hay ngắn.

## 4. Contract tests cần viết trước 11B

1. `nextEligibleSendAt` đúng qua hai lần chuyển DST (ví dụ `America/New_York` tháng
   3/11), không lệch giờ hiển thị local; giờ lặp không tạo hai receipt cùng ngày lịch.
2. Quiet hours dời giờ gửi sang `endLocal`, giữ `nextEligibleLocalDay` khi dời qua nửa đêm.
3. Only-if-due/not-studied-today: không due hoặc đã học hôm đó → không tạo receipt,
   không gọi FCM/email; xác minh `lastVerifiedReviewAt` được chuyển theo timezone
   nhắc học và chỉ có ở review đã commit. Test cached V2 client thiếu timezone
   trên stats mới: không được gửi reminder sai sau một review thành công.
4. Idempotency: gọi logic gửi hai lần cùng `(uid, day, channel)` → `create()` lần hai
   ném `ALREADY_EXISTS`, chỉ một receipt tồn tại; test thêm crash giữa receipt và
   enqueue/gửi để phân biệt một lần thử với delivery thành công.
5. Account switch: sign-out A trên thiết bị đã có push token → `pushTokens` của A bị
   xoá trước khi B đăng nhập cùng thiết bị; B không kế thừa token/lịch của A.
6. Candidate query không fan-out: số doc đọc trong một tick tăng theo số candidate due
   đúng tick (thêm 1 stats read và due-count aggregate mỗi candidate đủ điều kiện),
   không tăng theo tổng số user giả lập N.
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

**Gate 11.1 ngày 01/10:** các case trên có test ở `functions/test/reminderSchedule.test.ts`,
`reminderPushDelivery.test.ts`, `reminderEmailDigest.test.ts`,
`reminderDeliveryFirestore.integration.test.ts` cùng test AI/tutor tương ứng.
Email và push đều không claim khi zero due hoặc đã học cùng ngày local nếu bật
`onlyIfNotStudiedToday`; lịch vẫn advance. Crash sau push claim không retry cùng ngày;
backoff 0→3→7, pause và reset khi học có test. Test Firestore emulator tạo 22
reminder state, chỉ 2 đến hạn, và đếm 2 stats `get` cùng 2 due-count aggregate `get`
trong tick; đây là số lần gọi SDK trên emulator, không phải hóa đơn Firestore.
`npm run test:rules` đạt 95/95 Rules và 51/51 Functions integration; reviewer độc lập
đã kiểm gate contract. Gate này không xác nhận FCM hoặc Trigger Email thật.

## 5. Quyết định owner (2026-09-27)

1. **Email digest:** dùng Firebase Extension "Trigger Email". Không gọi thẳng SDK của provider. Extension đọc collection `mail`, nên Function chỉ ghi một doc cho mỗi digest.
2. **Tutor:** dùng chung hạn mức `ai_daily.nonCardActions` với các hành động AI không-thẻ khác. Không thêm counter riêng.
3. **Độ dài câu hỏi tutor:** tối đa 300 ký tự.
4. **Tần suất push:** owner giao cho controller đề xuất, và chốt như sau.
   - Trần cứng: 1 push mỗi ngày mỗi channel (mục 1.5), tức tối đa 7 push/tuần. Không thêm hạn mức tuần riêng.
   - Backoff khi bị bỏ qua. Thêm field `consecutiveIgnored: number` vào `reminderState/current`. Function cập nhật field này trong chính write advance `nextEligibleSendAt` đã có, nên không thêm write cho backoff:
     - lần gửi trước có `sentAt` mà `lastVerifiedReviewAt` trên stats không muộn hơn `sentAt` của lượt đó thì `+1`;
     - ngược lại thì reset về `0`.
   - Mức gửi theo `consecutiveIgnored`:
     - 0–2: gửi theo lịch người dùng chọn;
     - 3–6: chỉ gửi cách một ngày theo lịch;
     - ≥7: ngừng push. Weekly digest vẫn chạy nếu đã bật.
   - Học lại một phiên là đủ để trở về mức 0 ở candidate tick kế tiếp. Kể cả mức ≥7, Function vẫn kiểm tra candidate theo lịch bằng 1 stats read và advance write để phát hiện việc học lại; không gửi push khi chưa reset. Quy tắc này ưu tiên phục hồi ở tick kế tiếp, nên backoff giảm số lần gửi nhưng **không giảm** read/write của candidate tick. Không có reminder-state write theo mỗi review.
   - Lý do: người dùng im lặng nhiều ngày thì push liên tục chỉ dẫn tới thu hồi quyền thông báo.
   - Contract test bổ sung:
     - chuỗi 0→3→7 bỏ qua cho ra lịch gửi đúng;
     - một ngày học reset về gửi hằng ngày;
     - mỗi candidate đến lịch chỉ đọc thêm đúng 1 stats doc, không ghi doc khác trên mỗi review.
5. **Badge extension trong Settings:** có. Hiện một dòng thông tin, chỉ đọc, giải thích rằng badge trên extension hiển thị số thẻ đến hạn khi đã cài extension. Không có toggle server, vì badge không gửi gì ra ngoài.
