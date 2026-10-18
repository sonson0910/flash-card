# Crystal Star anime batch: lessons, story, placement, stage bridge, edit sheet.
add('PairAnimeLessonBridge', pair('PairAnimeLessonBridge', 'Anime step bridge', *tp('AnimeBridge'), 1440, 900), 'Crystal Star · Step bridge — combo carry-over, dealt card, next step countdown')
add('GridAnimeLesson', grid('GridAnimeLesson', 'Anime lesson', [('AnimeLesson', f'state="{k}"', 1440, 900, c) for k, c in [('typing', 'Cloze · typing'), ('correct', 'Cloze · PERFECT')]]), 'Crystal Star · Cloze lesson — active recall, hint letters, perfect clear')
add('PairAnimeStory', pair('PairAnimeStory', 'Anime story', *tp('AnimeStory'), 1440, 900), 'Crystal Star · Story mode — Lumi narrates, tap words for gloss')
add('PairAnimePlacement', pair('PairAnimePlacement', 'Anime placement', *tp('AnimePlacement'), 1440, 900), 'Crystal Star · Level check — placement check, learning path')
add('PairAnimeEditSheet', pair('PairAnimeEditSheet', 'Anime edit sheet', *tp('AnimeEditSheet'), 1440, 900), 'Crystal Star · Edit card sheet — paused review, AI meaning picks')
ANIME_SRC.update({'PairAnimeLessonBridge': 'AnimeBridge', 'GridAnimeLesson': 'AnimeLesson', 'PairAnimeStory': 'AnimeStory', 'PairAnimePlacement': 'AnimePlacement', 'PairAnimeEditSheet': 'AnimeEditSheet'})
ANIME_GROUPS.append(('anime-lessons', 'Crystal Star — lessons, story, placement', ['PairAnimeLessonBridge', 'GridAnimeLesson', 'PairAnimeStory', 'PairAnimePlacement', 'PairAnimeEditSheet']))
