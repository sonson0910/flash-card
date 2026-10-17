# Crystal Star library batch: vocabulary, paths, progress, web-words inbox, weekly share card.
# Executed by build.py with its globals (add, pair, tp, ANIME_SRC, ANIME_GROUPS).
_LIBRARY = [
    ('PairAnimeVocabulary', 'Anime vocabulary', 'AnimeVocabulary', 'Crystal Star · Word garden — deck tabs, grade filters, tilting Bud/Bloom/Star mini cards'),
    ('PairAnimePaths', 'Anime paths', 'AnimePaths', 'Crystal Star · Journeys — IELTS core unit route, shelf of journeys'),
    ('PairAnimeProgress', 'Anime progress', 'AnimeProgress', 'Crystal Star · Study diary — heatmap, Star ring, due forecast'),
    ('PairAnimeWebWords', 'Anime web words', 'AnimeWebWords', 'Crystal Star · Web words inbox — saved sentences by article'),
    ('PairAnimeWeeklyRecap', 'Anime weekly recap', 'AnimeWeeklyRecap', 'Crystal Star · Weekly share card — Star share card, share targets'),
]
for _board, _title, _comp, _cap in _LIBRARY:
    add(_board, pair(_board, _title, *tp(_comp), 1440, 900), _cap)
    ANIME_SRC[_board] = _comp
ANIME_GROUPS.append(('anime-library', 'Crystal Star — library, paths, progress', [b for b, *_ in _LIBRARY]))
