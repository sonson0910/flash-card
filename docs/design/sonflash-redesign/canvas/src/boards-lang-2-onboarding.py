# Multilingual onboarding and language settings: what you speak, what you learn, level, script primer.
# Executed by build.py with its globals (add, grid, pair, tp, ANIME_SRC, LANG_GROUPS).
add('GridLangOnboarding', grid('GridLangOnboarding', 'Language onboarding', [
    ('LangOnboarding', f'step="{k}"', 1440, 900, c) for k, c in [('speak', '1 I speak'), ('learn', '2 I want to learn'), ('level', '3 Level and exam'), ('script', '4 Script primer')]
]), 'Onboarding — native language (drives app + meanings), target language, level/exam per target, Hangul primer')
add('PairLangSettings', pair('PairLangSettings', 'Language settings', *tp('LangSettings'), 1440, 900), 'Settings — app language, meaning language, per-course pronunciation, voice, keyboard')
add('GridAnimeLangOnboarding', grid('GridAnimeLangOnboarding', 'Anime language onboarding', [
    ('AnimeLangOnboarding', f'step="{k}"', 1440, 900, c) for k, c in [('learn', 'What to learn'), ('level', 'Level and exam')]
]), 'Crystal Star · Onboarding — pick a language crystal, level and exam goal')
ANIME_SRC.update({'GridLangOnboarding': 'LangOnboarding', 'PairLangSettings': 'LangSettings', 'GridAnimeLangOnboarding': 'AnimeLangOnboarding'})
LANG_GROUPS.append(('lang-onboarding', 'Multilingual — choose what you speak and what you learn',
                    ['GridLangOnboarding', 'PairLangSettings', 'GridAnimeLangOnboarding']))
