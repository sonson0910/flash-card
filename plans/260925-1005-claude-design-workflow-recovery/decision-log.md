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

## 2026-09-25 — Nghiệm thu shell/system và chốt phase 03

- Phase 02 đã commit `6098ada`. Source phase 03 tách riêng: `dd8ddbf5abdc6acca4a6a2fa1e5dbbff5023a4e9`, không chứa Library/daily-session layouts tương lai hoặc code phase 08 đang viết song song.
- Isolated core đạt 2.057 web tests, 287 Functions tests, 65 Rules và 39 emulator integration tests. I18n ổn định/đủ 11 catalogs. Build/bundle đạt: initial JS 70.928 B gzip, CSS 29.496 B gzip, 102 chunks. CSS còn 4 B headroom; không nâng budget. Chuyển nguyên các declaration chart/achievement sang shell lazy để bỏ 189 B vượt trước đó.
- Browser app riêng: 37/41 đạt lần đầu, bốn ca lỗi test đã sửa và đạt 4/4 khi chạy lại (Undo selector của layout phase 03; OS motion khác tùy chọn manual). Giữ đầy đủ assertions Undo/reload/Clear/focus. Fixture shell/system/share đạt 33/33. Không gọi các lượt lỗi trước đó là PASS.
- Review ảnh mới đóng cả ba finding: offline card bị Lumi đè, pending count bị cắt, Clear bị bottom nav che. 24 ảnh app riêng giữ tại `artifacts/recovery-shell-isolated-20260925-1710/`; matrix system/account/feedback tại `artifacts/recovery-shell-share-20260925-1653/`.
- AnimeMobile/AnimeMotion/MotionStoryboard chỉ đóng phần shell/common motion của phase 03. Card continuity, edit sheet, recap, onboarding, Goals/Friends và workflow kinh doanh giữ task tương ứng. [Nghiệm thu và giới hạn](../reports/verification-260925-1710-shell-system.md).
- Bản checkout verify được giữ nguyên, chuyển sang `.worktrees/verification-phase03` để root không thu thập code/test của hai checkout. Các server/emulator đã dừng. Lane phase 08 tiếp tục local trên file sở hữu riêng; không deploy/push/cloud.

- So ảnh cuối phát hiện Classic Appearance còn checkbox native. Đã sửa theo track 42×24/knob 18px của ReminderSettings; giữ label row ≥44px. Build/bundle cuối đạt JS70.930/CSS29.496 B gzip; 22/22 Settings và 16/16 matrix có focus/hit-test controls cuối trang đạt. 32 ảnh thay thế ở `artifacts/recovery-settings-20260925-1720/`; CSV cuối có 292 rows. Core source không đổi trong sửa CSS này.

## 2026-09-25 — Mở phase 04 sau commit shell/system

- Phase 03 đã commit `b6eda01`; các thay đổi phase 04–05 và 08 đang dở được giữ ngoài commit. Bản source/gate và giới hạn nghiệm thu nằm trong báo cáo phase 03.
- Bắt đầu sửa Create CTA trước: controller staged preview và dialog Canvas có owner riêng, dùng cùng intake session; root nối runtime và POS request. Không persist/XP/facets trước Lưu; quota AI giữ quyết định owner.
- Mở các lane file riêng cho Library, Flashcard, EditSheet và management dialogs; phase 08 tiếp tục contract/repository/course-profile. Root giữ shared runtime, Rules, config, catalogs và commit. Không chạy song song build/browser/emulator; focused tests nhận lượt riêng.
- Phase 04 còn đang triển khai, chưa task nào được đánh dấu đạt. Không deploy/push/cloud.

## 2026-09-25 22:26 — Nối tiếp lane creator_controller/creator_dialog sau gián đoạn quota

