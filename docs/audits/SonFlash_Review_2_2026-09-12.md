# SonFlash — Review bổ sung về sync và thẻ Vocabulary

Ngày thực hiện: 12/09/2026. Repository: sonson0910/flash-card.

**Kết quả:** 7 phát hiện bổ sung có kiểm tra trên module/hook thực; 1 nghi vấn thứ tự snapshot cần thêm oracle production. Lỗi người dùng báo “Chrome, màn hình Vocabulary, phải F5 mới lật thẻ” chưa tái hiện được, không được ghi thành lỗi đã xác định nguyên nhân.

## 1. Phiên bản và phạm vi

Đã chạy `git fetch origin`. Remote `origin/main` mới nhất vẫn là `eb2258a80a09465b255c7d606e69c2db7f857a74`, trùng SHA của báo cáo audit ngày 10/09. Không có bản vá mới trên main được lấy về qua lần fetch này.

Working tree đang mở ở nhánh `fix/apple-device-performance`, HEAD `067b2a24e3b327aac48ce8594db99b6d656b7de1`, cũ hơn baseline và có thay đổi chưa commit. Không merge main vào nhánh đó, không checkout đè, không sửa các file đang làm dở. Tạo git archive riêng của main để đọc và chạy kiểm tra. Đã kiểm tra SHA-256 của toàn bộ 791 file trong archive sau audit: không file gốc nào thay đổi. Các probe, config thử nghiệm và output được tạo riêng ngoài repository gốc.

Đọc tập trung vào luồng cloud page → pending queue → IndexedDB mirror → React projection; immediate mutations và background flush; owner migration; Flashcard, LibraryCardGrid, các dialog; gamification và một phần extension lifecycle. Không đọc hết từng dòng toàn repository; không khẳng định đã tìm hết mọi lỗi. Đây là review bổ sung, không phải chứng nhận an toàn hay một lần tái xác nhận toàn bộ 10 mục của báo cáo cũ.

## 2. Danh sách phát hiện mới

| ID | Ưu tiên đề xuất | Phát hiện | Bằng chứng mạnh nhất |
|---|---|---|---|
| N01 | P1 | Đọc pending queue đưa operation đã ACK trở lại IndexedDB | Chrome thật, build production, 10/10 lần; thêm test module |
| N02 | P1 | Projection chép snapshot cloud cũ lên thay đổi vừa công bố trên UI | 2 test controller thật, lần theo React effect/caller |
| N03 | P2 | Hàng đợi phát sinh sau lần đọc đầu không được tab đang mở tự phát hiện | Hook thật, fake timers, replica boundary mock |
| N04 | P2 | Ghi mirror không chặn bản cũ ghi đè revision mới | Module mirror thật, fake-indexeddb |
| N05 | P2 | Sync thủ công dùng lại mirror “fresh” dù cloud đã xóa/sửa thẻ | Replica + mirror thật, cloud boundary mock |
| N06 | P2 | UI báo Synced khi chỉ nhận được bản cache, chưa xác nhận cloud | Controller + shell status thật; đối chiếu Firebase docs |
| N07 | P2 | XP còn pending sau lỗi mạng nhưng reconnect và Sync không phục hồi nó | Gamification hook/controller thật, store boundary mock |

Không có phát hiện nào được xác minh trên tài khoản production của người dùng. N01 được xác minh trong trình duyệt thật tại localhost với dữ liệu tổng hợp, không gọi mutation cloud.

## 3. Chi tiết

### N01 — Operation đã ACK bị hồi sinh từ bản sao localStorage

**Vị trí:** [loadDevicePending](/tmp/sonflash-review-20260912-gv6dc9bs/source/src/lib/deviceSync.ts:358); [acknowledgeDevicePending](/tmp/sonflash-review-20260912-gv6dc9bs/source/src/lib/deviceSync.ts:568). Caller đọc hàng đợi nằm tại [transformPage](/tmp/sonflash-review-20260912-gv6dc9bs/source/src/features/librarySession/useCloudLibraryPage.ts:49).

`loadDevicePending()` đọc bản sao compatibility ở localStorage trước một `await`, sau đó luôn trộn bản sao ấy trở lại durable queue thông qua `persistDevicePending()`. ACK chỉ xóa operation khỏi trạng thái hiện tại; nó không ngăn một reader đang giữ bản sao cũ đưa operation trở lại sau đó. Các transaction IndexedDB riêng lẻ vẫn nguyên tử: lỗi nằm ở dữ liệu cũ được đọc ngoài transaction rồi nhập lại.

