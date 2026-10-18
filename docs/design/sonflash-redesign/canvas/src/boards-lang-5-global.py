# Multilingual global surfaces: landing, UI-locale specimen, extension language routing.
# Executed by build.py with its globals (add, pair, grid, tp, ANIME_SRC, LANG_GROUPS).
add('PairLangLanding', pair('PairLangLanding', 'Global landing', *tp('LangLanding'), 1440, 900),
    'Multilingual · Landing — pick any of 7 languages on the live card, interface-language picker, local-currency price')
add('PairLangLocales', pair('PairLangLocales', 'UI locales specimen', *tp('LangLocales'), 1440, 900),
    'Multilingual · UI locales — one screen in 6 languages + pseudo-locale, i18n layout rules')
add('GridLangExt', grid('GridLangExt', 'Extension language routing', [
    ('LangExt', f'state="{k}"', 380, 640, c) for k, c in [('detect', 'Page language detected'), ('mismatch', 'No course for this language'), ('reading', 'Japanese reading')]
]), 'Multilingual · Extension — auto-detected course, missing-course choice, furigana reading')
add('PairLangExtInPage', pair('PairLangExtInPage', 'Extension on a Korean page', *tp('LangExtInPage'), 1200, 760),
    'Multilingual · Extension — selection bubble on a Korean article, meaning in Vietnamese')
ANIME_SRC.update({'PairLangLanding': 'LangLanding', 'PairLangLocales': 'LangLocales', 'GridLangExt': 'LangExt', 'PairLangExtInPage': 'LangExtInPage'})
LANG_GROUPS.append(('lang-global', 'Multilingual — global landing, UI locales and extension',
                    ['PairLangLanding', 'PairLangLocales', 'GridLangExt', 'PairLangExtInPage']))
