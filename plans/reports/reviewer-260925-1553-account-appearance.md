# Rà soát hình ảnh Phase 03: account và appearance

**Nguồn đã xem:** ảnh thực trong artifacts/recovery-shell-share-20260925-1553/ và artifacts/recovery-main-shell-20260925-1535/; Canvas bất biến partials.html, AnimeSettings.dc.html, AnimeMobile.dc.html. Không chạy browser, test, build, hay đọc source ứng dụng.

## Bao phủ ảnh

- Đã mở ảnh menu/account desktop của classic dark EN, classic light VI, crystal dark EN, crystal light VI; và mobile 390 của classic dark EN, crystal dark VI, crystal light VI.
- Đã mở trạng thái **Checking cloud...** và **Session ended** ở desktop classic dark EN và mobile crystal dark EN.
- Đã mở appearance desktop classic dark EN, classic light VI, crystal dark EN; mobile classic light VI và crystal light VI. Bộ 16 ảnh settings có đủ tên cho 4 tổ hợp theme × EN/VI × 1440/390.
- Không coi ảnh thiếu hoặc test timeout là đạt: classicdarkEN390timeout vẫn cần kết quả retry của root. .last-run.json ở bộ 1553 ghi failed.

## Kết quả nhìn thấy

| Vùng | Bằng chứng thực | Đánh giá so Canvas |
| --- | --- | --- |
| Account trigger và top shell | Classic giữ avatar tròn; Crystal dùng avatar đa giác; cả bốn tổ hợp có màu, chữ display và active nav riêng. Điều này khớp hướng partials: classic tròn, Crystal đa giác và có active-state mạnh. | Có bằng chứng hình cho desktop; mobile dùng trigger đa giác/nhỏ gọn nhưng cần retry classic dark EN 390. |
| Menu desktop | Các ảnh account-menu-*-1440.png hiển thị profile, trạng thái Synced, Sync now, sign out, Privacy/Terms/Extension privacy, Account data, Appearance settings, Card style, Export library to Excel và Clear the entire library. Clear tách cuối, màu đỏ. | Hành động mới Sync/Export/Clear hiện diện; không thấy bị loại bỏ các action legal/data/appearance cũ. Crystal có viền chamfer và màu neon; classic dùng panel bo tròn đúng family. |
| Connecting và session lost | account-connecting-classic-dark-en-1440.png thay profile bằng spinner/Checking cloud; account-session-lost-classic-dark-en-1440.png có Session ended + Sign in again và thông báo recovery. Hai ảnh mobile Crystal tương ứng cũng hiện được trạng thái và CTA. | Có evidence cho trạng thái và recovery, nhưng chỉ là fixture hình; không xác nhận dữ liệu tài khoản thật. |
| Appearance desktop | Ảnh settings cho thấy ba lựa chọn theme, preview classic/crystal, Follow system, Reduced motion, Lumi, Study sounds. Tên VI không tràn ở 1440; family classic giữ trang giấy/serif, Crystal dùng nền tối hoặc sáng, display chữ nghiêng/đỏ và chamfer. | Màu, typography và family separation nhất quán với Canvas AnimeSettings/partials. Không suy ra được persistence hay motion chỉ từ ảnh. |
| Appearance mobile | Cả classic-light-VI-390 và crystal-light-VI-390 có bottom nav không che tiêu đề hoặc card đầu; bản VI xuống dòng có chủ đích và còn trong viewport. | Chỉ thấy phần đầu trang do cần scroll; ảnh không chứng minh các switch ở cuối trang vẫn chạm được, không thể PASS toàn bộ screen. |

## Sai khác cần sửa trước khi đóng visual

1. **Mobile menu che hàng destructive.** account-menu-final-row-classic-dark-en-390.png, account-menu-final-row-crystal-dark-vi-390.png, và account-menu-final-row-crystal-light-vi-390.png đều đặt fixed bottom nav phủ lên vùng cuối menu. Ở hai ảnh Crystal, “Clear the entire library” / “Xóa toàn bộ thư viện” còn lộ mờ phía sau nav, không là một hàng có thể nhìn và chạm độc lập. Canvas AnimeMobile yêu cầu shell mobile không che CTA; cần chừa inset đáy hoặc cho panel scroll-padding-bottom bằng chiều cao nav + safe area.
2. **Trạng thái cuối mobile không có evidence hoàn chỉnh.** Ảnh final-row classic dark chỉ dừng ở Export; ảnh Crystal cho thấy Clear bị che. Không có ảnh nào chứng minh Clear hiển thị đầy đủ ở sau khi scroll. Không được đánh dấu row/action này PASS.
3. **Menu mobile không cho thấy profile và sync status ở cùng khung action đầu.** Ảnh account-menu-*-390.png bắt đầu tại Sync now, trong khi desktop hiển thị profile và status. Đây có thể là vị trí scroll chủ ý, nhưng ảnh không chứng minh người dùng thấy được profile/status hoặc có indicator scroll; cần retry/capture state đầu trước khi kết luận geometry đạt.
4. **Evidence suite chưa sạch.** Fullsuite 32/33 được báo pass nhưng artifact .last-run.json hiện failed và classic-dark-EN-390 timeout. Chờ narrow retry; thiếu retry không phải PASS.

## Giới hạn

Các màn account dùng fixture “Mina Tran”, mina@example.test, 12 words; đây không phải bằng chứng account thật. Canvas AnimeSettings là settings/reminder desktop rộng, còn ảnh hiện có là appearance screen; chỉ đánh giá token, shell, typography và control geometry chung, không coi khác nội dung workflow là sai khác.

Status: DONE_WITH_CONCERNS
Summary: Desktop menu, connection/session states, và four-theme appearance có evidence ảnh tốt; các action mới Sync/Export/Clear và action legal/data/appearance đều còn. Mobile final-row che destructive action bởi fixed nav, và retry classic-dark-EN-390 chưa có kết quả sạch.
Concerns/Blockers: Không có capture chứng minh Clear được scroll tới một vị trí nhìn/chạm được; test artifact 1553 hiện failed dù fullsuite 32/33 được báo pass.