Thứ tự đã tái hiện:

1. Queue chứa operation P.
2. Cloud-page reader gọi `loadDevicePending()` và giữ bản localStorage có P.
3. `acknowledgeDevicePending([P])` xóa P trong IndexedDB và hoàn tất.
4. Reader tiếp tục, trộn bản cũ có P vào IndexedDB.
5. Cả hai promise đã resolve; hàng đợi lại có P, không có edit mới nào.

**Tác động:** operation hoàn tất lại bị xem là chưa sync; có thể gửi lại mutation, làm trạng thái pending và refresh cloud lặp lại. Đây là một ứng viên trực tiếp giải thích triệu chứng “cứ sửa dữ liệu là load/sync lại”. Không suy ra rằng mọi retry đều làm nhân đôi dữ liệu: các guard/idempotency hiện có vẫn có tác dụng.

**Kiểm tra:** `_audit/pending-race.audit.test.ts` import các hàm thực; kết quả kỳ vọng queue rỗng nhưng còn 1 operation. Probe build riêng import cùng module với `import.meta.env.DEV === false`, chạy Chrome thật và IndexedDB/localStorage thật: 10/10 trial còn 1 operation sau ACK. Các key thử nghiệm dùng owner tổng hợp riêng và đã xóa sau thử nghiệm.

**Sửa tối thiểu đề xuất:** chuyển compatibility migration thành quá trình được đánh dấu hoàn tất/được phối hợp nguyên tử; các lần đọc bình thường lấy durable queue, không liên tục nhập lại localStorage. Nếu giữ nhiều nguồn, cần generation/receipt thích hợp để reader cũ không thể hồi sinh operation. Không giải quyết bằng xóa toàn bộ cache hoặc bỏ ACK guards.

### N02 — Snapshot cloud chưa đổi ghi đè edit/delete vừa công bố

**Vị trí:** [cloud projection](/tmp/sonflash-review-20260912-gv6dc9bs/source/src/features/librarySession/useLibraryCloudProjection.ts:178); effect [effect cập nhật projection](/tmp/sonflash-review-20260912-gv6dc9bs/source/src/features/librarySession/useLibraryCloudProjection.ts:296); wiring [useAppLibraryRuntime](/tmp/sonflash-review-20260912-gv6dc9bs/source/src/app/useAppLibraryRuntime.ts:181); mutation publisher [publication.patch](/tmp/sonflash-review-20260912-gv6dc9bs/source/src/app/useAppLearningCoordination.ts:135).

`useLibraryCloudProjection` gọi `controller.update()` khi `cards` hoặc `session` thay đổi. Trong phiên authenticated, controller luôn gọi `publication.presentCards(cloud.items)`, dù đó vẫn là chính snapshot cũ. Learning workspace và media hydration cũng công bố thay đổi vào `cards`; effect lập tức có thể thay kết quả ấy bằng `cloud.items` cũ.

**Đã tái hiện:** UI có card revision 2, bookmarked=true, cloud snapshot chưa cập nhật vẫn revision 1/bookmarked=false → controller công bố lại revision 1. Một test khác xóa card khỏi local UI, còn một pending operation → controller đưa card từ snapshot cũ trở lại.

**Tác động:** bookmark/đổi deck/cập nhật thẻ có thể nhấp nháy hoặc trông như không được lưu; xóa offline có thể hiện lại. Một lần thao tác tiếp theo có thể bắt đầu từ dữ liệu hiển thị đã bị lùi. Đây là lỗi projection; bằng chứng này không tự chứng minh cloud write bị mất.

**Kiểm tra:** hai assertion trong `_audit/sync-projection.audit.test.ts` thất bại trên controller được import từ source. Đã lần theo effect `[cards, controller, page, session]` và `setCards` của composition root, không chỉ dựng mô hình độc lập.

**Sửa tối thiểu đề xuất:** chỉ nhận publication từ snapshot cloud mới và hợp nhất với pending/local mutation đang có; không để một thay đổi UI kích hoạt công bố lại snapshot cũ. Sau ACK cũng cần xử lý khoảng trễ trước khi listener thấy revision tương ứng. Không lấy timestamp client làm authority thay revision/epoch.

