# SonFlash — Kết quả sửa audit và sync

Ngày: 12/09/2026. Main mới nhất sau fetch: `eb2258a80a09465b255c7d606e69c2db7f857a74`.
Bản sửa nằm trong worktree `/mnt/Projects/startup/flash-card-remediation`, nhánh `fix/audit-sync-remediation`. Working tree cũ và các thay đổi chưa commit được giữ nguyên. Chưa commit, push, merge hay deploy.

## Trạng thái bàn giao

Đã hoàn thành đợt sửa giới hạn được người dùng duyệt bổ sung: B01/B02 và rút gọn câu thông báo XP. Correctness và security review độc lập đều PASS trên candidate5 trong phạm vi các blocker và caller liên quan. Gate bundle PASS, giữ nguyên giới hạn. Bộ browser đầy đủ trên candidate5 đã hoàn tất:210 PASS,12 skip có sẵn,0 FAIL trên Chromium/Firefox/WebKit. Chưa có attestation release cho commit sạch và chưa phát hành.

1. **B01 — đã sửa tranh chấp terminal claim.** Verification, result và error finalization dùng chung khóa theo job; đọc trạng thái durable bên trong khóa. Test barrier tái hiện result/error cùng tranh marker trên baseline, sau sửa chỉ công bố một trạng thái. Thêm test verification cạnh tranh alarm và message giả không làm kẹt result hợp lệ. [background-core.js](../../extensions/lingoflash/background-core.js).
2. **B02 — đã hội tụ các đường kết thúc job.** Alarm, startup, capacity pruning và source-tab close dùng cùng đường đóng/xác nhận worker đã đóng trước khi báo lỗi. Nếu chưa xác nhận được, giữ job, lên lịch thử lại và vẫn tính job hết hạn đó vào capacity. Test source-close lỗi rồi recovery và capacity giữ worker sống. [background.node.mjs](../../extensions/lingoflash/tests/background.node.mjs).
3. **Bundle:** 2.884.994/2.885.000 byte, PASS. Câu XP được rút gọn đúng phạm vi đã duyệt, giữ nguyên ý nghĩa. Phần tối ưu trước đó hội tụ playback và logic queue trùng; không đổi chính sách XP, nới cap hoặc giảm kiểm tra.

## Phạm vi và kết quả

Đã triển khai các bản sửa cho 10 phát hiện audit đầu và 7 phát hiện audit bổ sung, cùng B01/B02 từ review bản vá, kèm các rủi ro có contract/test rõ R01, R05, R07. Đây là sửa source với bằng chứng local; không phải xác nhận tất cả triệu chứng production đã hết.

