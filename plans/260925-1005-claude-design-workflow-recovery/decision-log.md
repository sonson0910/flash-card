# Decision log

## 2026-09-25 — Bắt đầu thực thi bằng đội Luna

- User yêu cầu dùng tối đa 10 agent GPT-6 Luna, reasoning max; controller giám sát và verify. Đã giao 8 lane độc lập cho phase 01. Runtime từ chối tạo agent thứ 9 với `agent thread limit reached`; luân chuyển agent đã xong khi cần, không đổi model để lấp chỗ.
- Giữ nguyên scope mọi màn/workflow Canvas. Chỉ demo chọn hướng không thành route. Không deploy hoặc thao tác dữ liệu cloud.
- Baseline HEAD: `8d1ec44e3af7e08e45b90454c887055a902ef7d2`, branch `feat/ui-redesign`. 244 dirty/untracked files ban đầu được ghi path/hash trong `evidence/implementation-start-ledger.json`; không reset hoặc stage toàn repo.
- Phase01 đang làm. Năm lane đọc nguồn Canvas theo partition có ownership; một lane dịch hai catalog vi; một lane lập ledger; một lane chạy baseline checks. Controller giữ extraction, tích hợp, review và quyền commit theo scope đã chốt.
- Kết quả check, ngoại lệ và commit sẽ được ghi sau khi có bằng chứng; chưa xác nhận phase 01 hoàn tất.

## 2026-09-25 — Kết quả nền và hợp đồng để mở lane tiếp theo

- 122/122 board/component đã có mapping, 449 action trỏ tới task tồn tại; 219 artboard vẫn nằm trong inventory. Hash 456 source/reference files không đổi. Ledger 244 path khớp snapshot đầu; source chỉ đổi 5 file giao diện và 9 catalog thuộc i18n đã giao.
- Sau sửa i18n: 77 focused tests đạt; controller chạy lại i18n check, TypeScript lint, build và bundle đều exit 0. Initial JS 70,088/71,000 byte gzip. Baseline core trước sửa ghi 1,950 đạt/7 lỗi; không gọi core đã đạt. Functions còn 1 lỗi validation; Rules 65/65 đạt; integration 37/38 với 1 timeout, retry hẹp 2/2 đạt và giữ nguyên timeout. Chi tiết trong báo cáo baseline.
- R9: `decisions.md` và roadmap phase 01 chốt optional pair cấp deck, giữ schema v2. Plan 0906 đang pending đề xuất per-card khác phạm vi. Không mở rộng wire per-card để thỏa fixture không thể đi qua parser; legacy/mixed thiếu metadata phải giữ unknown, metadata target được contract chấp nhận vẫn giữ. Validator phải thống nhất với hợp đồng language code, từ chối tên như `english`.
- Phase 02.4 yêu cầu giữ AI disclosure: `origin` chỉ có enum `ai/manual`; lane contract sẽ bảo toàn giá trị an toàn này, với validation/projection/fingerprint/migration và test tương ứng, không kèm dữ liệu riêng. UI lấy ngày tạo/hết hạn từ public metadata thật; không bịa hoặc lộ danh tính tác giả khi public contract chưa có.
- Friends giữ required task 15.5; course switcher thật giữ task 10. Shell 03 không đổi nhãn Progress thành Friends hoặc bịa cặp ngôn ngữ để giả đã tích hợp. Ngoại lệ mốc sớm phải ghi cụ thể; final 13 vẫn yêu cầu hoàn tất chúng.

## 2026-09-25 12:29 — Owner chốt hai quyết định

- Quota tính khi AI tạo xong; hủy preview vẫn tính, Save không tính thêm. Giữ receipt/operation hiện tại, không đổi thành reserve/refund theo Save.
- Cho phép code và test local phase 08–10 trước G1. Không deploy hoặc mở cho người dùng; G1 và migration vẫn là gate phát hành riêng.

## 2026-09-25 — Đóng phase 01

