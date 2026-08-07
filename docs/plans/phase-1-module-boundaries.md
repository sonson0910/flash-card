# Implementation Plan: Phase 1 Module Boundaries

Ngày bắt đầu: 2026-08-03

Nhánh: `codex/phase-1-module-boundaries`

## Objective

Tách `src/App.tsx` khỏi vai trò controller toàn năng thành composition root nhỏ,
trong khi giữ nguyên hành vi, schema Firestore và dữ liệu học hiện tại. UI không
được gọi trực tiếp Firebase/Firestore hoặc card repository. Phase này chỉ tạo
module boundary cho Library Session, Card Intake, Practice Session, Catalog Query,
Learning State, Language và Navigation/Overlay; chưa thêm schema/catalog đa ngôn
ngữ của Phase 2–4.

## Architecture decisions

- Dependency direction: UI → feature controller → domain port → infrastructure adapter.
- `App.tsx` chỉ composition, cross-module wiring và screen selection; hard limit 600 dòng.
- Không đưa `User`, `QueryDocumentSnapshot`, `Firestore`, React setter hay ref qua
  public feature contract.
- Tách theo vertical slice và characterization test; không di chuyển nguyên monolith
  sang một hook/context khác.
- Language trong Phase 1 chỉ là `LanguageProfile` English→Vietnamese tương thích;
  registry/switcher và schema đa ngôn ngữ thuộc Phase 2–4.
- Không thay Firestore schema, không migration production, không thêm runtime dependency.

## Tasks

### 1.1 — Characterization và architecture gates

- Acceptance: các flow URL, focus, guest library, duplicate reveal, offline sync và
  practice hiện tại có regression coverage; import graph không cycle.
- Acceptance: test kiến trúc chặn App >600 dòng và direct Firebase/repository import
  từ App/presentation sau khi extraction hoàn tất.
- Verify: targeted Vitest + Chromium/WebKit smoke.

### 1.2 — Navigation, Overlay và presentation shell

- Acceptance: theme, view navigation, heading focus, feedback timer, opener restore,
  desktop/mobile navigation và overlays nằm ngoài App.
- Verify: component/unit tests, app-shell E2E Chromium + WebKit, axe Chromium.

### 1.3 — Catalog query và URL state

- Acceptance: reducer/hook sở hữu filters, pagination, URL restore/sync và derived
  presentation; history navigation giữ nguyên unrelated query params.
- Verify: reducer tests và deep-link/popstate E2E.

### 1.4 — Language compatibility seam

- Acceptance: một immutable English→Vietnamese profile cung cấp normalization,
  speech locale và source/target metadata mà không đổi copy/behavior.
- Verify: unit tests cho normalization và immutable profile.

### 1.5 — Practice Session

- Acceptance: study/quiz/spelling/story state và commands nằm sau một controller;
  practice pool là bounded snapshot; review/XP không chạy hai lần.
- Verify: hook/controller tests + practice and keyboard-focus E2E.

### 1.6 — Learning State commands

- Acceptance: bookmark, deck, review, patch, delete và clear đi qua một port; optimistic
  state giữ `cards` và `studyCards` nhất quán; stale session không mutate UI.
- Verify: command tests, conflict/revision/epoch tests, offline mutation E2E.

### 1.7 — Card Intake

- Acceptance: generate, spreadsheet import và shared-deck adoption dùng cùng intake
  pipeline; normalize/dedupe/persist/enrich ordering được giữ; draft và progress cleanup
  đúng trên failure.
- Verify: intake/import/sharing tests và duplicate creation E2E.

### 1.8 — Library Session

- Acceptance: auth ownership, bounded cloud page, local mirror, pending queue, realtime,
  facets và retry nằm sau `LibrarySession`; public contract không lộ vendor type.
- Acceptance: owner switch hủy async/listener cũ trước khi publish state mới.
- Verify: fake-adapter tests cho owner switch, stale result, cleanup, pending ordering;
  sync E2E và Rules source/emulator gate.

### 1.9 — Composition cleanup và review

- Acceptance: `App.tsx` 600 dòng trở xuống; không direct Firestore/repository; không
  import cycle; không còn implementation song song/dead code của controller cũ.
- Verify: architecture tests, lint, toàn bộ unit/Functions/build/secret/bundle/a11y,
  Chromium và WebKit; Firefox/Rules Emulator chạy trong CI nếu local runtime thiếu.

## Checkpoints

### A — Presentation seams

- Navigation/Overlay, Catalog Query và Language xanh.
- Không thay dữ liệu hoặc hành vi lưu trữ.

### B — Behavior modules

- Practice, Learning State và Card Intake xanh với fake ports.
- Không có duplicate mutation path.

### C — Session boundary

- UI không còn vendor import.
- Auth switch, offline queue, realtime cleanup và rollback đều được test.

### D — Phase complete

- `App.tsx` ≤600 dòng, import graph zero-cycle, full available gate xanh.
- Worktree sạch và commit theo từng concern có thể revert.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Callback phiên A cập nhật phiên B | Critical | session token + cleanup characterization trước extraction |
| Di chuyển monolith sang giant hook | High | size/import contract và public-interface review |
| Lệch Library/Practice snapshot | High | Learning State port phát một mutation result cho cả hai consumer |
| Pending operation mất thứ tự/idempotency | High | giữ protocol hiện tại, test queue-before-UI và lease `finally` |
| URL/focus regression | Medium | reducer tests + Chromium/WebKit E2E mỗi presentation slice |
| Refactor che thay đổi schema | High | Phase 1 cấm schema/data migration |

## Commands

```bash
npm run lint
npm test -- --run
npm --prefix functions run lint
npm --prefix functions test
npm --prefix functions run build
npm run build
npm run verify:secrets
npm run verify:bundle
npx playwright test --project=chromium
npx playwright test --project=webkit
```

Firestore Rules Emulator tiếp tục là gate CI dùng Java 21. Không deploy hoặc dùng
production credential trong Phase 1.
