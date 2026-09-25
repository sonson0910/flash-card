---
title: "Landing, tài khoản, policy và plan surfaces"
status: todo
---

# 12. Landing, tài khoản, policy và plan surfaces

## Kết quả và phụ thuộc

12A: tasks12.1,12.3–12.5 sau03, nghiệm thu landing/account/pilot với capabilities hiện có. 12B: task12.2 tích hợp đầy đủ Sales/Lang sections sau10,11B,15; chạy lại12.4–12.5 khi markup/capability thay đổi. Toàn12 chỉ hoàn tất khi cảA/B đạt.

Ước lượng: 2–4 ngày. Đây là công sức kỹ thuật dự kiến, không phải hạn giao; bao gồm sửa và verify phần phase. Trạng thái hiện tại lấy từ audit, chưa task nào được đánh dấu đạt chỉ vì có patch.

## Nguồn và file sở hữu

Nguồn: LandingScreen/LandingSales/AnimeLanding/AnimeLandingSales/LangLanding; AnimeSystem/Feedback/Settings/ProStates; handoff §5; frontend16.

Đường dẫn dưới đây tương đối với `/mnt/Projects/startup/flash-card` cho đến khi phase migration đổi root theo source plan.

src/features/landing/**; landing-page.css; src/features/{account,billing,cardReport,plan}/**; public/privacy.html/terms.html; locale page generator/checker; catalogs.

File `proposed` là file/module cần tạo, không phải tuyên bố đã tồn tại. File chung do controller chỉnh tuần tự theo [ownership](acceptance-contract.md).

## Công việc cụ thể

| Task | Thực hiện | Điều kiện đạt |
|---|---|---|
| 12.1 | Landing đúng hero/card collage/ribbon/demo/sections desktop/mobile; theme variants lấy trực tiếp Canvas source. | Ảnh/decor không đè CTA tại390; không chỉ bỏ artwork để test overflow xanh; demo flip/interaction làm thật. |
| 12.2 | Gộp Sales/LangLanding thành sections của landing canonical: value/demo/process/extension/language offer/pricing khi hợp lệ. | Không nhân route trùng; ngôn ngữ chưa mở hiển thị trạng thái thật; testimonial/claims cần nguồn, không chép người dùng giả. |
| 12.3 | Pilot quota/upgrade/report/account export/delete/legal/18+ đầy đủ EN/VI và Canvas design. | Billing/account catalogs không còn0 khi surface có copy; request/working/success/error/reauth đều có test; purchase intent chưa thành checkout. |
| 12.4 | Giữ sonflash.app canonical/hreflang/sitemap, locale navigation và sign-in return flow; không hỏi lại domain. | EN/VI reciprocals, noindex staging nếu config yêu cầu, CTA không đổi locale/theme bất ngờ. |
| 12.5 | Performance/first paint/LCP kiểm ở tất cả theme, font/image lazy hợp lý, keyboard legal links. | Không tăng initial budget; không che content để làm metric đẹp; ảnh không layout-shift. |

## Checklist

- [ ] 12.1 — Landing đúng hero/card collage/ribbon/demo/sections desktop/mobile; theme variants lấy trực tiếp Canvas source.
- [ ] 12.2 — Gộp Sales/LangLanding thành sections của landing canonical: value/demo/process/extension/language offer/pricing khi hợp lệ.
- [ ] 12.3 — Pilot quota/upgrade/report/account export/delete/legal/18+ đầy đủ EN/VI và Canvas design.
- [ ] 12.4 — Giữ sonflash.app canonical/hreflang/sitemap, locale navigation và sign-in return flow; không hỏi lại domain.
- [ ] 12.5 — Performance/first paint/LCP kiểm ở tất cả theme, font/image lazy hợp lý, keyboard legal links.
- [ ] Đối chiếu Canvas từng state của phase theo board/artboard inventory; reviewer kiểm tra cả hành vi và hình thức.
- [ ] Chạy focused checks rồi gates; ghi revision, kết quả và ngoại lệ trong log.

## Verification

landing locale/visual/performance tests, check-locale-pages.mjs; pilot/account/report/quota component tests; E2E sign-in return/export/delete confirmation với fixtures; gates chung.

Hợp đồng chung: [acceptance-contract.md](acceptance-contract.md). Tên test mới là đề xuất; trước chạy phải kiểm inventory file thực, không báo file vắng là PASS. Với flow có mutation, test dùng emulator/fixtures, không dữ liệu người học hay Gemini thật.

## Rủi ro và rollback

Không công bố thông tin/giá/khả năng chưa có. Chỉ schema/markup policy, không tự ghi owner đã duyệt nội dung pháp lý.

Rollback theo commit scope hoặc flag additive đã review; không delete/reset dữ liệu hay dirty work. Bước phụ thuộc sau chỉ nhận contract đã kiểm chứng. Không deploy trong công việc lập kế hoạch này.
