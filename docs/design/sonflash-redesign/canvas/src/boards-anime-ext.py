# Crystal Star — extension, mobile and motion boards (executed by build.py with its globals).
add('GridAnimeExtAll', grid('GridAnimeExtAll', 'Anime extension popup', [
    ('AnimeExtPopup', 'state="idle"', 380, 640, 'Idle'),
    ('AnimeExtPopup', 'state="quick"', 380, 640, 'Quick translate'),
    ('AnimeExtPopup', 'state="saved"', 380, 640, 'Saved'),
    ('AnimeExtPopup', 'state="error"', 380, 640, 'Error'),
    ('AnimeExtPopup', 'state="loop"', 380, 640, 'Back to app'),
    ('AnimeExtPopup', 'state="quota"', 380, 640, 'AI quota'),
    ('AnimeExtContextMenu', '', 380, 640, 'Context menu'),
]), 'Crystal Star · Extension popup - idle, quick, saved, error, loop, quota, context menu')
add('PairAnimeExtInPage', pair('PairAnimeExtInPage', 'Anime extension in page', *tp('AnimeExtInPage'), 1200, 760), 'Crystal Star · Extension bubble - selection lookup on any page')
add('PairAnimeExtOptions', pair('PairAnimeExtOptions', 'Anime extension options', *tp('AnimeExtOptions'), 960, 900), 'Crystal Star · Extension options - loadout page')
add('GridAnimeMobileAll', grid('GridAnimeMobileAll', 'Anime mobile', [
    ('AnimeMobile', f'screen="{sc}"', 390, 844, cap) for sc, cap in (
        ('today', 'Home'), ('review', 'Review'), ('recap', 'Result'), ('quiz', 'Quiz'),
        ('sheet', 'Practice sheet'), ('onboard', 'Onboarding'), ('paywall', 'Pro'))
]), 'Crystal Star · Mobile app - lobby, review, result, quiz, practice sheet, onboarding, Pro')
add('PairAnimeMotion', pair('PairAnimeMotion', 'Anime motion', *tp('AnimeMotion'), 1440, 900), 'Crystal Star · Motion spec - deal, wings, transform flip, combo, tier up')

ANIME_SRC.update({
    'GridAnimeExtAll': 'AnimeExtPopup', 'PairAnimeExtInPage': 'AnimeExtInPage', 'PairAnimeExtOptions': 'AnimeExtOptions',
    'GridAnimeMobileAll': 'AnimeMobile', 'PairAnimeMotion': 'AnimeMotion',
})
ANIME_GROUPS.append(('anime-ext', 'Crystal Star — extension, mobile and motion',
                     ['GridAnimeMobileAll', 'GridAnimeExtAll', 'PairAnimeExtInPage', 'PairAnimeExtOptions', 'PairAnimeMotion']))