- Sửa 5 file test lỗi gốc: `CreateCardDialog.test.tsx` trống HTML vì thiếu `i18n.activate('en')` và vì hàm `translate()` gọi `i18n._(descriptor.id, values)` (chuỗi id) thay vì truyền descriptor để có fallback message — không phải lỗi Portal SSR như giả định ban đầu; sửa `translate()` thành `i18n._(values ? { ...descriptor, values } : descriptor)`. `LibraryDialogOverlays.test.tsx` và `SpreadsheetImportDialog.test.tsx` mới đúng là lỗi Portal thật (Radix `Dialog.Portal`/`AlertDialog.Portal` không render trong `renderToStaticMarkup`); thêm `src/testing/radix-dialog-passthrough.tsx` làm mock dùng chung cho cả ba file thay vì mock riêng từng nơi.
- `CreateCardDialog.tsx` có bug thật: khi `mode: 'manual'` đã có `model.preview` (bản nháp thủ công đã lên preview), UI vẫn hiện lại form nhập thô thay vì preview có nhãn "Manual draft". Đổi thứ tự điều kiện render để `model.preview` được ưu tiên trước `manualMode`, ẩn khối "Regenerate" (hành động AI) khi đang ở preview thủ công.
- `useCardIntakePort.test.ts`: assertion `-1 < -1` không phải regression hành vi — controller đã tách `persistCards` (wrapper retry-safe theo key) khỏi `persistCardsInternal` (thân logic cũ), nhưng test cũ vẫn cắt chuỗi nguồn theo tên hàm `persistCards`. Sửa biên cắt sang `persistCardsInternal`/`persistCards` mới; hành vi publish-trước-cloud-settle vẫn đúng thứ tự.
- `stringScanner.test.ts`: chuyển 13 chuỗi cứng trong `EditCardDialog.tsx` sang `<Trans>`/`msg()` theo namespace `library.edit-card.*`.
- Phát hiện `src/features/intake` và `src/features/importExport/SpreadsheetImportDialog.tsx` chưa từng nằm trong `lingui.config.ts` (catalog `library`) — toàn bộ chuỗi `library.create-card.*`/`library.import.*` sẽ không bao giờ được extract. Thêm hai đường dẫn vào catalog `library`. Khi extract lộ 3 xung đột id giữa lane của tôi và `LibraryTools.tsx` (không thuộc quyền tôi): `library.deck.name-label`, `library.deck.create`, và nội bộ file `library.import.failed` dùng hai message khác nhau. Đổi id phía file tôi sở hữu (`library.deck.creation-name-label`, `library.deck.creation-submit`, `library.import.status-failed`/`library.import.summary-failed`), không sửa `LibraryTools.tsx`.
- Dịch tay 204 msgid còn thiếu tiếng Việt trong `library.po` (phần lớn là nợ cũ từ các lane khác chưa từng chạy `i18n:check`, cộng thêm toàn bộ chuỗi mới của `intake`/`importExport`). `npm run i18n:check` đạt: 11 catalog, extraction ổn định, en/vi đủ 421/421 cho `library`.
- `npx tsc --noEmit` sạch, `npx vitest run src/features src/components src/app src/i18n` đạt 175 file/1488 test, không có lượt fail mới. `npm run build` đạt.
- `npm run verify:bundle` còn một ngoại lệ: `total JavaScript raw: 2,710,188 B exceeds 2,700,000 B` (vượt 10,188 B / 0,38%). Initial JS gzip 70.925/71.000, initial CSS gzip 29.422/29.500, total JS gzip 840.300/860.000 và toàn bộ chunk-budget khác đều đạt. `CreateCardDialog.tsx`/`.css` và `EditCardDialog.tsx` đều là file mới/mở rộng lớn chưa từng qua gate này (chưa commit từ trước phiên này); mức vượt tương đương đúng quy mô hai file đó. Không sửa `vite.config.ts` (ngoài quyền sở hữu) và không nới ngân sách. Đề xuất root cân nhắc `manualChunks` gộp `@radix-ui/react-dialog`/`@radix-ui/react-alert-dialog` (đang lặp lại trong ≥6 chunk riêng: CreateCardDialog, EditCardDialog, LibraryDialogOverlays, SpreadsheetImportDialog, AiDialogueModal, WordExtractorModal, AppOverlays, LibraryCardGrid, LibraryTools, Flashcard) trước khi đóng gate cuối.
- Runtime wiring Create CTA (`src/app/AppRuntime.tsx`, `useAppLearningCoordination.ts`) đã được lane creator_controller nối sẵn trước khi bị gián đoạn (`AppDeferredCreateCardDialog` nhận đúng `model`/`actions`/`deckOptions` thật từ `intakeSharing`/`intakeActions`/`customDecks`); không cần sửa thêm, chỉ xác nhận qua tsc/test.
- Không có bằng chứng trình duyệt/Canvas trong lượt này (không chạy Playwright/emulator theo yêu cầu). Giữ nguyên toàn bộ checkbox phase 04 ở trạng thái chưa tick vì mọi task đều cần đối chiếu hình ảnh Canvas mà lượt này chưa làm.

## 2026-09-26 — Phase 12A (12.1, 12.3–12.5): landing/pilot surfaces, không chạm browser

