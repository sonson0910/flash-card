---
title: "Contract revision — AnimeReveal rewards, server authority"
status: approved-for-local-implementation
---

# Contract revision: AnimeReveal rewards và server authority

## Trạng thái quyết định

**Đã được owner duyệt:** reward proposal gốc: `tierup` chỉ là ceremony sau khi
card thành `mastered`; `streak` ở mốc 30 cấp `Web Wanderer` và `+1` streak
freeze (cap 1); `levelup` đúng 12 → 13 cấp `Crimson Wing`, `Word Collector` và
`+1` hint token (cap 3). Reward theo `uid`, vĩnh viễn, không season, không
backfill, không XP bonus, không daily-plan bonus, không Share. Owner cũng đã
duyệt **+1 Firestore read mỗi lần hydration** để đọc inventory rewards.

**Owner duyệt tiếp ngày 2026-09-27:** full server authority và bảng chi phí
producer bên dưới; timezone riêng theo account; verified-from-zero cho XP/streak
legacy, nghĩa là level hiện lại từ 1. Đây là quyền triển khai code và test local,
không phải quyền deploy hay sửa dữ liệu production.

Phạm vi chỉ là ba state `tierup`, `streak`, `levelup` của `AnimeReveal`.
German article vẫn ở wave 2 và không thuộc contract này. Canvas tại
`docs/design/sonflash-redesign/canvas/src/AnimeReveal.dc.html` là reference
visual; audit tại `plans/reports/audit-260927-1235-board-artboard-coverage.md`
xác nhận artboard chưa được implement.

## Lý do revision

`saveGamification` hiện nhận `delta` từ client, cho phép mỗi operation tới
`1,000,000` (`functions/src/gamificationPersistence.ts:9-16`), rồi merge
snapshot/history client trong transaction (`:434-570`). Streak hiện được tăng
trong client hydration/model; practice game gọi `addXp(5)` ở client và card
intake cộng XP sau create. Vì vậy XP/streak hiện có không là authority đủ để
cấp durable level hoặc streak reward.

`reviewCard` đã có transaction và review receipt (`functions/src/reviewPersistence.ts:285-408`),
nên là producer khả thi để server tự xác thực một review. Tier hiện có cũng
được xác định từ `difficulty === 'easy'` hoặc interval/scheduled days ≥ 21
(`src/features/library/libraryViewModel.ts:18-25`), không phải từ “6 correct
reviews” của Canvas.

## Kiến trúc full server authority đã duyệt

Giữ nguyên reward đã duyệt. Thay `saveGamification` làm nguồn reward bằng ba
producer server-verified; server tự tính XP, verified-study-day, streak và
level từ operation đã xác thực. Client chỉ nhận outcome để render ceremony,
không gửi XP delta, streak, level, threshold hoặc reward amount.

| Producer | Input được tin | Server outcome đề xuất | Reward relation |
|---|---|---|---|
| Verified review | `reviewCardV2` authenticated, scheduler transition và card stored trong cùng transaction | Ghi review receipt hiện có; tăng XP/study progress server-defined; đánh dấu verified study day. | Trả và replay `tierup` khi transition sang mastered; cũng có thể trả streak/level threshold. |
| Verified create | `createCardV2` authenticated chỉ sau khi card được server persist thành công, operation receipt server-side. | Cấp XP server-defined đúng một lần cho card create thành công. `V2` hoặc response versioned là bắt buộc vì parser response hiện tại exact. | Có thể chạm level threshold; award trong cùng transaction, event lưu trong create receipt để retry trả lại. Không tự tạo study day. |
| Verified practice | Server tạo session từ N card IDs hợp lệ; completion chỉ nhận answers khớp session và chưa complete. | Ghi completion receipt, XP server-defined một lần; không trust điểm/delta client. | Có thể chạm level threshold; award trong cùng transaction, event lưu trong completion receipt. Không tự tạo study day. |

Đề xuất chỉ review đã verified mới làm tăng streak. Create/practice XP vẫn có thể
gây level 12 → 13, nhưng không thể tự tạo 30-day streak. Đây là authority đầy
đủ cho level reward đã duyệt mà không biến mọi client action thành streak.

