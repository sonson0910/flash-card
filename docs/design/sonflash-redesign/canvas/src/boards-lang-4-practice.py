# Multilingual — practice modes that only exist in a target-language pack (Hangul blocks, kana reading,
# Mandarin tones, noun gender, word segmentation). Executed by build.py with its globals.
add('GridLangPractice', grid('GridLangPractice', 'Language-pack practice', [
    ('LangPractice', f'kind="{k}"', 720, 780, c) for k, c in [
        ('hangul', 'Korean · build syllable blocks'), ('kana', 'Japanese · type the reading'),
        ('tone', 'Chinese · hear the tones'), ('article', 'German · der / die / das'), ('segment', 'Japanese · sentence without spaces')]
]), 'Multilingual · Practice modes per language pack — Hangul blocks, kana reading + pitch, Mandarin tones, noun gender, segmented cloze')
add('GridAnimeLangPractice', grid('GridAnimeLangPractice', 'Anime language-pack practice', [
    ('AnimeLangPractice', f'kind="{k}"', 720, 780, c) for k, c in [
        ('hangul', 'Korean · syllable builder'), ('kana', 'Japanese · reading check'),
        ('tone', 'Chinese · tone match'), ('article', 'German · der / die / das sort')]
]), 'Crystal Star · Practice modes per language pack — Hangul, kana, tones, der/die/das')
ANIME_SRC.update({'GridLangPractice': 'LangPractice', 'GridAnimeLangPractice': 'AnimeLangPractice'})
LANG_GROUPS.append(('lang-practice', 'Multilingual — practice modes per language pack', ['GridLangPractice', 'GridAnimeLangPractice']))