| ID | Kết quả và kiểm tra tại ranh giới thực |
|---|---|
| A01 | Client gửi expectedOwnerId; parser bắt buộc; callable so với UID token trước quota/write. Test callable thật chặn operation A khi dispatch dưới B; test client xác nhận payload. Auth vẫn là authority. |
| N01 | Nhập queue compatibility đúng một lần trong transaction IDB cùng ACK; dữ liệu đã ACK không hồi sinh từ reader cũ. Denied/corrupt storage trước migration giữ dữ liệu và trả lỗi. DEV server snapshot chỉ đọc, không nhập lại queue. Test imported modules với barrier/IDB. |
| N02 | Chỉ công bố cloud.items khi snapshot đổi; cập nhật UI không chép snapshot cũ lên edit/delete vừa công bố. Hai test controller. |
| N03 | Durable queue notify cùng tab và BroadcastChannel; focus/online/poll đọc lại queue ngay cả khi count trước đó bằng0. Test hook phát hiện producer khác. |
| N04 | Batch mirror so epoch/revision trong transaction; snapshot cũ không ghi đè revision mới. Test mirror thật. |
| N05 | Sync thủ công online buộc refresh mirror; offline giữ bản đã tải. Test hook online/offline và replica xóa thẻ remote khỏi mirror. |
| N06 | Theo dõi snapshot metadata, chỉ xác nhận cloud khi không fromCache/hasPendingWrites. Test controller và shell status. |
| N07 | XP retry theo đợt tối đa3 lần; online/focus/manual mở lại sau lỗi; queue/lỗi hiện trong trạng thái sync. Test hook mất mạng rồi reconnect, không cần reward mới/F5. |
| E01 | Generation background tách khỏi scope tab; hai tab cùng generation không retire nhau; logout rotate generation và clear metadata. Kiểm tra nhiều tab, worker, stale clear, logout trước library ready. |
| E02 | Generation là authority chống replay; background không dựa vào bounded retired list. Utility legacy giữ16 mới nhất. Test100 vòng revoke và replay. |
| E03 | HTML khai báo capability trước chunk; runtime hiện tại có deadline startup15s tách khỏi AI. Context/deck giữ nguyên sau grace1.5s. Test bridge thật trong VM với chậm claim. |
| E04 | Verified sessionStorage là contract bắt buộc; lỗi trước commit trả lỗi rõ, không tin postMessage chưa xác minh. Terminal fallback chỉ xác nhận lỗi sau khi thu hồi handoff. Test storage failures; timeout background đóng/xác nhận worker đã đóng trước khi báo lỗi, giữ job và thử lại nếu chưa xác nhận được. |
| E05 | Cache deck thiếu vẫn cho Add vào Thư viện chung; custom deck chờ metadata. Test popup. |
| E06 | Xóa lịch sử lỗi được trả lên popup, không báo thành công giả. Test storage.remove reject. |
| W01 | PracticeScreen nối command hoàn thành round, guard owner và roundId; chỉ hiện+20 khi command nhận thưởng. Browser test hoàn thành game và kiểm tra XP thực trước/sau/reload. |
| W02 | Hủy mismatch timer khi restart/unmount, generation chặn callback cũ. Browser test mismatch cuối ván→restart→chọn ô mới→timer cũ. |
| W03 | Shared content playback có cancel/ownership; preempt native/TTS, stale error không phát fallback; Flashcard và Shadowing cleanup lifecycle.12 test audio/helper/hook. Reward sound tách riêng. |

Không có mục nào được đánh dấu “đã sửa sẵn trên main”: remote vẫn đúng baseline audit. Các test regression kiểm tra module/hook/callable của repository, không chép mô hình rút gọn audit làm oracle duy nhất.

## Chưa thể kết luận

- Thẻ Vocabulary bị đơ trên Chrome: chưa tái hiện được persistent freeze. Bộ browser flashcard kiểm tra flip, đổi card, dialog/focus và reduced motion; chúng không thay thế session Chrome đang bị lỗi của người dùng. Không sửa animation theo phỏng đoán.
- V01: snapshot mới nhưng nội dung cũ đến sau mutation/ACK vẫn cần kiểm tra order với Firestore thật. N02 chặn republish cùng snapshot, không tự chứng minh mọi interleaving snapshot đã được giải quyết.
- R02 review clock skew/thứ tự, R03 replay quá100 receipts, R04 claim→delivery crash, R06 quota byte settings, R08 physical retention: giữ backlog cần fault injection/contract, chưa ghi thành lỗi production đã tái hiện.
- R01 đã freeze pool đến restart; R05 timer dùng elapsed time gồm hidden-tab; R07 readJobs lỗi không còn fail-open capacity.
- Không profile iPad/Safari thật, không test production auth/provider. Không có kết luận về nguyên nhân nóng máy.

## Giới hạn đưa lên production

A01 thay contract callable: server cũ chưa nhận expectedOwnerId, client cũ chưa gửi field. Cần kế hoạch phát hành phối hợp/refresh client trước khi áp dụng bản này. Chưa phát hành trong phiên làm việc.

`phase6:evidence -- --verified` yêu cầu HEAD trùng release revision và worktree sạch; bản sửa hiện chưa commit nên chưa thể cấp attestation release. Không sửa guard hoặc tạo commit chỉ để làm gate này xanh.

## Nguồn contract

