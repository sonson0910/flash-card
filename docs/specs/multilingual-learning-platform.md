# Đặc tả nâng cấp nền tảng học đa ngôn ngữ

Ngày lập: 2026-08-03

Trạng thái: Đã được duyệt để bắt đầu Phase 0

## 1. Mục tiêu

Nâng SonFlash từ ứng dụng flashcard English–Vietnamese thành nền tảng học nhiều
ngôn ngữ có lộ trình rõ ràng, trực quan và có kho từ vựng được kiểm định. Riêng
không gian tiếng Anh phải tách rõ ba lộ trình:

- IELTS Preparation;
- TOEIC Preparation;
- Từ vựng tổng quát.

Người học phải có thể đi từ nền tảng đến nâng cao, học offline, ôn theo FSRS và
giữ nguyên tiến độ khi một từ xuất hiện trong nhiều lộ trình.

## 2. Phạm vi và giả định

- Sản phẩm tiếp tục là web app React + TypeScript + Vite.
- Firebase tiếp tục đảm nhiệm Auth, Firestore, Functions và Hosting.
- Giao diện mặc định dùng tiếng Việt; locale giao diện và ngôn ngữ đang học là
  hai khái niệm độc lập.
- IELTS và TOEIC là lộ trình của không gian tiếng Anh. Các ngôn ngữ khác bắt đầu
  với lộ trình Tổng quát và có thể thêm JLPT/TOPIK/HSK sau bằng cùng mô hình.
- Thẻ v2 hiện tại được di trú mặc định thành English → Vietnamese và không được
  làm mất lịch sử FSRS, bookmark hay review.
- Nội dung AI sinh chỉ là bản nháp hỗ trợ biên tập, không tự động được coi là dữ
  liệu chuẩn hoặc dữ liệu “official”.

## 3. Kết quả review hiện trạng

### P0 — định danh không an toàn cho đa ngôn ngữ

Card ID chỉ dựa trên `normalizedWord`; chưa có language, part of speech hay sense.
Cùng một chuỗi ở hai ngôn ngữ có thể đụng định danh. `word` và `normalizedWord`
cũng đang nằm trong danh sách field có thể patch dù document ID phụ thuộc vào
chúng.

### P0 — nội dung và tiến độ bị ghép vào một document

`CardData` chứa đồng thời nghĩa, ví dụ, media, FSRS, bookmark và review history.
Toàn bộ card nằm trong `users/{uid}/cards`, khiến catalog lớn bị nhân bản theo
người dùng và khó sửa/version nội dung.

### P1 — application controller quá lớn

`src/App.tsx` có 3.378 dòng và 104 React hook: 28 `useState`, 30 `useEffect`,
20 `useCallback`, 10 `useMemo`, 16 `useRef`. Auth, đồng bộ, thư viện, Card Intake,
Practice Session, sharing, filter, URL và overlay cùng được điều phối tại đây.

### P1 — language pair bị hard-code

Prompt AI, dictionary audio endpoint, recall direction, spelling copy và `lang`
attribute đều giả định English–Vietnamese.

### P1 — taxonomy chưa biểu diễn được lộ trình học

`CardQueryState` chỉ hỗ trợ category, custom deck, memory difficulty, part of
speech, bookmark, date và prefix. Chưa có language, curriculum track, CEFR/tier,
exam topic, skill hay learning status. `cefrLevel` tồn tại trong card nhưng chưa
tham gia query/filter.

### P1 — chưa có content catalog được quản trị

Repository chưa có seed/catalog/curriculum pipeline. Nội dung chưa mang source,
license, reviewer, content version và editorial status.

### Rủi ro baseline

Tại thời điểm review, worktree có 46 file sửa và 22 file mới. Tracked diff có
4.097 dòng thêm và 888 dòng xóa; cần được chia thành các increment độc lập, kiểm
tra và lưu lại trước khi mở rộng sản phẩm.

## 4. Nền tảng đang có và phải giữ

- TypeScript, unit tests và E2E tests;
- offline-first IndexedDB mirror;
- pending operations, revision, library epoch, tombstone và conflict recovery;
- FSRS và review history;
- bounded Firestore pagination/listeners;
- App Check, authenticated callable Functions, input bounds và rate limiting;
- accessibility, reduced motion, lazy loading và card flip;
- secret scan, bundle budget và release metadata.