### N03 — Tab thấy queue rỗng rồi không phát hiện queue mới từ producer khác

**Vị trí:** [đọc pending ban đầu](/tmp/sonflash-review-20260912-gv6dc9bs/source/src/features/librarySession/useLibraryDeviceSync.ts:117); [điều kiện đăng ký flush](/tmp/sonflash-review-20260912-gv6dc9bs/source/src/features/librarySession/useLibraryDeviceSync.ts:249); production subscription [subscribeToDeviceCards](/tmp/sonflash-review-20260912-gv6dc9bs/source/src/lib/deviceSync.ts:744); producer migration [queueCardMigration](/tmp/sonflash-review-20260912-gv6dc9bs/source/src/features/librarySession/ownerLibrarySessionFirebaseAdapter.ts:24).

Effect đăng ký `focus` và interval flush chỉ tồn tại khi `pendingCount >= 1`. Khi queue ban đầu rỗng, tab không đăng ký chúng. `refreshPending` được gọi sau staging của chính replica đó, nhưng queue còn có producer khác: migration lúc đăng nhập hoặc tab khác cùng owner. `subscribeToDeviceCards` là nhánh development; production trả hàm rỗng. Không thấy một subscription durable queue dùng chung để cập nhật count trong hook này.

**Đã tái hiện ở hook:** initial pending=0; producer bên ngoài đổi queue thành 1; focus và tiến fake timers 120 giây → số lần flush vẫn 0. Replica được mock ở ranh giới đọc queue để kiểm tra chính xác việc hook có gọi lại hay không.

**Tác động:** thao tác đã lưu trên máy có thể nằm chờ cho đến khi tải lại, có thêm local edit hoặc một trigger khác. Một tab còn sống có thể không tiếp quản phần chờ sync của tab vừa đóng. Trạng thái UI cũng có thể vẫn cho rằng pending=0.

**Sửa tối thiểu đề xuất:** thông báo queue change sau durable commit; tab nhận thông báo phải đọc lại IndexedDB theo owner. Có thể dùng BroadcastChannel và đường kiểm tra nhẹ khi focus/online; cùng-tab migration cũng cần tín hiệu. Không dùng giá trị queue gửi qua message làm authority, không polling cloud liên tục.

### N04 — Mirror có thể lùi revision dù cloud mutation đã xác nhận

**Vị trí:** [upsertMirroredCardBatch](/tmp/sonflash-review-20260912-gv6dc9bs/source/src/lib/cardMirror.ts:230); caller ghi page [writePage](/tmp/sonflash-review-20260912-gv6dc9bs/source/src/features/librarySession/useCloudLibraryPage.ts:89); full mirror stream [stream mirror](/tmp/sonflash-review-20260912-gv6dc9bs/source/src/features/librarySession/libraryReplica.ts:815).

`upsertMirroredCardBatch` gọi `store.put` cho toàn card mà không so epoch/revision của record đã có. Generation chỉ kiểm tra lần sync nào đang hoạt động, không kiểm tra bản card nào mới hơn trong cùng generation. Hàm có guard `upsertMirroredCardIfNotOlderThan` đã tồn tại, nhưng đường ghi visible page và stream dùng hàm batch không có guard đó.

**Đã tái hiện:** mirror đang complete, card revision 2/translation=new; một page cũ revision 1/translation=old đến sau → mirror trả lại revision 1/old. Dùng module thật và fake-indexeddb.

**Đường có thể xảy ra:** full download đang chạy song song với mutation; hoặc cached page đến sau khi replica đã cập nhật mirror bằng kết quả cloud mới. Không cần thay đổi owner hay epoch.

**Tác động:** bản offline có thể lùi nội dung/progress đã xác nhận. Không có bằng chứng ở đây rằng server bị ghi lùi chỉ bởi thao tác ghi mirror.

**Sửa tối thiểu đề xuất:** version-aware upsert nguyên tử cho đường batch, xử lý rõ pending overlay cùng revision và tombstone; dùng lại nguyên tắc của hàm guarded hiện có. Giữ generation để kiểm soát hoàn tất full mirror, không thay nó bằng revision.

### N05 — Sync thủ công vẫn dùng mirror cũ sau remote delete/edit