Web Storage setItem kiểm tra khả năng lưu trước khi sửa map; successful return dùng làm điểm commit, tránh fallible cleanup sau commit biến thành báo lỗi sai. [WHATWG Web Storage](https://html.spec.whatwg.org/multipage/webstorage.html#dom-storage-setitem-dev).

## Bằng chứng kiểm tra

Môi trường: Node22.22.3, npm10.9.8, Java21, npm ci theo lockfile ở root và functions. Dữ liệu local/emulator/synthetic; không chạy mutation production.

- Root:235 file,2.172/2.172 test PASS trên candidate4 (`root-candidate4.log`), chạy riêng với maxWorkers4, giữ nguyên timeout/assertions. Một lần chạy đồng thời với browser có catalog timeout5s; chạy riêng cùng file14/14 PASS và sau đó toàn suite PASS.
- Extension candidate5:153/153 test Node PASS và manifest/permission/protocol/syntax checks PASS (`repair3-green3.log`). Sáu regression B01/B02 mới thất bại trước patch (`repair3-red.log`); harness storage clone dữ liệu như API thật để không che race bằng alias object.
- Functions:247 test PASS;19 integration test PASS khi chạy emulator; Firestore rules61 PASS (`verify-2.log`). Hai suite integration được skip trong lần không có emulator rồi đã chạy riêng cùng emulator.
- Browser candidate5 toàn bộ:210 PASS,12 skip theo cấu hình sẵn,0 FAIL trên Chromium/Firefox/WebKit, workers1,9,9 phút (`e2e-candidate5.log`, exit0). Lần chạy trước repair có209 PASS/12 skip/1 timer test mới lỗi clock setup; đã sửa oracle clock và chạy lại, không giảm assertion. Các lượt focused trước đó:6/6 practice XP/timer và33/33 flashcard/sync/chuyển bài PASS. Không biến12skip thànhPASS.
- Root/functions lint và build PASS; candidate5 chạy lại root lint/build,77 test gamification và secrets scan110productionfiles đều PASS. Dependency audit root/functions không có high/critical; Python archive6tests PASS. Bằng chứng functions/rules và full root được tái sử dụng cho đầu vào không đổi; phần XP thay câu đã chạy lại test ảnh hưởng.
- Gate bundle candidate5 PASS (`bundle-5.log`): tổng JS2.884.994/2.885.000 byte,74 chunks; initial JS207.351 byte raw/65.959 gzip; CSS198.882 byte. Không nới giới hạn. Build4 trước đó vượt3byte là một lần FAIL lịch sử, đã giải quyết bằng sửa câu XP được người dùng duyệt.
- Không tuyên bố `npm run verify` PASS toàn chuỗi: chưa có attestation release từ commit sạch. Các gate đơn lẻ và phạm vi tái sử dụng bằng chứng được liệt kê riêng.

Các log và manifests ở `/tmp/sonflash-remediation-evidence`. Báo cáo audit vòng2 gốc ở `/tmp/sonflash-review-20260912-gv6dc9bs/SonFlash_Review_2_eb2258a_2026-09-12.md`.

## Review độc lập và artifact

- Candidate2: cả correctness và security yêu cầu sửa. Batch1 xử lý binding trước readiness, commit/invalidation storage, owner remount và audio lifecycle.
- Candidate3: security PASS phạm vi của lượt đó; correctness chỉ ra timeout trước khi retire worker. Không chuyển PASS này thành PASS cho toàn artifact sau.
- Candidate4: batch2 sửa alarm/startup retirement;146 extension tests PASS. Correctness và security yêu cầu sửa B01/B02; đã dừng và nhận phê duyệt thêm một đợt giới hạn từ người dùng trước khi sửa tiếp.
- Candidate5: batch3 giải quyết B01/B02; correctness và security scoped re-review đều PASS, không còn finding trong phạm vi đó. Manifest801 file, SHA256 `ffc23b7414087082298ee16370243b816efc32f4804789d8566ffcc8908ec329`. Code/tests giữ nguyên sau review; báo cáo bàn giao này được cập nhật kết quả sau review, là thay đổi tài liệu riêng. PASS review không phải quyền merge/deploy.
- Các rủi ro delivery/crash còn lại của R04 vẫn cần fault injection; không tuyên bố toàn bộ job lifecycle đã được xác minh end-to-end.