Baseline review đã xác nhận 252 application tests và 25 Functions tests pass;
TypeScript của cả hai workspace pass; production dependency audit không phát
hiện High/Critical vulnerability.

## 5. Kiến trúc mục tiêu

### Lexeme Catalog

Nội dung chuẩn dùng chung: language, lemma, normalized lemma, part of speech,
sense, phonetics, definitions, examples, collocations, word family, audio/media,
source, license, editorial status và content version.

Định danh logic phải bao gồm ít nhất:

`language + normalized lemma + part of speech + sense`

### Track Membership

Quan hệ giữa một lexeme và một lộ trình. Membership sở hữu curriculum track,
tier, CEFR, topic, applicable skills, rank và lesson grouping. Một lexeme có thể
thuộc IELTS, TOEIC và General mà không bị nhân bản tiến độ.

### Learning State

Dữ liệu riêng theo learner và lexeme: FSRS, review history, bookmark, mastery,
correct streak, last activity và custom collection membership.

### Language Adapter

Một seam thật sự cho normalization, tokenization, speech locale, audio provider,
typed-answer tolerance và script-specific presentation. Mỗi ngôn ngữ có adapter
riêng nhưng Practice Session sử dụng cùng một interface ở mức sản phẩm.

### Catalog delivery

Catalog published là dữ liệu versioned, read-only, được chia chunk và cache trong
IndexedDB. Firestore chỉ đồng bộ Learning State và dữ liệu cá nhân, tránh nhân bản
hàng nghìn nội dung catalog theo từng user.

## 6. Kiến trúc thông tin giao diện

```text
┌─────────────────────────────────────────────────────┐
│ Đang học: Tiếng Anh ▼       Mục tiêu: IELTS ▼      │
├─────────────────────────────────────────────────────┤
│ Hôm nay                                             │
│ 18 từ cần ôn · 10 từ mới · Chuỗi 12 ngày           │
│ [ Tiếp tục học ]                                    │
├─────────────────────────────────────────────────────┤
│ Chọn lộ trình                                       │
│ [ IELTS ]       [ TOEIC ]       [ Tổng quát ]       │
│ 42% hoàn thành   18% hoàn thành  61% hoàn thành     │
├─────────────────────────────────────────────────────┤
│ Lộ trình IELTS                                      │
│ ✓ Nền tảng → ● Cốt lõi → ○ Nâng cao                │
├─────────────────────────────────────────────────────┤
│ Bộ lọc: Cấp độ · Chủ đề · Từ loại · Trạng thái     │
└─────────────────────────────────────────────────────┘
```

Mobile navigation có bốn mục: Hôm nay, Lộ trình, Kho từ, Tiến độ. IELTS, TOEIC,
General và Custom có màu nhận diện nhưng luôn đi kèm icon và text label; không
dùng màu làm tín hiệu duy nhất.

## 7. Kế hoạch nội dung

### Pilot có kiểm định

- 300 mục IELTS;
- 300 mục TOEIC;
- 300 mục General.

Mỗi mục bắt buộc có meaning/sense, CEFR/tier, example, collocations, source,
license, reviewer và editorial status. Pipeline phải reject ID trùng, field sai
schema, source/license thiếu và reference tới lexeme không tồn tại.

### Mục tiêu v1 sau pilot

- khoảng 2.000 mục IELTS: Pre-IELTS Foundation, Core, Advanced;
- khoảng 1.500 mục TOEIC theo tình huống công sở và độ khó;
- khoảng 2.400 mục General trải từ A1 đến C2.

Nhãn “Pre-IELTS Foundation” phải phân biệt kiến thức nền với nội dung luyện thi;
không gắn nhãn “official” khi chưa có nguồn và quyền sử dụng phù hợp.

## 8. Roadmap

### Phase 0 — ổn định baseline

- lưu đặc tả này trong repository;
- kiểm kê và chia worktree thành các commit độc lập;
- chạy lint, unit, Functions, Rules emulator, production build, secret scan,
  bundle budget, accessibility và E2E ba browser;
- khắc phục release blockers trong phạm vi baseline;
- xác nhận rollback point và worktree sạch.

### Phase 1 — làm sâu các module hiện tại