- 12.1: `ClassicLandingHero` (tách khỏi `LandingPage.tsx`) đổi thẻ demo hero từ card tĩnh sang flip thật (`role="button"`, `aria-pressed`, `rotateY(180deg)` qua state `flipped`, bàn phím Enter/Space, tôn trọng `prefers-reduced-motion` qua `perspective`/`transition: 'none'`) khớp hành vi `onClick={{flip}}` của `LandingScreen.dc.html`; mặt trước giữ headword/pronunciation + "Tap to reveal the meaning", mặt sau lộ nghĩa/ví dụ/caption sẵn có. Sửa lỗi tràn đè CTA "Đăng nhập" tại 390px trên theme Crystal: `landing-page.css:58` từng có `margin-top: -26px` kéo `.crystal-card-stage` (chứa Lumi/collage) đè lên nút sign-in đo được ở audit (`current-landing-390.png`, CTA y491–539 vs Lumi từ y490); đổi thành `margin-top: 0` cộng `row-gap: 28px` trên `.crystal-landing-hero` ở breakpoint ≤900px. Không đổi bố cục Crystal desktop/ribbon/collage (đã khớp `AnimeLanding.dc.html`, không có flip theo Canvas nguồn) và không đụng LandingSales/AnimeLandingSales/LangLanging (12.2, ngoài phạm vi).
- 12.3: i18n hoá toàn bộ `UpgradeDialog.tsx` (billing), `AccountDataSection.tsx` (account) và `ReportCardDialog.tsx`/`cardReportService.ts` (cardReport) — trước đó cả ba hardcode 100% tiếng Việt, catalog `billing.po`/`account.po` rỗng đúng như audit ghi ("billing/account catalogs hiện 0"). Số/tiền dùng `formatNumber` theo locale UI thay vì `toLocaleString('vi-VN')` cứng. Giữ nguyên chuỗi xác nhận xóa tài khoản `XÓA TÀI KHOẢN` cố định mọi locale vì `functions/src/index.ts:898` so khớp đúng chuỗi này phía server (không sửa `functions/**`); label giải thích xung quanh đã dịch, hướng dẫn gõ đúng cụm tiếng Việt đó dù UI đang ở locale nào.
  - Phát hiện: `src/features/cardReport` chưa từng có trong `lingui.config.ts` (không area nào include thư mục này), nên các message id mới tại đây (`cardReport.*`) sẽ không được `i18n:extract` gom vào catalog nào cho tới khi thêm một dòng `cardReport: ['src/features/cardReport']` vào object `areas`. Đây là sửa 1 dòng, additive, không đụng area của lane khác — nhưng theo giới hạn phiên này (không tự sửa file catalog/config dùng chung ngoài phạm vi), tôi KHÔNG tự thêm; cần root/lane sở hữu `lingui.config.ts` thêm dòng này rồi chạy lại `i18n:extract` + dịch tay `vi/cardReport.po`. Cho tới lúc đó, chuỗi `cardReport.*` luôn hiện đúng `message` mặc định (tiếng Anh) ở mọi locale UI — không lỗi runtime, chỉ chưa dịch.
  - Đã chạy `npm run i18n:extract` (bắt lỗi cú pháp JSX thật ở `AccountDataSection.tsx:67`, thiếu `}` đóng ternary trước `</button>`, đã sửa) rồi dịch tay 100% msgstr còn thiếu trong `vi/landing.po` (2 id mới), `vi/billing.po` (15 id) và `vi/account.po` (16 id). `npm run i18n:check` đạt: "Checked 11 catalogs: extraction is stable and en/vi message coverage is complete." Không đổi catalog của area khác (today/practice/library/progress/catalog/settings đều 0 missing, không do lượt này).
- 12.4: không sửa file — báo cáo `worker-260925-0105-landing-seo-generation.md`/`worker-260925-0105-locale-navigation.md` đã đóng domain canonical/hreflang/sitemap/locale nav trước lượt này; chạy lại `scripts/locale-pages.test.mjs` qua `vitest` (không phải `node --test`, script dùng `expect` của vitest) xác nhận 4/4 test còn đạt sau các sửa 12.1/12.3.
- 12.5: thêm `loading="lazy"/decoding="async"/fetchPriority` cho ảnh landing không nằm trên đường LCP (texture nền `train-window.webp`, hai demo card phụ Crystal `crystal-demo-left/right`), giữ eager + `fetchPriority="high"` cho logo header và demo card chính (`crystal-demo-main`) vì các thứ này vẫn trong viewport khởi tạo. Thêm `focus-visible:outline-2 focus-visible:outline-offset-2` cho mọi link Privacy/Terms/Extension trong `LandingPage.tsx` footer + consent và trong `UpgradeDialog.tsx` consent (trước đó chỉ có `underline`, không có focus ring tường minh dù `<a>` vẫn tab-được theo mặc định trình duyệt). Không đổi `index.html`/font `@font-face` (đã `font-display: swap`, tự host, ngoài quyền sở hữu).
- Test mới trong `LandingAssets.test.ts` (4 test) khoá lại 4 hành vi trên bằng string/regex trên source, không cần browser: flip thật có `aria-pressed`/`rotateY`/`onKeyDown`, CSS mobile hết `margin-top: -26px`, ảnh phụ có `loading="lazy"`/ảnh chính có `fetchPriority="high"`, link pháp lý có `focus-visible:outline-2`. `cardReportService.test.ts` đổi 7 assertion từ chuỗi tiếng Việt cứng sang tiếng Anh (thêm `i18n.load('en', {})`/`i18n.activate('en')` theo đúng pattern của `libraryViewModel.test.ts`) vì `reportCardFailureMessage`/lỗi validate giờ đi qua `i18n._(msg(...))`.
- Verify đã chạy trong lượt này: `npx tsc --noEmit` sạch; `npx vitest run src/features/landing src/features/account src/features/billing src/features/cardReport src/i18n` 6 file/87 test đạt; `npx vitest run scripts/locale-pages.test.mjs` 4/4 đạt; `npm run i18n:check` đạt. KHÔNG chạy `npm run build`, Playwright hay emulator (máy đang chạy Playwright của dự án `agentchat` khác và một lượt `firebase emulators:exec` của lane Rules trong chính repo này khi phiên bắt đầu). Chưa có bằng chứng Canvas/trình duyệt cho bất kỳ board nào — checklist phase 12 giữ nguyên trạng thái chưa tick, chi tiết ở báo cáo `fullstack-developer-260925-2240-phase12a-landing.md`.

