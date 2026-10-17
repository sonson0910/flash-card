# Crystal Star anime batch: Pro, paywalls, streak and growth surfaces.
for _n, _t, _c, _cap in [
    ('PairAnimeLandingSales', 'Anime landing sales', 'AnimeLandingSales', 'Crystal Star · Landing sales — live flip demo, reviews, Free vs Pro, quest log FAQ'),
    ('PairAnimeProStates', 'Anime Pro states', 'AnimeProStates', 'Crystal Star · Pro states — trial ending, account menu, downgrade, AI quota, referral toast'),
    ('PairAnimeReferral', 'Anime referral', 'AnimeReferral', 'Crystal Star · Referral — party up, give 7 days get 7 days, reward route'),
    ('PairAnimeSettings', 'Anime settings', 'AnimeSettings', 'Crystal Star · Settings — reminders, channels, sounds and haptics'),
]:
    add(_n, pair(_n, _t, *tp(_c), 1440, 900), _cap)
    ANIME_SRC[_n] = _c

add('GridAnimePaywall', grid('GridAnimePaywall', 'Anime paywall', [('AnimePaywall', f'moment="{k}"', 720, 780, c) for k, c in [('recap', 'After recap'), ('ai', 'AI quota used'), ('streak', 'Streak at risk'), ('band', 'Band projection')]]), 'Crystal Star · Paywall moments — story, AI quota, streak at risk, band')
add('GridAnimeCheckout', grid('GridAnimeCheckout', 'Anime checkout', [('AnimeCheckout', 'step="pay"', 720, 780, 'Pay · MoMo ZaloPay VNPay card'), ('AnimeCheckout', 'step="success"', 720, 780, 'Welcome to Pro')]), 'Crystal Star · Checkout — pay, welcome to Pro')
add('GridAnimeStreak', grid('GridAnimeStreak', 'Anime streak', [('AnimeStreak', f'state="{k}"', 720, 780, c) for k, c in [('freeze', 'Freeze used'), ('repair', 'Repair'), ('milestone', '30-day milestone')]]), 'Crystal Star · Streak dialogs — freeze, repair, 30-day milestone')
ANIME_SRC.update({'GridAnimePaywall': 'AnimePaywall', 'GridAnimeCheckout': 'AnimeCheckout', 'GridAnimeStreak': 'AnimeStreak'})

ANIME_GROUPS.append(('anime-money', 'Crystal Star — Pro, paywalls, streak and growth', [
    'PairAnimeLandingSales', 'GridAnimePaywall', 'GridAnimeCheckout', 'PairAnimeProStates', 'GridAnimeStreak', 'PairAnimeReferral', 'PairAnimeSettings',
]))