- Hoàn tất baseline, source/action mapping và fixture contract. Không xác nhận các màn đã giống Canvas: đây là bằng chứng chuẩn bị cho các phase triển khai.
- Ba finding review i18n đã sửa: giữ chip `Lv`, tên `Crystal Star` và signature `LUMI · LINK`; aria và placeholders đầy đủ. 77 focused tests, i18n check, lint, build, bundle và diff check đạt. Controller kiểm lại source ba điểm sửa; build cuối có initial JS 70,081/71,000 byte gzip.
- Các lỗi R9 đã được ghi rõ và giao phase 02; baseline core/Functions chưa đạt, không đổi nhãn thành PASS. Timeout integration đầu tiên được giữ trong log cùng lần retry hẹp đạt.
- Commit phase 01 chỉ gồm hồ sơ baseline, kế hoạch và reports được chỉ định. Các sửa i18n gắn với DOM từ patch UI cũ chưa commit sẽ đi cùng component ở phase 03/04/12; không stage toàn file để vô tình đưa các phần UI chưa nghiệm thu vào commit nền. Những sửa này đã có trong worktree và đã verify, không bị bỏ.
- Nguồn/reference Canvas không đổi; không deploy, đổi credentials hoặc ghi cloud. Phase 02 contract/UI và phase 03 navigation/feedback/appearance được mở song song với ownership riêng. Controller giữ runtime integration và global verification.

## 2026-09-25 — Tích hợp phase 02–03 đang thực hiện

- Commit nền là `47a1bdc`. Phase 02 và 03 chưa nghiệm thu; không dùng ảnh dev hoặc focused test để thay gate cuối.
- Preview share dùng translation từ card đã parse và native language từ metadata cấp deck. Không thêm field translationLanguage cấp card vào wire R9. Ngày tạo/hết hạn và AI disclosure lấy từ payload thực; không công khai ownerUid hoặc bịa tác giả.
- Lỗi thao tác share được đưa vào modal; AppRuntime ẩn bản thông báo trùng khi modal đang mở. Retry giữ action import/revoke tương ứng.
- Kiểm tra lại đường lỗi: `main.tsx` dùng AppErrorBoundary, `App.tsx` dùng AppRuntimeBoundary. Hai đường phục hồi được giữ, dùng panel trình bày chung; không thay bằng boundary không được gọi.
- UndoToast chưa có producer trong app. Chưa coi Undo đạt hành vi. Phải giữ dữ liệu lịch ôn và owner/epoch khi khôi phục; không dùng adoptShared vì nó không phải hợp đồng restore và có thể cộng XP.
- Expired session cần tín hiệu auth thật, phân biệt offline và sign-out chủ ý; lane identity sẽ bổ sung contract rồi controller nối recovery UI. Không dùng bộ đếm giờ giả hết phiên.
- Controller mở một Vite dev server để kiểm bố cục trong lúc code: `npm run dev`, PID `3412232`, port `3000`, worktree hiện tại; đã đóng bằng SIGTERM sau khi kiểm. Ảnh `evidence/in-progress-shell-classic-light.png` chỉ là ảnh kiểm tra header khi workspace đang loading; không phải bằng chứng ready state hoặc production build.

## 2026-09-25 — Kiểm tra tích hợp giữa phase 02–03

- Phase 02 focused: 76 client/intake/Rules-source tests và 96 Functions tests đạt; Functions lint đạt. Root chạy `npm run test:rules`: 65 Rules tests và 38 Functions integration tests đạt, exit 0; log `evidence/phase-02-rules-integration.log`. Hai ca concurrent shared-deck đạt trong timeout gốc. Emulator đã dừng, các port 8080/9099/4400/4500 trống.
- Root thread authentication recovery qua LibrarySession và AppRuntime. 19 tests của projection/session/library contract đạt, gồm kiểm giữ owner và pending writes nhưng không cấp epoch khi mất phiên. 3 tests của runtime boundary/deferred fallback đạt sau khi nối panel thật.
- Root nối WorkspaceLoadingPanel vào ba Suspense callers và dùng ApplicationErrorPanel trên cả hai đường lỗi. Runtime error đặt trên viewport để không bị nằm dưới landing sau callback phục hồi. Chưa xác nhận bundle mới đạt ngân sách.
- Ảnh `in-progress-nav-*` lấy từ Vite dev session `89688`, port 3000; session đã dừng. Đây là ảnh kiểm từng vùng, không phải artifact build hoặc visual PASS. Sau đó nhãn Crystal mobile `Goals` được sửa lại thành `Paths` cho đúng route hiện tại; phase 10 phải nối cả destination và nhãn Goals thật. Friends tiếp tục thuộc task 15.5.
- Source review phát hiện ApplicationErrorPanel thiếu hình cảnh báo/Lumi, sai typography và bố cục nút so với SystemStates/AnimeSystem. Đã giao sửa; tests đạt không thay cho điều kiện đối chiếu Canvas. Chưa đóng phase 02 hoặc 03.