### Data và idempotency proposal

- `users/{uid}/profile/rewards`: `schemaVersion: 1`, `unlockedBadgeIds`,
  `ownedFrameIds`, `ownedTitleIds`, `equippedFrameId`, `hintTokens: 0..3`,
  `streakFreezes: 0..1`, và hai receipt fixed `streak-30-v1`, `level-13-v1`.
- Server-owned gamification progress nằm trong `profile/stats` đang được đọc
  khi hydration, không thêm một lượt đọc account mới. Preserve toàn bộ field
  legacy hiện có; chỉ thêm `verifiedXp`, `verifiedStreak`,
  `lastVerifiedStudyDay`, IANA `rewardTimeZone` và version của verified schema.
  `xp_history.verifiedByDayV1` là nested map server-only: increment entry day
  bằng update atomically, không read toàn bộ history chỉ để cộng ngày. Mỗi
  action dùng deterministic operation
  ID; transaction trả original outcome cho retry cùng ID, reject cùng ID nhưng
  fingerprint khác, và không award twice khi concurrent requests.
- `tierup` không có durable payout. Session dedupe bằng review operation ID;
  retry không mở lại dialog trong cùng session. `streak` và `levelup` trả event
  chỉ khi receipt reward mới được set trong transaction.
- **Dùng khung** là server action với allowlist `crimson-wing`; server đọc
  rewards, xác minh ownership, rồi set `equippedFrameId`. **Để sau**, close và
  Continue không ghi dữ liệu. Không có CTA tiêu dùng hint/freeze ở release này.
- Compatibility: `saveGamification` cũ chỉ merge field legacy đã allowlist,
  từ chối payload client có key `verifiedByDayV1` (kể cả collision nested map),
  và client mới ngừng gọi route này để ghi XP/streak. Không client payload nào
  được ghi verified fields.

### Firestore cost của producer đề xuất

Số dưới đây là **I/O thêm trong transaction producer so với mutation producer
hiện tại**, mỗi action thành công; không phải net account bill. Luồng
`saveGamification` client-driven hiện có sẽ phải ngừng ghi XP/streak, nên số
net còn phụ thuộc số lần save cũ được gộp và phải đo khi rollout. Retry
transaction có thể đọc lại theo semantics Firestore. Chưa gồm tombstone,
rate-limit hoặc read card ngoài N cards được liệt kê. Callable practice mới
còn cần account-tombstone read và rate-limit read/write ngoài bảng.

| Action server-authoritative | Increment normal | Increment khi reward threshold | Ghi chú |
|---|---:|---:|---|
| Hydration khi signed-in | `+1R / +0W` | — | Đã owner duyệt: đọc `profile/rewards`; không subscription. |
| Verified review | `+1R / +2W` | `+2R / +3W` | Stats + xp history; threshold thêm rewards read/write. Tier ceremony vẫn `+0R/+0W`. |
| Verified create | `+2R / +3W` | `+3R / +4W` | Producer receipt + server XP/progress; threshold thêm rewards read/write. |
| Start verified practice session | `N card reads + 0R / +1W` | — | N là số card session; write session receipt/state. |
| Complete verified practice | `+2R / +3W` | `+3R / +4W` | Validate session/completion then server XP/progress; threshold thêm rewards read/write. |
| **Dùng khung** | `+1R / +1W` | — | Read ownership, write equip state. |
| Modal render/close/Continue/Để sau | `+0R / +0W` | — | Session UI only. |

Nếu review làm đồng thời chạm streak 30 và level 13, chỉ đọc/ghi một rewards
document: threshold surcharge vẫn `+1R/+1W`, không nhân đôi.

### Timezone, legacy và rollout

**Timezone per account đã duyệt:** client gửi IANA timezone từ
`Intl.DateTimeFormat().resolvedOptions().timeZone` trong verified action đầu
tiên; server validate bằng `Intl.DateTimeFormat`, cố định vào
`profile/stats.rewardTimeZone` cùng write verified progress đầu tiên. Các
action sau dùng timezone đã lưu, bỏ qua timezone client khác. Server lấy thời
gian nhận request một lần khi handler bắt đầu, không lấy timestamp client và
không khẳng định đó là exact commit time; chuyển sang calendar day trong IANA
timezone đã lưu (kể cả DST). Account cũ chưa có timezone cũng theo bước đầu
tiên này. Đổi timezone sau khi ledger đã bắt đầu là contract riêng, tránh
đổi ngày hồi tố hoặc lợi dụng ranh giới ngày. Field nằm trong stats read/write
đã tính ở bảng nên không thêm I/O.

