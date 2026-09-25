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

- [ ] 09.1 — Lazy registry en/ko/ja/zh; rendering/normalization/tokenization/speech/goal catalog capabilities.
- [ ] 09.2 — Headword đúng ngôn ngữ: English stress; Hangul/romanization; Kanji/furigana; Hanzi/pinyin/tones.
- [ ] 09.3 — Unicode speech score/tokenization: Intl.Segmenter và fallback đã kiểm; ASR/TTS/voice theo pack, permission/no voice/no support.
- [ ] 09.4 — IME composition, grapheme-aware spelling, sentence building/quiz/match/story theo target/native pair.
- [ ] 09.5 — Server pair allowlist và prompt notes giữ model Flash-Lite; generation output/reading metadata round-trip.
- [ ] 09.6 — Golden set 20 terms mỗi pack, human language review và đo cost trước enable; wave2 es/de và wave3 fr/pt giữ tasks/registry availability.
- [ ] Đối chiếu Canvas từng state của phase theo board/artboard inventory; reviewer kiểm tra cả hành vi và hình thức.
- [ ] Chạy focused checks rồi gates; ghi revision, kết quả và ngoại lệ trong log.

## Verification

Pack/Unicode/IME/TTS focused tests; visual LangCard/Review/Practice four target languages; course switch journeys sau 10; gates chung; golden-set chạy riêng khi có quyền.

Hợp đồng chung: [acceptance-contract.md](acceptance-contract.md). Tên test mới là đề xuất; trước chạy phải kiểm inventory file thực, không báo file vắng là PASS. Với flow có mutation, test dùng emulator/fixtures, không dữ liệu người học hay Gemini thật.

## Rủi ro và rollback

CJK dùng system font fallback theo R10; không nhét font lớn vượt budget. Các language wave chưa mở không bị quảng cáo đã usable.

Rollback theo commit scope hoặc flag additive đã review; không delete/reset dữ liệu hay dirty work. Bước phụ thuộc sau chỉ nhận contract đã kiểm chứng. Không deploy trong công việc lập kế hoạch này.