## 2026-09-25 — Review hành vi trước gate cuối

- Review độc lập phát hiện language code dài hơn 16 ký tự bị cắt ngắn trước validation và props cũ trong share tests. Đã sửa; Functions input validation 36/36, client share/overlay 28/28, migration 43/43 đạt. Giữ lịch sử finding trong report; chưa gọi lint/core toàn phase đạt.
- Session recovery phải chặn cả ghi profile deck tự động và chuỗi mutation đang chạy. Đã gate seed theo epoch, kiểm lại quyền ghi và đúng owner sau await. Root bắt thêm ca A→B khi B có quyền ghi; đã bổ sung guard và assertion không tiếp tục remove/patch/ack của A. Suite liên quan đạt 34/34.
- Undo giữ nguyên CardData và lịch ôn; chỉ cung cấp sau receipt xoá thành công hoặc hàng đợi durable. Root nối producer, publication Library/Practice và facade; đổi owner ẩn toast cũ. Khôi phục không đi qua shared-card adoption, không thêm XP hoặc tính quota. Review độc lập và test browser xoá → Undo → reload vẫn đang chạy/chờ, chưa nghiệm thu.
- Không bỏ thinking Lumi chỉ vì dự đoán bundle vượt ngân sách. Đã giữ asset 110px theo AnimeSystem, thêm chuyển động nguồn và tôn trọng Lumi off/reduced motion. AppFeedback chứa Undo trong cùng stack thay cho hai fixed siblings; tránh chồng nhau và không chừa khoảng trống khi không có Undo.
- Lint tích hợp đầu tiên exit 2: phát hiện inference fixture, hợp đồng Promise của delete và các type chưa hoàn tất trong learning/deck. Log được giữ tại `evidence/phase-02-03-integration-lint.log`; đang sửa và chạy lại, không đánh dấu lượt lỗi là PASS. Root facade/projection/library checks đạt 19 tests; hai assertion markup của boundary/loading đã cập nhật theo accessible text, chạy lại 3/3 đạt.
- Fixture shell/share có artifact riêng và config Playwright port 4176. Main config không chạy nhầm suite đó với artifact app port 4173; suite riêng là gate bắt buộc, không phải test được bỏ qua. Chưa có build/Canvas visual PASS cuối.

## 2026-09-25 — Sửa các lỗi phát hiện bằng browser và Canvas

