---
title: "Pricing, checkout, Pro, referral, league và streak đầy đủ"
status: todo
---

# 15. Pricing, checkout, Pro, referral, league và streak đầy đủ

## Kết quả và phụ thuộc

Decision8/price/VAT/gateway/business go; phase14 khi cần persistence/payment worker; UI base03,05,06,10,12.

Ước lượng: Chưa thể chốt tổng trước business rules; dự kiến lập contract/design-state1–2 ngày, implementation estimate sau. Đây là công sức kỹ thuật dự kiến, không phải hạn giao; bao gồm sửa và verify phần phase. Trạng thái hiện tại lấy từ audit, chưa task nào được đánh dấu đạt chỉ vì có patch.

## Nguồn và file sở hữu

Nguồn: PricingScreen/AnimePricing; DlgPaywall/AnimePaywall/MobilePaywall; DlgCheckout/AnimeCheckout; ProStates/AnimeProStates; ReferralScreen/AnimeReferral; LeagueScreen/AnimeLeague; DlgStreak/AnimeStreak; LandingSales; decisionsR3,R5–R8 và decision8.

Đường dẫn dưới đây tương đối với `/mnt/Projects/startup/flash-card` cho đến khi phase migration đổi root theo source plan.

src/features/billing/**; proposed entitlement/payment/referral/league/streak modules; backend billing/gamification contract; settings/Today/recap/landing integration.

File `proposed` là file/module cần tạo, không phải tuyên bố đã tồn tại. File chung do controller chỉnh tuần tự theo [ownership](acceptance-contract.md).

## Công việc cụ thể

| Task | Thực hiện | Điều kiện đạt |
|---|---|---|
| 15.1 | Lập rules matrix cho mọi commercial/growth board: Free/Pro limits, prices/VAT/currency, trial, gates, perk eligibility, refunds/cancel. | Giữ màn trong plan; không sử dụng249k/949k/student-50%/trial mẫu như giá thật; owner chốt policy trước kích hoạt. |
| 15.2 | Pricing/Pro states/paywall: offer loading/eligible/not eligible/quota exhausted/already Pro/error; upgrade→intent hoặc checkout theo cấu hình hợp lệ. | Pilot vẫn intent; SRS/manual/export không vô cớ bị khóa. Disabled route không được coi là implement xong nếu task yêu cầu payment. |
| 15.3 | Checkout đầy đủ chọn offer/method/summary/tax/consent/pay→pending/success/failure/retry/cancel/receipt; server entitlement settlement idempotent. | Chỉ chạy tiền thật khi doanh nghiệp/gateway/owner cho phép; test sandbox đúng webhook ownership và duplicate handling. |
| 15.4 | Referral: link/code/share/invite status/eligibility/reward ledger/anti-abuse/limit/privacy. | Không hứa7dayPro tự động khi policy chưa duyệt; không tự gửi thư/tin nhắn; reward chỉ khi điều kiện đã xác thực. |
| 15.5 | League/Friends: join/opt-out/podium/list/week rollover/tie/empty/offline và profile privacy. | Nguồn xếp hạng/XP server thật; không seed giả20 người; cấm game/MOBA copy vẫn áp dụng. |
| 15.6 | Streak freeze/repair/milestones/combo/achievement rewards: rules/timezone/purchase/apply/recover, giữ base XP cho Again theoR3. | FSRS không thay vì reward; không reset hoặc cộng lặp; humane opt-out/consent, no invented bonus. |
| 15.7 | Tích hợp các block có điều kiện vào Today/Recap/WeeklyRecap/Onboarding/Landing/Settings và so tất cả variants Canvas. | Không bỏ toàn bộ board vì có một section thương mại; mọi affordance có real action/state và đúng entitlement. |

## Checklist

- [ ] 15.1 — Lập rules matrix cho mọi commercial/growth board: Free/Pro limits, prices/VAT/currency, trial, gates, perk eligibility, refunds/cancel.
- [ ] 15.2 — Pricing/Pro states/paywall: offer loading/eligible/not eligible/quota exhausted/already Pro/error; upgrade→intent hoặc checkout theo cấu hình hợp lệ.
- [ ] 15.3 — Checkout đầy đủ chọn offer/method/summary/tax/consent/pay→pending/success/failure/retry/cancel/receipt; server entitlement settlement idempotent.
- [ ] 15.4 — Referral: link/code/share/invite status/eligibility/reward ledger/anti-abuse/limit/privacy.
- [ ] 15.5 — League/Friends: join/opt-out/podium/list/week rollover/tie/empty/offline và profile privacy.
- [ ] 15.6 — Streak freeze/repair/milestones/combo/achievement rewards: rules/timezone/purchase/apply/recover, giữ base XP cho Again theoR3.
- [ ] 15.7 — Tích hợp các block có điều kiện vào Today/Recap/WeeklyRecap/Onboarding/Landing/Settings và so tất cả variants Canvas.
- [ ] Đối chiếu Canvas từng state của phase theo board/artboard inventory; reviewer kiểm tra cả hành vi và hình thức.
- [ ] Chạy focused checks rồi gates; ghi revision, kết quả và ngoại lệ trong log.

## Verification

Rules/domain tests trước feature code; payment/referral/streak idempotency and server tampering tests; sandbox E2E; all board states visual/a11y; common gates. Không bật billing thật trong task hiện tại.

Hợp đồng chung: [acceptance-contract.md](acceptance-contract.md). Tên test mới là đề xuất; trước chạy phải kiểm inventory file thực, không báo file vắng là PASS. Với flow có mutation, test dùng emulator/fixtures, không dữ liệu người học hay Gemini thật.

## Rủi ro và rollback

Yêu cầu “tích hợp mọi màn” không tự xác lập giá, cơ chế thưởng hoặc cho phép giao dịch. Đây là gate quyết định có task cụ thể, không phải loại màn khỏi scope.

Rollback theo commit scope hoặc flag additive đã review; không delete/reset dữ liệu hay dirty work. Bước phụ thuộc sau chỉ nhận contract đã kiểm chứng. Không deploy trong công việc lập kế hoạch này.
