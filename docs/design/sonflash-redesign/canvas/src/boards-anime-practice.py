# Crystal Star practice modes: quiz, spelling, word match, shadowing.
for _name, _comp, _title, _caption in [
    ('PairAnimeQuiz', 'AnimeQuiz', 'Anime quiz', 'Crystal Star · Practice Quiz — pick the word, crystal verdict, combo chip, Lumi explains'),
    ('PairAnimeSpelling', 'AnimeSpelling', 'Anime spelling', 'Crystal Star · Practice Spelling — hex audio orb, letter crystals, missing-letter feedback'),
    ('PairAnimeMatch', 'AnimeMatch', 'Anime word match', 'Crystal Star · Practice Word Match — 60s sprint, hex timer, pair combos'),
    ('PairAnimeShadowing', 'AnimeShadowing', 'Anime shadowing', 'Crystal Star · Practice Shadowing — sync meter, model vs take waveforms, record hex'),
]:
    add(_name, pair(_name, _title, *tp(_comp), 1440, 900), _caption)
    ANIME_SRC[_name] = _comp
ANIME_GROUPS.append(('anime-practice', 'Crystal Star — practice modes', ['PairAnimeQuiz', 'PairAnimeSpelling', 'PairAnimeMatch', 'PairAnimeShadowing']))