- Browser preflight shell/share lần đầu: 2 đạt, 8 lỗi. Sau sửa fixture thiếu shell stylesheet, await các thao tác thật và lỗi pointer-events của Undo, lượt đầy đủ đạt 16/29; 12 ca mobile báo vùng cuộn share dialog không dùng được bằng bàn phím, một ca đóng incoming dialog chưa trả focus. Log lỗi được giữ; chưa coi suite đạt. Root đã thêm vùng cuộn có thể focus; focus return đang được điều tra.
- Browser trên artifact app thật đã đạt xóa → Undo → reload, giữ đầy đủ card và lịch ôn. Lượt đầu test đọc nhầm cache legacy đã được app di chuyển; lượt sửa kiểm tra cache có owner/version và giữ kiểm tra reload, đạt 1/1. Hai log: `evidence/phase-03-undo-browser-preflight.log` và `evidence/phase-03-undo-browser-retry.log`. Chưa thay cho kiểm tra cloud Undo.
- Review phát hiện Undo offline có thể khôi phục card nhưng không cập nhật category facets khi queue được gửi lại. Chốt marker `restore: true` đi cùng operation bền; category lấy từ canonical card và tăng trong cùng transaction khi card thực sự được tạo. Không tăng khi card vẫn tồn tại trên cloud hoặc khi replay. Bỏ delta restore riêng ở client để tránh đếm đôi. Backend và adapter đang triển khai/test; chưa đóng finding.
- Restore không gọi Gemini, không cộng XP và không tính thêm quota AI. Giữ giới hạn chống lạm dụng createCard 120 lần/giờ; nếu giới hạn này từ chối, operation vẫn nằm trong queue để retry. Sửa diễn đạt “không tính quota” trước đó thành “không tính thêm quota AI”.
- So trực tiếp ảnh Canvas phát hiện thiếu vùng empty Library, caught-up Today, offline và lỗi sync. Các vùng được giao tích hợp với callback/dữ liệu thật; không dùng số thẻ/ngày ôn mẫu để giả dữ liệu cloud đầy đủ. Today pool hiện có giới hạn nên không được tuyên bố ngày ôn kế tiếp của toàn bộ thư viện; luồng lấy thêm 5 từ mới vẫn thuộc phase 05.
- Preflight build hoàn tất nhưng bundle check lỗi CSS: initial CSS 210.170 B raw/31.317 B gzip vượt 206.000/29.500; initial JS 70.925/71.000 B gzip. Không nâng budget. Root chuyển stylesheet shell sang lazy AppRuntime, giữ loading/retry và shared tokens trong stylesheet eager nhỏ; đang chờ build xác minh.
- So ảnh share Crystal phát hiện typography và hình nút chưa đúng dù frame có chamfer. Đã giao sửa theo source Kanit/Fraunces, giữ disclosure/quyền riêng tư/hạn link thực. Phase 02 và 03 vẫn chưa nghiệm thu hoặc commit.

## 2026-09-25 — Gate dữ liệu và so hình vòng tiếp theo

- Transaction khôi phục card/facets đã qua emulator thật: `evidence/phase-03-restore-rules-integration.log`, 65 Rules tests và 39 integration tests đạt, exit 0. Replay không tăng facets lần hai; không ghi analytics capture cho restore. Receipt restore nội bộ có thể qua TTL công khai để giữ hàng đợi offline bền, nhưng vẫn từ chối timestamp tương lai sai lệch. API cập nhật facets công khai giữ TTL cũ.
- Sau tách CSS eager/lazy, build và bundle đạt: `phase-03-css-split-build-retry.log`, `phase-03-css-split-budget.log`. Initial JS 70.922/71.000 byte gzip, CSS 29.416/29.500. Đây là artifact giữa kỳ, trước các sửa visual tiếp theo; cần build cuối, không nâng budget.
- Lượt fixture mới đạt 20/31. Mười ca lỗi contrast thật (Empty Library classic dark, share incoming classic light); một ca marker callback fixture sai prefix. Đã giao sửa màu scoped có ghi ngoại lệ accessibility và sửa callback; không giảm assertion/axe. Ảnh 220 trạng thái giữ ở `artifacts/recovery-shell-share-20260925-1430/`; log lỗi `evidence/phase-02-03-fixture-final-browser.log` không đổi thành PASS.
- Root so ảnh thực với Canvas phát hiện Today caught-up không có surface/rim, title/button/star sai; toast còn màu/bo góc cũ; Undo Crystal sai surface/button/progress; account menu thiếu composition; Lumi của offline panel che nội dung mobile. Các finding này được giao sửa theo vùng sở hữu. Không dùng các ca axe/behavior đã đạt để xác nhận visual.
- Review còn phát hiện flush replica có thể nhận epoch sau khi mất quyền ghi. Đang thêm capability guard trước/sau await và trước từng writer; giữ pending intent để cùng owner đăng nhập lại. Undo toast được ẩn khi authentication recovery, giữ receipt cho cùng owner; đổi owner loại receipt cũ.

## 2026-09-25 — Kiểm tra lại artifact và quyền phục hồi