## 2026-09-26 — Đưa lane course-index/course-profile về trạng thái xanh (phase 08 backend)

- Sửa 19 lỗi TS trong `functions/src/course-profile-contract.ts` (thiếu narrowing kiểu `unknown[]` do `tsc@7.0.2` không loại trừ nhánh sau lời gọi hàm `never`-return; thêm helper `arrayAt`), thêm 8 callable `createCourse/updateCourse/archiveCourse/reopenCourse/setActiveCourse/addGoal/updateGoal/removeGoal` còn thiếu vào `functions/src/index.ts` (parse request, kiểm owner, `consumeBudget` scope `course-profile` 120/giờ, map lỗi qua `toCourseProfileHttpsError`), và xoá biến `building` không dùng trong `functions/test/courseCardIndexPersistence.test.ts:193`. `cd functions && npx tsc --noEmit` và root `npx tsc --noEmit` đều sạch (một lỗi còn lại ở `src/features/intake/CreateCardDialog.tsx` đã được lane intake tự sửa trong lúc lượt này chạy, ngoài phạm vi sở hữu).
- Sửa 5 test Functions sai (không phải code sai): `course-profile-callable.test.ts` gọi `mockReset()` trong loop nên tự xoá call count của chính nó trước khi assert `toHaveBeenCalledTimes(4)` — đổi sang `mockRejectedValueOnce`; `courseCardIndexPersistence.test.ts`'s `advance()` truyền nguyên object kết quả (nhiều field thừa) làm request cho lượt kế tiếp — chỉ truyền `generationId`/`leaseToken`; `courseProfilePersistence.test.ts` dùng `toMatchObject` với mảng 1 phần tử trong khi kết quả thật có 2 course — đổi sang `arrayContaining`. `cardPersistence.test.ts`/`reviewPersistence.test.ts` có mock Firestore chỉ hỗ trợ 2 cấp `collection().doc().collection().doc()`, không đủ cho path 3 cấp `course_query_generations/{id}/cards/{cardId}` — đổi sang factory `collection`/`doc` đệ quy tuỳ ý độ sâu. `cd functions && npx vitest run` 30/30 file, 323/323 test đạt.
- Sửa lỗ hổng thật do reviewer nêu (`reviewer-260925-course-index-contract.md`, P1 #1): đường tạo thẻ trực tiếp qua callable `createCard` tính reservation/identity chỉ theo `normalizedWord`, bỏ qua `language`, nên thẻ `en`/`ko` cùng chính tả sẽ đụng cùng reservation hash và có thể trả nhầm thẻ. Sửa `functions/src/cardPersistence.ts`: `reservationId`/`isMatchingIdentity`/`cardMatchesIdentity`/`isStrictCurrentCard`/`createReservation` nhận thêm `targetLanguage`, dùng hash có tiền tố `targetLanguage+NUL+word` giống Rules/`cardIdentity.ts` khi khác `en`. Thêm test mới `keeps a plain Korean card separate from an English card...` xác nhận `id`/reservation path khác nhau và `targetLanguage` được ghi vào reservation. Ba finding còn lại của reviewer (unsupported-target publish race, practice stale-generation double-check, stale-page repair trigger) hoá ra đã được sửa từ trước bởi lượt Codex bị ngắt (đọc lại `course-card-index-persistence.ts`/`course-card-index-repository.ts` xác nhận), và composite index `targetLanguage` đã có sẵn trong `firestore.indexes.json`; không cần sửa thêm. Finding còn mở duy nhất (publish race khi thẻ unsupported-target được tạo giữa lúc quét trang cuối và lúc publish) được ghi lại, chưa sửa — cần quyết định owner có coi đây là lỗi publish hay hành vi đúng của "loại trừ ngôn ngữ chưa hỗ trợ".
- `firestoreRulesSource.test.ts` outdated: test còn assert canonical/legacy reservation theo bản 2 nhánh cũ, trong khi Rules thật đã được lane ngôn ngữ nâng lên 3 nhánh (thêm nhánh target-scoped cho plain non-English). Sửa assertion dùng `extractRulesBlock` + so sánh chuỗi đã flatten whitespace, giữ đúng ngữ nghĩa 3 nhánh thay vì hạ Rules xuống 2 nhánh.
- Phát hiện lỗi thật nghiêm trọng hơn khi chạy `npm run test:rules` lần đầu cho toàn bộ lane 08: rule `allow update` của `users/{userId}/cards/{cardId}` (tổ hợp `isValidCardUpdate` + `hasValidCardIdentityUpdate` + guard review-field + `canUpdateCurrentCard` có từ trước phase 08, cộng thêm 300 dòng course-index/ngôn ngữ target-aware mới) vượt giới hạn "1.000 expression mỗi request" của Firestore Rules — một PATCH thẻ hợp lệ bình thường (`{bookmarked: true}`) bị chặn `PERMISSION_DENIED`. Nhờ `kongming` xác nhận đây là giới hạn thật (không phải quirk emulator) và định vị: chain cũ đã dùng gần hết 1.000 trước khi có course-index; short-circuit `&&`/`||` có hoạt động đúng nhưng đường thành công không có gì để short-circuit qua. Đã cắt giảm bằng cách đo trực tiếp qua emulator (không suy đoán): nhóm 43 field-guard rời rạc của `isValidChangedCardFields` thành 8 nhóm theo `changed.hasAny([nhóm])` (nhóm không đổi field nào bị bỏ hẳn thay vì luôn trả `true` từng field), thay `wasCanonical` (hasAll 30 phần tử trên dữ liệu cũ) bằng `mapDiff.removedKeys().hasAny(...)` cùng một lần gọi `data.diff()` dùng chung với `changed`, gom một lần gọi `currentLibraryEpoch(userId)` cho toàn chain update (hàm mới `canPatchOwnedCard` bọc `allow update` để có `let epoch` dùng chung cho `isCurrentProtocolCard`/`canUpdateCurrentCard`/mirror-check), và đổi cách chứng minh mirror còn mới từ so khớp 8 field chiếu chiếu (`isCourseIndexProjectionEquivalent`) sang so `sourceRevision` của projection với `revision` mới của thẻ (đã đủ vì Rules của chính hàng chiếu bắt buộc `sourceRevision == getAfter(source).revision`, và `canUpdateCurrentCard` đảm bảo revision tăng đúng 1 mỗi lần ghi).
- Kết quả `npm run test:rules`: 72/73 test Rules đạt (từ 11 lỗi ban đầu xuống 1), cộng 39/39 test integration Functions qua emulator đạt riêng (script gộp `&&` dừng sớm vì bước Rules có 1 lỗi nên phần Functions phải chạy lại tách rời để xác nhận — cùng emulator, không chạy đồng thời). Lỗi Rules còn lại: `keeps language metadata independent from plain identity while preserving immutability` — patch `{bookmarked, revision}` hợp lệ trên thẻ có course-index đúng epoch (không stale) vẫn vượt ngưỡng 1.000 expression khi chain mirror-check chạy nhánh thật (không phải nhánh tắt do stale/absent). Đã cô lập bằng nhiều thăm dò trực tiếp qua emulator: `existsAfter(pointer)` một mình qua được; thêm `existsAfter(projection)+so sánh 1 field` bằng `cardId` (string) qua được; đúng field `sourceRevision` (số/`null`, so với biến trích từ map `source` 40+ field) thì luôn vượt ngưỡng dù đã đưa xuống độ sâu gọi hàm thấp nhất và thử cả default `null`/`0` — chưa xác định được nguyên nhân chính xác (nghi ngờ chi phí so sánh giá trị lấy từ hai map lớn khác nhau, nhưng không đủ bằng chứng để khẳng định). Đây không phải lỗi an ninh (không làm lộ hay ghi sai dữ liệu) mà là rule đang đúng-nhưng-quá-đắt cho đúng một tổ hợp field; không hạ chuẩn xác minh mirror để né vì sẽ mất khả năng phát hiện mirror stale (test `requires exact active and building mirrors for a client card patch` phụ thuộc đúng việc này). Việc sửa tiếp cần tái cấu trúc sâu hơn `isValidCardUpdate`/`isCurrentProtocolCard` hoặc chuyển patch thẻ qua Callable như `kongming` đề xuất — vượt phạm vi lượt này, ghi lại làm việc kế tiếp.
- Không tick checklist 08.1–08.6: lượt này chỉ đưa các lỗi đo được về xanh (tsc/vitest Functions/vitest root subset/test:rules), không xác nhận toàn bộ phạm vi từng mục (ví dụ 08.5/08.6 chưa được chạm tới; export/import của 08.2 chưa kiểm). Chi tiết đầy đủ và lệnh đã chạy ở báo cáo `fullstack-developer-260925-2210-phase08-green.md`.
- **2026-09-26 — Phase 07A (extension), agent extension: 07.1/07.2/07.6 một phần, không tick checklist.** Rebrand hiển thị LingoFlash → SonFlash trong toàn bộ `extensions/lingoflash/**` (manifest, popup, options, bubble trong trang, context menu, README), giữ nguyên mọi storage key/protocol identifier/permission (không đổi `manifest.json` permissions/host_permissions). Thêm Chrome i18n đầy đủ (`_locales/vi`, `_locales/en`, 160 khoá, parity 100%) cho popup/options/bubble/context-menu/floating-icon; mỗi chuỗi dùng `t(key, subs, fallback)` với fallback là đúng văn bản cũ nên toàn bộ 150 test Node hiện có (`extensions/lingoflash/tests/*.node.mjs`) qua mà không cần sửa giá trị mong đợi, chỉ thêm mock `chrome.i18n` đọc trực tiếp `_locales/vi/messages.json` làm nguồn thật duy nhất. Thêm token thiết kế Classic (dark "Midnight Aurora"/light "Ink & Paper") từ đúng `docs/design/sonflash-redesign/canvas/src/tokens.js` vào `design-tokens.css`, self-host Fraunces/Geist/Geist Mono (`design-fonts.css`, copy từ `src/assets/fonts/**` đã có sẵn trong repo) cho riêng hai trang popup/options; bubble trong trang và floating icon giữ font hệ thống để không phải thêm `web_accessible_resources` vào manifest. Options thêm mục Giao diện (sáng/tối/theo hệ thống) cho family Classic. **Chưa làm**: family Crystal Star (không có CSS/asset nào được áp dụng), đối chiếu hình ảnh trực tiếp với Canvas (không dùng trình duyệt theo giới hạn phiên), state `quota`/`loop` của `ExtLoop` (cần dữ liệu AI-quota/weekly-picks thật, ngoài phạm vi 07.6), và một số chuỗi lỗi bảo mật nội bộ sâu trong `background-core.js` (nonce/tab mismatch, forged origin) vẫn còn tiếng Việt cứng — không phải copy UI thường gặp. Thêm hạ tầng due-count thật cho 07.6 (`SYNC_DUE_COUNT`/`GET_DUE_COUNT`/`CLEAR_DUE_COUNT` trong `background-core.js`, relay trong `app-bridge.js`, badge ẩn-khi-chưa-có-dữ-liệu trong `popup.js`) theo đúng khuôn deck-metadata (session-only, theo scope, retire khi đổi scope) — có test mới xác nhận không rò due-count của tài khoản trước sau reconnect/account-switch. Due-count vẫn luôn `null` vì chưa có nơi nào phát `LINGOFLASH_EXTENSION_DUE_COUNT` từ app; việc thêm postMessage đó thuộc `src/features/browserExtension/**`/`src/app/**`, ngoài quyền sở hữu file được giao lượt này (chỉ `extensions/lingoflash/**` + build script) — cần lane khác hoặc lượt sau thêm. Đã thêm/sửa khoảng 45 file (gồm 19 font vendor từ static asset có sẵn trong repo, không tải mạng); cập nhật `scripts/browser-extension-package.mjs` để đóng gói `_locales/**` và font theo đúng graph tham chiếu thật, `scripts/check-browser-extension.mjs` thêm kiểm tra 2 catalog không rỗng. `npm run extension:build` (test + check + build + check --zip) qua sạch. Không chạm `src/features/**`, `src/app/**`, `functions/**`, `firestore.*`, `vite.config.ts`, `package.json` gốc, hay catalog i18n dùng chung. Chi tiết: `fullstack-developer-260925-2240-phase07a-extension.md`.

## 2026-09-26 — owner decisions after the Firebase cost rebuild

- Onboarding starter cards count toward the Free 30-card quota.
- E2E runs the Functions emulator alongside Auth and Firestore.
- Offline: Today blocks starting a session and says a connection is needed; Paths drops the "Available offline" claim.
- The Firestore persistent cache is cleared only on account deletion, not on sign-out.
- Card `language` backfill: production dry-run on 2026-09-26 found 1,229 of 1,229 cards without `language`. `--apply` must run only after the new `firestore.rules` is deployed, because the currently deployed card update rule allowlists fields (`hasOnly`) without `language`, so backfilled cards would reject client edits.

## 2026-09-27 — owner decisions on reminder and AI delivery

- The weekly email digest goes through the Firebase "Trigger Email" extension.
- The tutor shares the `ai_daily.nonCardActions` quota with the other non-card AI actions.
- Tutor questions are capped at 300 characters.
- Push frequency: at most one per day per channel. Adaptive backoff (the controller's proposal, delegated by the owner):
  - daily after 0–2 ignored reminders;
  - every other scheduled day after 3–6;
  - push pauses after 7 ignored reminders, and only the weekly digest continues;
  - one study session resets it.
  - Details are in `contract-reminders-and-ai-delivery.md` §5.
- Settings shows a read-only line explaining the extension badge.

## 2026-09-27 — deploy order with card source metadata

- `createCard` now writes an immutable `source` field. The card update rule checks `hasOnly` against all document keys, so under the currently deployed rules any card that carries `source` would reject client edits.
- Deploy functions and rules in **one command** (`firebase deploy --only functions,firestore:rules`), after checking that no `library_migration_fence` document has `active == true`.
- After that, run `scripts/backfill-card-language.mjs --apply`.

## 2026-09-27 — e2e remediation findings

- **Legacy card edits (rules).** A legacy card that already stores `normalizedWord`, but has no reservation and is not schema 2, could not be edited by the client. The reservation create rule only allowed identity repair for cards without `normalizedWord`. This also failed at `HEAD`. The "1,000 expressions" message was a side effect of the denied branch, not the cause.
  - The fix lets such a card claim its matching reservation.
  - Schema-2 cards still cannot repair client-side.
  - It adds no extra document reads.
  - It ships with the same rules deploy as above.
  - The rules test covers the success case and a mismatched `normalizedWord`.
- **`createStarterCards` deploy order.** The callable must be deployed before the client that calls it. It goes out in the same `--only functions,firestore:rules` deploy.
- **`CourseProvider` race.** When sign-in finished while the course controller chunk was still loading, the controller activated with the owner captured at mount (`null`). The course profile then never loaded, and the library fell back to the `en` scope. Fixed with a latest-owner ref, plus a unit test.
- **Stale English catalog text.** 12 English `msgstr` values still carried old copy, including "available offline" claims that the owner already dropped. `i18n:check` now fails when the English catalog text differs from the source default.
- **E2E App Check.** The e2e build no longer initializes App Check. It had been sending the local site key and a debug token to Google on every run.
- **Library entrance stagger.** The stagger was removed with the row-based library. Its e2e test now asserts that rows render at full opacity.
- **Open for the owner.** Crystal light landing: the final LCP is the high-priority demo card image (`anime-instant`), not text. Either the design keeps the image as the LCP and the test changes, or the hero changes.
- **Onboarding once the course loads correctly.** With the `CourseProvider` race fixed, owners without `profile/courses` now reach the onboarding gate. Until the backfill, that is every existing production user.
  - Deleting the last card used to open onboarding over the delete Undo.
  - The gate now latches "this owner had cards" for the session, which keeps the documented rule that a legacy user is never forced into onboarding.
  - E2E specs that model returning learners now seed a course profile.
- **Library dialogs.** The card detail and delete dialogs had no `z-index`. Page chips and the upgrade banner painted over the open dialog and hid its close button.
  - They now use the repo's overlay 100 / content 101 layers.
  - The detail dialog reserves top space so the close button stays clear of the card's corner actions.
- **Landing pricing eyebrow.** The copy changed from "Free forever, …" to "Free to start, Pro when you want more", because the landing trust test forbids "forever" or "permanent" promises.
- **Follow-up for the phase 06 Canvas pass.** On the Paths hero, the roadmap labels "Foundation" and "Core" overlap, and a decorative circle overlaps the "Your current path" title.

## 2026-09-27 — Phase 12 (12.1–12.4) audit + staging must noindex

Audit-first pass (no code assumed done from prior reports without re-reading it): confirmed 12.1/12.2/12.3/12.4's coded acceptance criteria are all met on the current working tree (real flip demo, no CTA overlap at 390px Crystal, honest language-availability roster, no fake testimonials, billing/account/cardReport catalogs fully translated EN/VI with request/working/success/error/reauth test coverage, canonical/hreflang/sitemap generator tested, sign-in-return-flow already applied in `AppRuntime.tsx` by the integration lane). Ticked all four in `phase-12-landing-account-plan-surfaces.md`; left the separate "diff against Canvas boards in a browser" checklist line unticked, because no browser/Playwright tool was available this session to do a fresh pixel comparison — see "Trạng thái 12C" in the phase file for exactly which evidence backs each tick.

New gap found and closed: nothing noindexed the `staging` build (`SONFLASH_TARGET=staging`, deployed to the separate `sonflash-staging-20260906` Firebase project). `public/robots.txt` was a static file always shipping `Allow: /` regardless of target, so a staging deploy could be crawled/indexed under its own domain. `scripts/generate-locale-pages.mjs` now writes `dist/robots.txt` itself (`Disallow: /` for any non-production target, byte-identical `Allow: /` + sitemap for production) and adds a `noindex, nofollow` meta tag to every localized page for non-production targets; `check-locale-pages.mjs` fails the build if production ships noindex or a non-production target is missing it. Both are pure Node build-time scripts outside Vite's module graph, so this adds zero bytes to the initial JS/CSS bundle.

## 2026-09-27 — Owner chốt ba câu hỏi mở

- Recap hiện số thẻ đến hạn ngày mai; chấp nhận thêm 1 lượt đọc Firestore (một count query khi recap mở, không subscribe).
- SessionBridge làm lại dạng full-bleed như Canvas, được phép chạm `App.tsx`/`AppViewStage`.
- Đổi giới hạn đổi từ của thẻ từ 60 xuống 30 lần/giờ (owner giao controller tự chọn). Lý do: đổi từ là sửa lỗi gõ, hiếm khi vượt vài lần một giờ; mỗi lần là một transaction đọc/ghi thẻ cộng một lượt budget, nên hạ trần giảm một nửa chi phí xấu nhất khi bị lạm dụng mà người dùng thật không chạm tới.
- Code mồ côi: gỡ `DeckCreationForm` (đã được `DeckCreationDialog` thay trong `LibraryTools.tsx`) cùng fixture/test inline `deck-new`; gỡ `LumiBubble` (không nơi nào dùng, `Lumi.tsx` đã phủ); nối nút "Learn 5 new" ở trạng thái caught-up: bật khi còn thẻ mới trong pool, mở lesson tối đa 5 thẻ mới từ dữ liệu đã tải (không thêm read), giữ disabled kèm lý do khi hết thẻ mới.

## 2026-09-27 — Chi phí mở Learning insights từ Library

- Menu Library nay mở được `LibraryInsightsDialog`. Khi mở, `useCloudLibraryPage` gọi lại `requestStats` vốn dùng cho Progress/Catalog. Nếu cache stats theo owner và course đã quá 24 giờ hoặc chưa có, `fetchLibraryStats` chạy 8 aggregate count queries; nếu cache còn hạn, 0 Firestore reads. Đóng dialog không subscribe thêm; thao tác này không ghi Firestore. Người dùng chỉ trả chi phí khi chủ động mở insights trong Library.

## 2026-09-27 — Sửa quyết định nút "Learn 5 new" ở caught-up

- Phát hiện khi nối nút: `buildDailyPlan` (`dailyPlan.ts`) đã nhận mọi thẻ mới (tối đa 15) và `fetchPracticeCards` tải mọi thẻ `unrated`. Trạng thái caught-up chỉ xảy ra khi plan rỗng mà pool có thẻ, tức là pool không còn thẻ mới. Nhánh "bật khi còn thẻ mới" không bao giờ tới được.
- Controller đổi: nút chính caught-up thành "Add vocabulary" (luôn bật, mở màn thêm từ), giữ "Browse paths" làm nút phụ, bỏ cờ `availableNewCount` và chuỗi `today.caught-up.learn-new`/`lesson-unavailable`. Không thêm lượt đọc Firestore.
- Owner đồng ý ngày 2026-09-27: dùng "Add vocabulary", không đổi `buildDailyPlan`.

## 2026-09-27 — Owner duyệt card edit đã triển khai

- Owner duyệt implementation `EditCardDialog` đã có trong commit `58fb195`
  sau khi đọc [contract-card-edit-mutations.md](contract-card-edit-mutations.md).
  Headword rename giới hạn 30 lần/giờ; canonical part-of-speech switch,
  scheduling reset và arbitrary image upload không thuộc phạm vi đã duyệt.
- Cost thực tế của callable cao hơn ước tính cũ: headword rename đọc 5 document,
  ghi 2 (legacy đổi normalized identity: đọc 7, ghi tối đa 4); category đổi
  dùng 1 card write rồi facets callable đọc 7, ghi thêm 4 document ở lần đầu.
  Đây là cost của code đã tồn tại, không thêm read/write trong lần xác minh này.

## 2026-09-27 — Owner duyệt AnimeReveal server authority

- Giữ ba ceremony theo [contract-anime-reveal-rewards.md](contract-anime-reveal-rewards.md):
  tier-up chỉ hiển thị; streak 30 cấp badge và một freeze; level 12 → 13 cấp
  frame, title và một hint. Owner duyệt thêm một Firestore read mỗi lần
  hydration để đọc inventory.
- Owner duyệt full server authority thay cho client-supplied XP/streak.
  Verified review thêm 1 read/2 writes, verified create thêm 2 reads/3 writes,
  practice start đọc N cards và ghi session, practice complete thêm 2 reads/3
  writes; mốc reward thêm 1 read/1 write. Đây là I/O producer trước khi trừ
  save gamification cũ; không được cấp thưởng từ state client.
- Streak dùng timezone IANA riêng theo account, cố định khi ghi verified
  progress đầu tiên. XP/streak legacy bắt đầu verified từ 0; level hiển thị
  trở lại 1, XP cũ chỉ còn là dữ liệu lịch sử có nhãn. Không backfill.
- Phê duyệt này chỉ cho code/test local. Không deploy hoặc mutate production.
- Shadowing vẫn dùng để luyện nói nhưng không cấp `+10 verified XP`: transcript
  do browser tự báo không chứng minh audio của người học. Không thêm audio
  upload hoặc server transcription trong scope này.

## 2026-09-28 — Owner duyệt nguồn dữ liệu Progress

- Forecast mở lần đầu mỗi account, target language và ngày địa phương chạy 13
  aggregate count queries cho ngày 1–13; dùng due-today count query đang có.
  Cùng ngày dùng cache, không chạy lại 13 queries. Đây là chi phí mới chỉ khi
  người học mở Progress; không thêm document write hoặc subscription.
- Recently mastered dùng `masteredAt` optional, server-owned trong card và
  query tối đa bốn card mới nhất: 0–4 document reads mỗi lần hydrate Progress.
  Review ghi/xóa field trong card write hiện có, không thêm document write.
  Ngưỡng Mastered khớp Library: `difficulty=easy` hoặc `interval≥21` ngày;
  chỉ dùng FSRS `scheduledDays` khi `interval` vắng. Khi rớt dưới ngưỡng,
  server xóa `masteredAt`. Owner đã duyệt schema, Rules và index tương ứng.
- Unit progress/Continue và review-activity projection trong
  [contract-paths-progress-canvas.md](contract-paths-progress-canvas.md) là đề xuất
  riêng đang chờ quyết định; các read/write nêu ở đó chưa được duyệt cho code.
