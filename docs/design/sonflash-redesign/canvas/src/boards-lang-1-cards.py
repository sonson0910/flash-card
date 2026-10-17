# Multilingual target-language packs: one card per studied language, the Korean course review, anime cards.
# Executed by build.py with its globals (add, pair, grid, tp, ANIME_SRC, LANG_GROUPS). Sources come from gen/lang_cards.py.
_C = lambda comp, lang, cap: (comp, f'lang="{lang}"', 720, 780, cap)
add('PairLangReview', pair('PairLangReview', 'Korean course review', *tp('LangReview'), 1440, 900),
    'Multilingual · Korean course review (native: Vietnamese) — course switcher, romanization toggle, Hangul breakdown, grades')
add('GridLangCardCJK', grid('GridLangCardCJK', 'Language packs — CJK', [
    _C('LangCard', 'ko', 'Korean ← Vietnamese · Hangul + romanization'),
    _C('LangCard', 'ja', 'Japanese ← Vietnamese · furigana + pitch accent'),
    _C('LangCard', 'zh', 'Chinese ← Vietnamese · pinyin tones'),
]), 'Multilingual · CJK packs — Hangul blocks, furigana ruby + pitch accent, pinyin tone colours, Hán Việt bridge')
add('GridLangCardLatin', grid('GridLangCardLatin', 'Language packs — Latin script', [
    _C('LangCard', 'en', 'English ← Vietnamese · stress + UK/US'),
    _C('LangCard', 'fr', 'French ← English · gender article'),
    _C('LangCard', 'de', 'German ← English · der/die/das + plural'),
    _C('LangCard', 'es', 'Spanish ← English · ES/LatAm accents'),
]), 'Multilingual · Latin-script packs — stress, IPA variants, grammatical gender, plurals')
add('GridAnimeLangCard', grid('GridAnimeLangCard', 'Anime language packs', [
    _C('AnimeLangCard', 'ko', 'Korean ← Vietnamese'),
    _C('AnimeLangCard', 'ja', 'Japanese ← Vietnamese'),
    _C('AnimeLangCard', 'zh', 'Chinese ← Vietnamese'),
    _C('AnimeLangCard', 'de', 'German ← English'),
]), 'Crystal Star · language packs — Korean, Japanese, Chinese, German')
ANIME_SRC.update({'PairLangReview': 'LangReview', 'GridLangCardCJK': 'LangCard', 'GridLangCardLatin': 'LangCard', 'GridAnimeLangCard': 'AnimeLangCard'})
LANG_GROUPS.append(('lang-cards', 'Multilingual — one card, every language (target-language packs)',
                    ['PairLangReview', 'GridLangCardCJK', 'GridLangCardLatin', 'GridAnimeLangCard']))
