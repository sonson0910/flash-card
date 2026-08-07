# Implementation Plan: Phase 0 Baseline Stabilization

Ngày bắt đầu: 2026-08-03

Nhánh: `codex/phase-0-stabilization`

## Overview

Phase 0 biến worktree lớn hiện tại thành một baseline có thể review, rollback và
phát hành. Giai đoạn này không thêm tính năng đa ngôn ngữ hoặc catalog; chỉ lưu
đặc tả, hoàn thiện release gates, sửa blocker được chứng minh bằng test và chia
thay đổi thành các increment độc lập.

## Task list

### Task 0.1 — Lưu đặc tả nâng cấp

- Acceptance: review, kiến trúc mục tiêu, roadmap, commands, boundaries và success
  criteria nằm trong `docs/specs/multilingual-learning-platform.md`.
- Verify: file render được dưới Markdown và không chứa secret.
- Files: `docs/specs/multilingual-learning-platform.md`.

### Task 0.2 — Kiểm kê và lập commit map

- Acceptance: mọi modified/untracked file thuộc đúng một nhóm; artifacts và file
  không nên commit được chỉ rõ; dependency order được ghi lại.
- Verify: `git status --short`, `git diff --stat`, review chéo file map.
- Dependencies: Task 0.1.

### Task 0.3 — Chạy release gates

- Acceptance: có kết quả rõ ràng cho root/Functions typecheck và unit tests,
  Firestore Rules emulator, build/release config, secret scan, bundle budget,
  accessibility và E2E Chromium/Firefox/WebKit.
- Verify: chạy các command trong đặc tả; lưu command và failure evidence.
- Dependencies: None.

### Task 0.4 — Sửa blocker theo increment

- Acceptance: mỗi sửa đổi giải quyết đúng một failure đã tái hiện; regression test
  được thêm khi phù hợp; không mở rộng scope sang multilingual/catalog.
- Verify: targeted test trước, rồi gate liên quan.
- Dependencies: Tasks 0.2 và 0.3.

### Task 0.5 — Code review và commit

- Acceptance: correctness, readability, architecture, security và performance đều
  được review; Critical/Important finding đã xử lý hoặc ghi rõ lý do defer; mỗi
  commit độc lập và có imperative message.
- Verify: full gate sau commit cuối, `git status --short` sạch.
- Dependencies: Task 0.4.

## Checkpoints

### Checkpoint A — Evidence complete

- [ ] Commit map bao phủ toàn bộ worktree.
- [ ] Mỗi release gate có pass/fail evidence.
- [ ] Không dùng production credential và không deploy.

### Checkpoint B — Baseline complete

- [ ] Full local verification pass hoặc external-only gate được ghi blocker rõ ràng.
- [ ] Không còn Critical/Important review finding chưa xử lý.
- [ ] Commit history cho phép revert từng concern.
- [ ] Worktree sạch.

## Proposed commit themes

Commit grouping cuối cùng được chốt sau kiểm kê, dự kiến gồm:

1. protect card mutation and duplicate recovery;
2. harden Firestore Rules and callable input validation;
3. add sync health and mutation recovery UI;
4. improve motion, accessibility and practice presentation;
5. enforce release configuration, metadata and bundle budgets;
6. add CI, cross-browser and accessibility gates;
7. document release and multilingual upgrade plans.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Commit nhầm thay đổi chưa hoàn chỉnh | High | Chạy targeted/full gate trước khi stage từng group |
| File có nhiều concern | High | Dùng hunk staging hoặc ghi dependency rõ ràng |
| Rules/E2E phụ thuộc môi trường | Medium | CI dùng Node 22 + Java 21 + Playwright browsers |
| Release gate cần production config | Medium | Chỉ verify schema bằng test value; không deploy |
| Large diff che khuất regression | High | Review tests trước, chia commit và review chéo |

## Rollback

Mỗi commit phải có thể `git revert` độc lập. Phase 0 không migration production,
không deploy và không xóa dữ liệu. Nếu gate cuối thất bại, giữ nhánh để điều tra và
không merge vào `main`.
