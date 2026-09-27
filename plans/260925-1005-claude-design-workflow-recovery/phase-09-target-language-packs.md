---
title: "Language packs và practice theo từng ngôn ngữ"
status: todo
---

# 09. Language packs và practice theo từng ngôn ngữ

## Kết quả và phụ thuộc

08; dùng card/study seams của 04–05.

Ước lượng: 6–8 ngày. Đây là công sức kỹ thuật dự kiến, không phải hạn giao; bao gồm sửa và verify phần phase. Trạng thái hiện tại lấy từ audit, chưa task nào được đánh dấu đạt chỉ vì có patch.

## Nguồn và file sở hữu

Nguồn: Frontend 11; LangCard/LangReview/LangPractice và AnimeLangCard/AnimeLangPractice; R10 wave 1.

Đường dẫn dưới đây tương đối với `/mnt/Projects/startup/flash-card` cho đến khi phase migration đổi root theo source plan.

proposed src/features/languagePacks/**; src/lib/{speechMatch,speechLocale,audio,cardNormalization,syllableParser}.ts; CardHeadword/SpeechMatchFeedback/SyllableStressBadge; exerciseEngine/scriptScoring; affected input/render consumers.

File `proposed` là file/module cần tạo, không phải tuyên bố đã tồn tại. File chung do controller chỉnh tuần tự theo [ownership](acceptance-contract.md).

## Công việc cụ thể

| Task | Thực hiện | Điều kiện đạt |
|---|---|---|
| 09.1 | Lazy registry en/ko/ja/zh; rendering/normalization/tokenization/speech/goal catalog capabilities. | Không load cả bốn packs vào initial bundle; English regression giữ nguyên effects/grade. |
| 09.2 | Headword đúng ngôn ngữ: English stress; Hangul/romanization; Kanji/furigana; Hanzi/pinyin/tones. | Reading toggles hoạt động, lang đúng, không dùng capitalize chung hoặc cắt dấu; fallback phonetic hợp đồng Firebase rõ. |
| 09.3 | Unicode speech score/tokenization: Intl.Segmenter và fallback đã kiểm; ASR/TTS/voice theo pack, permission/no voice/no support. | Korean/Japanese/Chinese không bị strip hết thành score0; không gọi text match là chấm phát âm âm học. |
| 09.4 | IME composition, grapheme-aware spelling, sentence building/quiz/match/story theo target/native pair. | Không submit giữa composition; ja/zh không split chỉ whitespace; đáp án/distractors không trộn course. |
| 09.5 | Server pair allowlist và prompt notes giữ model Flash-Lite; generation output/reading metadata round-trip. | Quota giữ per-account/per-card; unsupported pair bị reject phía server; không chỉ UI dropdown allowlist. |
| 09.6 | Golden set 20 terms mỗi pack, human language review và đo cost trước enable; wave2 es/de và wave3 fr/pt giữ tasks/registry availability. | 80 terms được đánh giá có artifact khi được phép chạy staging; fixture test không thay human/live quality gate. |

## Checklist

- [x] 09.1 — Lazy registry en/ko/ja/zh; rendering/normalization/tokenization/speech/goal catalog capabilities.
- [x] 09.2 — Headword đúng ngôn ngữ: English stress; Hangul/romanization; Kanji/furigana; Hanzi/pinyin/tones.
- [x] 09.3 — Unicode speech score/tokenization: Intl.Segmenter và fallback đã kiểm; ASR/TTS/voice theo pack, permission/no voice/no support.
- [x] 09.4 — IME composition, grapheme-aware spelling, sentence building/quiz/match/story theo target/native pair.
- [x] 09.5 — Server pair allowlist và prompt notes giữ model Flash-Lite; generation output/reading metadata round-trip.
- [ ] 09.6 — Golden set 20 terms mỗi pack, human language review và đo cost trước enable; wave2 es/de và wave3 fr/pt giữ tasks/registry availability. (Explicitly gated — not implemented or run in this pass.)
- [ ] Đối chiếu Canvas từng state của phase theo board/artboard inventory; reviewer kiểm tra cả hành vi và hình thức.
  > **Language drills 2026-09-28.** Đã mở ảnh actual và tạo 32 baseline Chromium cho en/ko/ja/zh ở Classic/Crystal × light/dark × desktop/mobile; visual rerun 33/33 gồm keyboard Hàn vật lý. Kana Nhật nay chỉ hiện sau Hint/Check, và spec kiểm không lộ đáp án trước Hint. Owner đã duyệt UniDic Kana Accent 2.1.2 theo BSD. Resolver chỉ chấp nhận subset tĩnh được pin theo SHA-256, `aType` đơn trị, `aModType=*`, headword+kana chính xác và đúng một hàng nguồn; dòng provenance giữ số dòng `lex.csv`. Contour chỉ render khi metadata đã lưu khớp source/current word/kana. Đã mở tám ảnh actual ja và so trực tiếp `LangPractice-{light,dark}.png` cùng `AnimeLangPractice-{light,dark}.png` trước khi cập nhật đúng tám baseline ja; Chromium Paths/Progress + language-practice 50/50 pass không update. Full Canvas comparison vẫn mở cho các artboard language khác. German article giữ wave 2 theo decision log.
  > **Korean correction 2026-09-28.** Khi chỉ có một phụ âm cuối Hangul khác đáp án, drill chỉ ra ký tự đã nhập và ký tự cần sửa ngay trước Check; vẫn cho Delete/chọn lại trên cùng thẻ. Ô sai và hai phím liên quan được tô theo trạng thái. Đã xem tám PNG actual KO Classic/Crystal × light/dark × desktop/mobile và so `LangPractice`/`AnimeLangPractice`, rồi cập nhật đúng tám baseline Chromium KO. Visual rerun 9/9 pass (gồm sửa ㅂ thành ㅁ trước Check); unit 12/12, lint, i18n đủ 12 catalog, build/bundle pass (initial JS 70.986/71.000 B, CSS 29.464/29.500 B gzip). Không thêm Firestore read/write/query/subscription. Checklist vẫn mở vì Japanese sentence completion và Korean review panel chưa có đủ trạng thái Canvas.
  > **Japanese sentence completion 2026-09-28.** Sau kana đúng, card có example sentence chứa nguyên một từ theo `Intl.Segmenter` chuyển sang cloze; compound không bị cắt sai, câu dịch và choices/reading/meaning lấy từ card thật cùng language. Nếu chỉ có một card, người học gõ bằng IME. Đã mở tám PNG actual Classic/Crystal × light/dark × desktop/mobile và so với ô Japanese sentence trong `GridLangPractice-comparison.png`, sau đó tạo đúng tám baseline Chromium; visual rerun 8/8, focused unit 15/15, lint/i18n/build/bundle pass (initial JS 70.986/71.000 B, CSS 29.480/29.500 B gzip). Không thêm Firestore I/O. Checkbox còn mở vì bố cục token và panel giải thích trong Canvas chưa khớp hoàn toàn; German vẫn wave 2.
  > **Choice-order correction 2026-09-28.** Các lựa chọn cloze cùng khóa học đổi vị trí ổn định theo card ID; đáp án đúng không còn luôn ở ô đầu. Focused unit 16/16 và Chromium Japanese sentence completion 8/8 pass; đã xem ảnh actual desktop/mobile. Không thêm Firestore I/O hay đổi baseline. Canvas checkbox vẫn mở như trên.
  > **CJK reading 2026-09-28.** KO/JA/ZH card front chỉ hiện reading do lazy language pack tạo, mặc định mở và có toggle ẩn/hiện; không lặp raw `phonetic` như IPA English. Mounted state test kiểm hydration, toggle và đổi KO→ZH. Emulator E2E 6/6 ở KO/JA/ZH Classic light desktop và Crystal dark mobile; đã mở cả sáu ảnh actual so `GridLangCardCJK`/`GridAnimeLangCard`. Unit 5/5, lint/i18n/build/bundle pass (initial JS 70.986/71.000 B, CSS 29.480/29.500 B gzip). Không thêm Firestore I/O hay baseline vì visual spec capture-only. Full Canvas comparison còn mở do bố cục card và content-rich panels khác reference.
  > **Reading touch/locale evidence 2026-09-28.** Toggle có target tối thiểu 44×44px; Chromium đo bounding box và kiểm ẩn/hiện cho KO/JA/ZH trên Classic/Crystal × light/dark × desktop/mobile (24/24 pass). Thêm ba ca 360px en/vi/pseudo; đã mở ba PNG actual kiểm reading, bản dịch UI và không tràn ngang, 3/3 pass. Bốn assertion tier cũ đã cập nhật đúng Bud/Nụ và pass 4/4. Không thêm Firebase I/O hay baseline; full Canvas comparison vẫn mở.
  > **Japanese cloze composition 2026-09-28.** Câu được chia bằng tokenizer của language pack thành token tiles, giữ dấu câu ở ngoài tile; đáp án, bốn lựa chọn và `explanation` đều lấy từ card hiện có. Đã sửa spacing để dấu `。` không rơi riêng dòng ở desktop. Mở tám ảnh actual Classic/Crystal × sáng/tối × desktop/mobile, so `GridLangPractice-comparison.png`, rồi cập nhật đúng tám baseline Chromium; visual rerun 8/8 và focused unit 19/19 pass. Build/bundle pass (initial JS 70.935/71.000 B, CSS 29.495/29.500 B gzip). `i18n:check` vẫn đỏ vì các catalog khác đã dirty trong working tree; extraction của task này chỉ cập nhật source-line references trong `practice.po`, không có message mới. Không thêm Firestore I/O; checklist Canvas toàn phase giữ mở.
  > **Korean review breakdown 2026-09-28.** Review card KO (kể cả `ko-KR`) hiện panel Hangul bên cạnh card desktop và bên dưới card mobile, vẫn hiện khi lật mặt. Jamo và Revised Romanization được tính từ bảng mapping sẵn có; không bịa giải thích âm vị hay thống kê khóa học. Panel lazy-load cả CSS để giữ initial budget. Đã mở tám ảnh actual Classic/Crystal × light/dark × desktop/mobile và so `LangReview` light/dark; E2E visual/behavior 8/8 và focused unit 29/29 pass, a11y không có vi phạm serious/critical; lint/i18n/build/bundle pass (initial JS 70.986/71.000 B, CSS 29.480/29.500 B gzip). Không thêm Firestore I/O hay baseline (capture-only). Checkbox còn mở vì panel trái/dữ liệu course và phonological note trong Canvas chưa có nguồn hợp lệ.
  > **Korean review placement 2026-09-28.** Dịch panel breakdown sang phải để khớp khoảng cách với card trên `LangReview-light.png`; dưới 1320px panel trở xuống dưới card và dùng hai cột từ 640px. Đã mở tám ảnh actual Classic/Crystal × sáng/tối × desktop/mobile: panel không đè card ở desktop, mobile không tràn ngang. Focused unit 23/23, Chromium visual/behavior 8/8, lint và build/bundle pass (initial JS 70.931/71.000 B, CSS 29.495/29.500 B gzip); screenshot capture-only, không cập nhật baseline. Không thêm Firestore I/O; full Canvas checkbox còn mở do dữ liệu course và phonological note vẫn thiếu nguồn.
- [x] Chạy focused checks rồi gates; ghi revision, kết quả và ngoại lệ trong log. (2026-09-28) — `tsc`, lint, `i18n:extract` và `i18n:check` pass đủ 12 catalogs; `verify:deploy` pass: frontend core 2200/2200, Functions unit 406/406, Rules 86/86 và Functions emulator integration 42/42. Focused Functions persistence 93/93, frontend 47/47, Japanese UI 10/10, Rules pitch 1/1; Chromium Paths/Progress + language-practice 50/50. Review phát hiện Reading toggle làm mất kana khi có pitch; đã sửa để hiển thị cả hai, thêm test cho stale reading/review và rename recomputation rồi chạy lại focused gates, `tsc`, i18n, build/bundle. Initial JS 70.986/71.000 B, CSS 29.499/29.500 B gzip. Japanese pitch field, server validation, Rules, rendering và visual capture đã tích hợp; không thêm Firestore document I/O. Không tick full Canvas comparison.

## Verification

Pack/Unicode/IME/TTS focused tests; visual LangCard/Review/Practice four target languages; course switch journeys sau 10; gates chung; golden-set chạy riêng khi có quyền.

Hợp đồng chung: [acceptance-contract.md](acceptance-contract.md). Tên test mới là đề xuất; trước chạy phải kiểm inventory file thực, không báo file vắng là PASS. Với flow có mutation, test dùng emulator/fixtures, không dữ liệu người học hay Gemini thật.

## Rủi ro và rollback

CJK dùng system font fallback theo R10; không nhét font lớn vượt budget. Các language wave chưa mở không bị quảng cáo đã usable.

Rollback theo commit scope hoặc flag additive đã review; không delete/reset dữ liệu hay dirty work. Bước phụ thuộc sau chỉ nhận contract đã kiểm chứng. Không deploy trong công việc lập kế hoạch này.