**Legacy baseline đã duyệt:** verified-from-zero tại rollout: giữ XP legacy
thành số liệu lịch sử có nhãn riêng; level đang hiển thị chuyển sang verified
XP và khởi đầu lại từ level 1. Verified-day ledger bắt đầu rỗng, do đó streak
30 sớm nhất sau 30 verified ngày. Exact backfill không thể chứng minh vì
source legacy client-controlled. Không cấp reward dựa trên XP/streak cũ.

Rollout proposal: deploy Functions/Rules/schema sau feature gate off; enable
producer server actions; lazy-create server records trên action đầu tiên; sau đó
enable UI. Roll back chỉ tắt gate/producer route, không delete receipts,
progress hay rewards vì delete có thể cấp lại entitlement. Không có data
migration/batch/backfill.

### Rules, profile và export

- Firestore Rules: owner chỉ read `profile/rewards` và server progress; client
  direct create/update/delete deny. Functions dùng Admin transaction và check
  `auth.uid`; không có callable generic để ghi XP/streak/reward.
- Profile chỉ render frame/title đã owned/equipped từ hydration response. Không
  có inventory settings, equip client write, hoặc cross-user visibility ngoài
  scope.
- Library export/import vẫn không gồm reward/progress/receipt. Account export
  query whole profile nên tự gồm `profile/rewards` và verified fields trong
  `profile/stats`/`xp_history`; implementation phải bổ sung rõ receipt/session
  collections vào account export và account import không được restore receipt
  hoặc re-award entitlement.

### Shadowing payout — owner đã chốt

Shadowing hiện cộng `+10 XP` qua transcript do browser tự báo; server không
thể xác minh người học đã nói mà không có audio upload và transcription phía
server. Owner chọn giữ Shadowing để luyện nói, bỏ `+10 verified XP`. Client
mới không cộng XP cho mode này, và transcript không thể cấp durable reward.
Không thêm audio upload, Storage hay transcription server trong phạm vi này.

## Phương án rẻ hơn không được chọn

**Verified-review streak-only**: chỉ dùng review transaction và server day
ledger; không server-authoritative XP, create, practice hoặc level reward.
Cost: mỗi verified review `+1R` progress; review đầu ngày `+1W`; threshold
streak 30 thêm `+1R/+1W` rewards. Không backfill nên cần tối thiểu 30 ngày sau
rollout. Đây rẻ hơn, nhưng không thể thực hiện durable `levelup` reward owner
đã duyệt; chỉ được chọn nếu owner chủ động đổi scope đó trong một approval mới.

## UI và validation sau approval

- `tierup`: primary **Tiếp tục học**. `streak`: primary **Tiếp tục học**.
  `levelup`: primary **Dùng khung**, secondary **Để sau**; Escape/close là
  **Để sau**. Queue theo server outcome order; cùng outcome thì streak trước
  levelup. Focus trap/return, keyboard, reduced motion, Lumi-off và no inert
  CTA là bắt buộc.
- Unit/Functions: forged client delta rejected; forged session completion,
  duplicate/retry/fingerprint mismatch, concurrent action, 29→30, 12→13,
  cap freeze/hint, account switch, IANA timezone và DST boundary,
  legacy baseline và rollback gate.
- Rules emulator: owner read-only; no direct reward/progress mutation; no
  cross-owner read; callable accepts only validated producer action.
- Visual/e2e: ba state Crystal dark/light desktop/mobile; vi/en/en-XA; real
  source payload, queue and CTA behavior; focused tests then i18n/core/build/
  bundle, Functions/Rules emulator and visual evidence.

## Phạm vi giữ lại

Verified-review streak-only không được chọn và không thay đổi quyết định
reward level. German article ở wave 2. Không deploy, migrate production, hay
backfill trong lần implementation local này.