**Vị trí:** [syncNow](/tmp/sonflash-review-20260912-gv6dc9bs/source/src/features/librarySession/useLibraryDeviceSync.ts:268); [runMirrorRefresh](/tmp/sonflash-review-20260912-gv6dc9bs/source/src/features/librarySession/libraryReplica.ts:799); freshness [isCardMirrorFresh](/tmp/sonflash-review-20260912-gv6dc9bs/source/src/lib/cardMirror.ts:35).

`syncNow()` gọi `syncMirror(false)`. Replica bỏ qua download khi mirror complete, cùng epoch, dưới TTL 24 giờ và expectedTotal trong mirror lớn hơn hoặc bằng số hiện biết. Điều kiện này không phát hiện sửa nội dung giữ nguyên số thẻ, và chấp nhận cả trường hợp cloud đã ít thẻ hơn sau xóa. Visible-page cache chỉ upsert những card đang thấy, không xử lý toàn bộ remote deletions ngoài page.

**Đã tái hiện:** cloud 2 thẻ → tạo complete mirror → cloud xóa còn 1 → gọi lại chính `refreshMirror(false)` mà Sync dùng. Kết quả trả count=2; thẻ đã xóa vẫn trong mirror. Replica và mirror là source thật, chỉ cloud API được fake.

**Tác động:** bấm sync vẫn có thể giữ bản offline cũ và báo đã lưu số thẻ cũ. Khi mất mạng/fallback, thẻ đã xóa có thể xuất hiện lại. Không phải remote resurrection: dữ liệu cloud không bị tạo lại trong ca này.

**Sửa tối thiểu đề xuất:** phân biệt refresh chủ động với tối ưu cache tự động; nhận remote deletions/version change để invalidate mirror hoặc đồng bộ delta. Đừng tăng tần suất tải cả library để che vấn đề. TTL hết hạn không tự tạo một scheduler: còn cần một trigger refresh sau đó.

### N06 — “Synced” không có bằng chứng đã kết nối được cloud

**Vị trí:** [cache snapshot publication](/tmp/sonflash-review-20260912-gv6dc9bs/source/src/features/librarySession/cloudLibraryPageController.ts:326); [subscribeCardPage](/tmp/sonflash-review-20260912-gv6dc9bs/source/src/lib/cardRepository.ts:301); [getShellSyncStatus](/tmp/sonflash-review-20260912-gv6dc9bs/source/src/components/shell/shellSyncStatus.ts:91).

Controller đặt `cloudUnavailable=false` ngay cả với snapshot `fromCache=true`, và không giữ một trạng thái “đã nhận server snapshot”. Shell suy ra Synced từ online/pending/error. Listener trong `subscribeCardPage` không bật `includeMetadataChanges`, nên thay đổi chỉ ở metadata không được theo dõi đầy đủ để xác nhận server state.

**Đã tái hiện:** gửi cache-only snapshot vào controller thật; navigator được đại diện là online, pending count=0, chưa có server response → shell trả `kind: synced`.

**Tác động:** khi máy còn mạng nhưng Firestore chưa kết nối/đang gián đoạn, UI có thể nói Synced và không hiện đường retry dù chỉ đang dùng cache. Không nên coi `navigator.onLine` là ACK của Firebase.