- Tách quyền đọc/nhận epoch khỏi quyền publish mutations: retry có thể xác minh epoch ban đầu mà không bị deadlock; mỗi writer vẫn kiểm owner và capability trước/sau await. 73 focused tests của replica/session đạt. Không coi đây là smoke auth cloud/G1.
- Share error có provenance riêng; dismiss chỉ xóa lỗi share/adoption hiện tại, không xóa lỗi generation/spreadsheet mới hơn. 40 tests/3 files đạt. Clear thành công phát publication để bỏ Undo đã vô hiệu; clear thất bại giữ token/toast. Coordinator checks 14/14 đạt; browser Clear mới chưa chạy tại mốc ghi này.
- Catalog cuối đạt extraction/compile/i18n check, 11 catalogs không thiếu VI. Giữ bằng chứng lần stability check lỗi khi source còn di chuyển. Build cuối trước sửa accent Undo đạt: initial JS 70.926/71.000 B gzip, CSS 29.020/29.500; không đổi budget.
- `phase-02-03-verify-core.log` dừng ở root Vitest: 2.057 đạt, hai test catalog timeout 5 giây khi chạy đồng thời build/browser. Chạy riêng cùng timeout gốc đạt 25/25 (`phase-02-03-catalog-timeout-retry.log`); đang chạy lại gate tuần tự, không gọi lượt lỗi là PASS.
- `phase-02-03-fixture-canvas-browser.log` chưa đạt: classic-dark Undo thiếu contrast; account connecting dùng selector wrapper cũ; một browser page setup timeout. Sửa accent scoped thành `#08667b` và selector tới status strip thật; không tắt axe hoặc giảm assertions. 278 PNG giữ ở `artifacts/recovery-shell-share-20260925-1515/`; các state sau điểm lỗi còn thiếu ảnh mới.
- Goal recovery được đặt lại cho toàn bộ kế hoạch hiện tại, giữ quyền code/test local 08–10 và điều kiện không deploy/push/cloud. Phase 02–03 vẫn chưa commit hoặc nghiệm thu.

## 2026-09-25 — Gate tuần tự và bản commit độc lập

- `phase-02-03-verify-core-retry.log` đạt, exit 0: 230 file/2.059 web tests, 27 file/287 Functions tests, 65 Rules tests và 39 Firestore integration tests. Các integration tests bị skip ở lượt không emulator được chạy riêng đầy đủ trong cùng gate; không tính skip là PASS. Emulator đã dừng.
- Main artifact sau sửa Canvas đạt build/bundle; initial JS 70.923/71.000 byte gzip, CSS 29.090/29.500. Main browser đạt 35/39: xóa → Undo → reload và Clear vô hiệu Undo đều đạt. Ba lỗi do test còn dùng nhãn/menu cũ hoặc chưa chờ render; một lỗi sản phẩm là logo thu hẹp dưới 44px ở 360px. Sửa vùng bấm và chạy lại 15 ca liên quan đạt 15/15 (`phase-03-main-shell-browser-retry.log`); giữ log lỗi gốc.
- Candidate phase 02 được tạo bằng alternate index từ `47a1bdc`, giữ nguyên real index/worktree và không cuốn thay đổi phase 03–05. Tree ban đầu `402fab2137116f8b929a9cb7fe72405da07aba45` có 28 paths; bản export độc lập đạt lint và 106 focused tests. Extraction phát hiện `components.po` cũng chứa các ID share; đang cập nhật cả hai catalog owners trong bản export rồi kiểm lại. Chưa coi tree ban đầu là bản đã nghiệm thu.
- Fixture bổ sung menu Sync/Export/Clear có callback, kiểm hàng cuối ở màn hình thấp, mất phiên và retry có busy state. Sửa macro Lingui của fixture thành literal, locator theo trạng thái nút, khôi phục viewport sau kiểm menu và chờ browser cuộn tới cuối. Không giảm assertion nội dung/footer hoặc tắt axe. Bộ fixture đầy đủ vẫn đang chạy tại mốc này.
- Owner chọn chỉ mục course riêng cho phase 08, giữ nguyên thẻ gốc. Chỉ chuẩn bị code/test local: bootstrap bounded, generation hoàn tất, mutation mirror và owner/epoch guards. Không chạy index bootstrap hoặc migration cloud; chưa được mở course query khi chỉ mục chưa đầy đủ.

## 2026-09-25 — Bản phase 02 độc lập và sửa nguồn Canvas