Tách `App.tsx` thành Library Session, Card Intake, Practice Session, Catalog,
Learning State, Language và Navigation/Overlay. Không để UI controller gọi trực
tiếp Firestore. Mục tiêu `App.tsx` còn khoảng 400–600 dòng và không đổi hành vi.

### Phase 2 — schema đa ngôn ngữ

Thêm Language Profile, Lexeme, Track Membership và Learning State; dual-read
v2/v3; migration và rollback; giữ nguyên toàn bộ learning progress.

Trạng thái 2026-08-03: đã triển khai và kiểm định local; chưa chạy migration hoặc
deploy production. Biên bản chi tiết nằm tại
`docs/plans/phase-2-multilingual-schema.md`.

### Phase 3 — catalog pipeline

Thêm schema validator, importer, versioning, provenance/license check, editorial
workflow, pilot catalogs và cache/index offline.

### Phase 4 — catalog UI và learning path

Thêm language switcher, track cards, tier roadmap, progress, combined filters,
URL state và offline catalog download.

### Phase 5 — learning experience

Daily plan, lesson 10–15 mục, placement check, recognition, active recall,
listening, spelling, cloze, sentence building và script-aware scoring.

### Phase 6 — kiểm định và rollout

Migration/rollback test, 10.000-item performance, offline/account-switch tests,
multi-script tests, WCAG 2.2 AA, content QA, staging, canary và observability.

## 9. Commands

```bash
npm run lint
npm test -- --run
npm --prefix functions run lint
npm --prefix functions test
npm run test:rules
npm run build:release
npm run verify:secrets
npm run verify:bundle
npm run test:a11y
npm run test:e2e
npm run verify:audit
```

`build:release` cần production App Check site key; local Phase 0 có thể dùng gate
kiểm tra cấu hình với giá trị test không nhạy cảm, nhưng không được deploy.

## 10. Testing strategy

- Pure domain logic: Vitest unit tests.
- Repository/sync: fake-indexeddb và Firestore mock/integration tests.
- Security contract: Firestore Rules emulator và Functions validation tests.
- Product flows: Playwright Chromium, Firefox, WebKit.
- Accessibility: axe-core cộng keyboard/focus/reduced-motion assertions.
- Release artifact: build metadata, secret scan và bundle budgets.
- Catalog: schema, ID uniqueness, reference integrity, provenance và version tests.

## 11. Boundaries

### Luôn làm

- giữ tương thích và bảo toàn learning progress;
- validate external/catalog data ở seam;
- chạy gate phù hợp sau mỗi increment;
- commit nhỏ, có thể revert độc lập;
- ghi rõ source/license/version của published content.

### Phải hỏi trước

- deploy staging/production;
- thay Firebase project hoặc production secret;
- migration phá hủy hoặc xóa dữ liệu;
- thêm dependency runtime lớn;
- sử dụng bộ dữ liệu có điều kiện giấy phép chưa rõ.

### Không bao giờ làm

- commit secret/token;
- gọi nội dung AI chưa duyệt là “official”;
- ghi đè hoặc reset thay đổi hiện có để làm sạch worktree;
- làm mất review history, FSRS hoặc bookmark khi migration;
- phát hành catalog thiếu provenance/license.

## 12. Success criteria

1. Cùng chuỗi ở hai ngôn ngữ không đụng ID.
2. Hai sense của một lemma có thể tồn tại độc lập.
3. Một lexeme thuộc nhiều track dùng chung Learning State.
4. Card v2 migration không mất bất kỳ tiến độ nào và có rollback.
5. IELTS/TOEIC/General hiển thị riêng, kết hợp được với tier/topic/status filter.
6. Catalog 10.000 mục hiển thị offline dưới 500 ms sau khi cache và filter/search
   phản hồi dưới 100 ms trên thiết bị mục tiêu.
7. Không có direct Firestore card write từ UI controller.
8. Rules, unit, Functions, build, secret, bundle, accessibility và ba-browser E2E
   đều pass trong CI.
9. Không có High/Critical dependency advisory.
10. Published catalog luôn có source, license, version và editorial status.

## 13. Open decision

Sau English, cần chốt nhóm ngôn ngữ đầu tiên để kiểm chứng Language Adapter:
Japanese/Korean hoặc Chinese/Japanese.