**Đối chiếu API:** Firebase định nghĩa `fromCache=true` là dữ liệu cache không được bảo đảm là dữ liệu server mới nhất; metadata updates phải opt-in để nhận thay đổi trạng thái liên quan. Nguồn: [Firebase SnapshotMetadata](https://github.com/firebase/firebase-js-sdk/blob/main/packages/firestore/src/api/snapshot.ts).

**Sửa tối thiểu đề xuất:** theo dõi server-confirmed/read freshness và pending writes riêng; bật metadata updates nếu dùng chúng cho trạng thái sync; hiển thị “Using local copy / Checking cloud” khi chưa có xác nhận. Cache vẫn phải cho phép học bình thường.

### N07 — Hàng đợi XP không được phục hồi cùng nút Sync

**Vị trí:** [saveSnapshot](/tmp/sonflash-review-20260912-gv6dc9bs/source/src/features/gamification/useGamification.ts:185); [hết retry và hook return](/tmp/sonflash-review-20260912-gv6dc9bs/source/src/features/gamification/useGamification.ts:220); shell wiring [shellSyncStatus](/tmp/sonflash-review-20260912-gv6dc9bs/source/src/app/useAppLibraryRuntime.ts:171).

Gamification thử save tối đa 3 lần, sau đó chỉ ghi console warning “queued for the next session”. Hook không có listener online/focus và không trả pending/error/retry cho shell. Nút retry sync chỉ nối tới library replica; không gọi lại gamification save.

**Đã tái hiện:** có một XP operation, store reject 3 lần; sau đó store đã có thể save, phát online/focus và tiến 120 giây mà không có reward mới → operation vẫn pending. Hook/controller là source thật, network/store được mock. Năm test gamification có sẵn vẫn pass; chúng kiểm tra giới hạn retry nhưng không kiểm tra phục hồi sau khi mạng trở lại.

**Tác động:** hai thiết bị có thể thấy XP khác nhau, trong khi sync status của card đã tốt. Reward mới hoặc remount có thể kích hoạt một save mới; vì vậy không mô tả đây là mất XP vĩnh viễn.

**Sửa tối thiểu đề xuất:** giữ giới hạn retry mỗi đợt, cho phép reconnect/user retry mở một đợt mới; đưa trạng thái XP pending vào thông tin sync tương ứng. Không thay đổi chính sách thưởng XP.

## 4. Các mục chưa kết luận là lỗi production

**V01 — Adapter có thể đảo thứ tự kết quả nếu transformPage hoàn tất khác thứ tự.** `cloudLibraryPageFirebaseAdapter.ts` khởi chạy mỗi transform bất đồng bộ độc lập, không có sequence fence. Probe `_audit/snapshot-order.audit.test.ts` trì hoãn transform revision 1, cho revision 2 hoàn tất trước, rồi trả revision 1: adapter công bố bản cũ cuối cùng. Tuy nhiên transform thật trong production đi qua cùng queue transaction IndexedDB; probe này không chứng minh các bước đó sẽ hoàn tất đảo thứ tự trong đường production hiện tại. Nhánh development có fetch `/api/device-cards` nên cần kiểm tra riêng. **Giữ là rủi ro contract, không cộng vào 7 lỗi đã xác nhận.**

**V02 — Flashcard bị đơ trên Chrome/Vocabulary.** Đã đọc thao tác pointer/click, `isFlipAnimating`, hai timeout fallback 320/500 ms, useGSAP, grid entrance và dialog. Chưa có căn cứ bỏ các fallback hoặc quy mọi animation là leak. Các phép thử không tái hiện được:

- 20 cặp lật trước/sau, cập nhật props cùng card giữa chừng và rê chuột.
- Tạm freeze rồi resume trang Chromium trong lúc lật.
- 5 lần chọn deck qua dialog rồi lật.
- Xóa card khi alert dialog đang mở, remount rồi lật.
- Bộ E2E màn hình thật hiện có, gồm 7 test flashcard và 1 test offline cache.

Các kiểm tra này chạy trên Linux headless Chromium 151; phép thử queue production riêng chạy HeadlessChrome 153. Chúng không tái tạo phiên Chrome, dữ liệu, extension đang cài hoặc mạng thật của người dùng. **Không kết luận lỗi người dùng báo đã hết hoặc không tồn tại.** Những lần load/reset dữ liệu có thể làm trải nghiệm giống thẻ không phản hồi, nhưng chưa chứng minh mối nhân quả với một thẻ bị khóa vĩnh viễn.

Để chốt V02 khi tái phát, bằng chứng cần giữ trước F5: console error, network Firestore/Functions, card ID, body/ancestor pointer-events và visibility, trạng thái dialog/face, có còn click được control khác hay không. Không xóa IndexedDB/localStorage trong lúc còn pending để “thử sửa”.

**Những rủi ro cũ R01–R08:** chưa có đủ phép kiểm tra mới để nâng tất cả thành defect. Review này không thực hiện FSRS replay hai thiết bị, extension service-worker crash delivery, quota settings hay retention vật lý. Giữ trạng thái chưa xác minh của báo cáo trước. Những kiểm tra extension có sẵn pass không chứng minh đã giải quyết các rủi ro ấy.

## 5. Bằng chứng kiểm thử và giới hạn

- 242 test repository hiện có pass: 237 test trong 18 file thuộc librarySession/deviceSync/cardMirror/pendingOperationStore/Flashcard/learning, cộng 5 test gamification.
- 131 test Node của extension pass.
- 8 test Playwright hiện có pass, project chromium, một worker, không retry. Test sync-acceptance hiện chỉ kiểm tra anonymous local cache với navigator.onLine override, không phải E2E Firebase đa thiết bị.
- `vite build` pass; script tạo health metadata và offline service worker pass.
- 8 assertion bổ sung thất bại đúng hành vi baseline, tương ứng 7 phát hiện N01–N07. Chúng là repro/regression chưa có patch, không được ghi thành PASS.
- 1 assertion bổ sung về thứ tự snapshot cũng thất bại, nhưng chỉ là probe hợp đồng có barrier, nằm ở V01.
- N01 có xác minh bổ sung 10/10 trial bằng production-compiled module với storage thật trong Chrome.
- Node kiểm thử v22.22.3; package versions lấy từ lock đã cài: React 19.2.5, Firebase 12.18.0, Vitest 3.2.7, Vite 6.4.3, Playwright 1.62.1, GSAP 3.15.0. `npm ci --ignore-scripts --no-audit --no-fund` ban đầu chạy bằng Node 24 và báo engine warning; toàn bộ test/build chạy bằng Node 22. Không dùng kết quả cài dependencies như một security audit.

Không chạy Firestore emulator, full verify, toàn bộ functions suite, authenticated production E2E, dependency audit hay profiler thiết bị người dùng. Không có patch/merge nên không tuyên bố các gate trước merge đã hoàn tất.

Một preflight E2E ban đầu thất bại do config thử nghiệm đặt cwd ở `_audit`; đã sửa riêng cwd của harness, rồi 8 test chạy qua. Vite dev dependency scanner cũng báo ENOENT đối với virtual AppRuntime entry; dev runtime vẫn phục vụ trang và production build chạy được. Không dùng những lỗi harness/dev này làm bằng chứng cho triệu chứng production.

## 6. Thứ tự xử lý đề xuất

1. N01 trước: đóng đường reader hồi sinh pending operation; giữ regression actual storage/Chrome.
2. N02 + N03: đảm bảo UI hợp nhất được local operation và mọi producer đều đánh thức sync đúng owner.
3. N04 + N05: mirror không được lùi revision và manual sync phải phản ánh remote delete/update.
4. N06 + N07: trạng thái hiển thị trung thực và retry bao gồm queue liên quan.
5. Giữ V02 thành việc cần trace khi tái phát; không sửa animation theo phỏng đoán.

A01 của audit trước vẫn nên được ưu tiên trong đợt sửa liên quan integrity của mutation. Không có thay đổi chính sách XP, migration dữ liệu production, deploy hay PR trong lần review này.

## 7. File bằng chứng

Các file nằm cạnh báo cáo này:

- `source-manifest.json`, `environment-and-integrity.json`: SHA và kiểm tra 791 file source gốc.
- `baseline-targeted.log`, `audit-xp-reconnect.log`: kết quả 242 test hiện có và repro XP riêng.
- `extension-baseline.log`: 131 test extension.
- `baseline-e2e.log`: 8 test Chromium; `baseline-e2e-preflight.log`: lỗi setup ban đầu.
- `baseline-build.log`, `build-metadata.log`: build và metadata.
- `audit-sync-repros.log`: N02 và probe V01.
- `audit-pending-race.log`, `production-queue-chrome.json`, `production-queue-chrome-snapshot.txt`: N01.
- `audit-pending-notification.log`: N03.
- `audit-mirror-repros.log`: N04, N05.
- `audit-cloud-health.log`: N06.
- `browser-probe.json`, `browser-dialog-probe.json`: các ca lật/dialog chưa tái hiện lỗi.
- `source/_audit/`: các test, browser fixtures và config kiểm thử bổ sung. Source sản phẩm nằm trong archive riêng, không phải working tree đang chỉnh dở.

Chạy lại từng probe từ thư mục `source` bằng `/usr/bin/node node_modules/vitest/vitest.mjs run _audit/<tên-test> --reporter=verbose`. Các assertion N01–N07 hiện được viết theo hành vi mong muốn, nên baseline đang đỏ. Probe V01 có giới hạn riêng như đã nêu; không tự coi mọi test đỏ là production defect.