- Export phase 02 riêng đã đạt `verify:core` sau khi bổ sung Git index và Functions build cho setup test: 226 file/1.966 web tests, 27 file/284 Functions tests, 65 Rules tests, 38 Firestore integration tests. Log `evidence/phase-02-isolated-core-retry.log`; giữ log setup fail trước đó, không gọi lượt lỗi là PASS.
- Sau sửa share theo nguồn riêng, 35 tests của overlay/controller, i18n check, build và bundle đều đạt. Initial JS 70.090/71.000 B gzip, CSS 28.696/29.500. Candidate source tree `d07752a5baf369084dbee7e287dbc74c116f2f7b` có 31 paths; real index vẫn trống. Catalog phải cập nhật cả shell và components do cùng source được extract vào hai owner.
- Sửa mapping Canvas: Crystal share/share-in nằm trong `AnimeDlgLibrary`, không dùng generic `AnimeDlgManage` thay nhánh riêng. `AnimeDlgLibrary` có ownership 02/04; `AnimeDlgStudy` có ownership 04/05/11 theo create/edit, practice và tutor/stream. Giữ tổng board/artboard, không bỏ màn vì dùng chung component nguồn.
- Fixture trước sửa đạt 32/33; ca classic-dark EN 390 timeout đã chạy lại với timeout gốc và đạt 1/1. Chưa gọi suite đầy đủ sạch hoặc visual cuối đạt. Review ảnh phát hiện nav che Clear tại viewport thấp, offline Crystal cards bị giãn và count lỗi sync nằm trong vùng cuộn; đã sửa source và thêm hit-test thực, đang tạo artifact mới.

## 2026-09-25 — Tiếp tục sau khi máy khởi động lại

- Máy khởi động lại trong lúc cài dependencies cho export phase 03; tiến trình cũ và các export `/tmp` không còn. Bước install/prebuild bị gián đoạn, không tính PASS. Source worktree, alternate-index trees, reports và logs dưới repo còn nguyên; HEAD vẫn `47a1bdc`, real index trống.
- `/tmp` trên host là tmpfs 16 GiB, dùng RAM. Các lượt verify tách riêng tiếp theo dùng ổ đĩa và chạy tuần tự; không khởi chạy đồng thời build, browser và emulator. Đây là điều chỉnh tài nguyên, chưa kết luận nguyên nhân treo máy.
- Lượt fixture specific-Canvas bị dừng sau 4 đạt/3 lỗi locator/1 interrupted/25 chưa chạy. Sửa locator phân biệt vùng dọc với sample rail. Preflight sau đó Classic mobile đạt, Crystal thất bại vì test bắt buộc cuộn dọc trong khi nội dung mới vừa viewport; giữ kiểm vùng cuộn nếu overflow và kiểm toàn bộ nội dung visible nếu không overflow.

## 2026-09-25 — Nghiệm thu shared deck và chốt phase 02

- Accepted source tree `87546c9d08aa99b31443c756d33f0cde52a0bac1`: 31 source/test/catalog paths. Isolated core đạt 1.966 web / 284 Functions / 65 Rules / 38 emulator tests; frontend delta cuối đạt 35 focused tests, i18n, build và bundle. JS 70.089 B gzip, CSS 28.669 B gzip, trong budget gốc.
- Browser cuối đạt 33/33 (`evidence/phase-02-03-resumed-final-browser.log`); 292 ảnh độc lập giữ tại `artifacts/recovery-shell-share-20260925-1653/`, trong đó 40 ảnh share được map vào CSV. Copy/create/revoke/import/error/retry/cancel/focus đều qua controller thật với adapter test; không gọi Gemini/cloud.
- Classic/Crystal share dùng đúng source riêng. Giữ thứ tự Canvas summary → link → facts → privacy, bổ sung metadata thật và disclosure. Test cũ ép warning trước link đã được cập nhật theo source; nội dung cảnh báo vẫn bắt buộc và được kiểm reachability. Khôi phục màu chữ phụ đã qua contrast sau khi phát hiện bản sửa style làm Classic Light fail; lượt 28/33 trước đó không được coi là PASS.
- Các ngoại lệ dữ liệu và accessibility được ghi cụ thể trong [báo cáo nghiệm thu](../reports/verification-260925-1653-shared-deck.md). Card-pair persistence qua intake/reload/re-share giữ nguyên task 08.2. Không deploy; phase 03 tiếp tục gate bản tách riêng.
