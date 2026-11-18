# Crystal Star — dialogs, feedback and system states (executed by build.py with its globals).
add('GridAnimeDlgStudy', grid('GridAnimeDlgStudy', 'Anime study dialogs', [
    ('AnimeDlgStudy', f'kind="{k}"', 720, 780, c) for k, c in [('practice', 'Practice mode'), ('tutor', 'Lumi AI tutor'), ('create', 'Add a word with AI'), ('edit', 'Edit card')]
]), 'Crystal Star · Dialogs study - practice menu, Lumi AI tutor, add word, edit card')
add('GridAnimeDlgStream', grid('GridAnimeDlgStream', 'Anime AI streaming', [
    ('AnimeDlgStudy', 'kind="stream"', 720, 780, 'AI card streaming'),
]), 'Crystal Star · Dialogs AI streaming - card writes itself field by field')
add('GridAnimeDlgLibrary', grid('GridAnimeDlgLibrary', 'Anime library dialogs', [
    ('AnimeDlgLibrary', f'kind="{k}"', 720, 780, c) for k, c in [('extract', 'Scan text'), ('share', 'Share deck'), ('sharein', 'Shared deck received'), ('insights', 'Learning insights')]
]), 'Crystal Star · Dialogs library - scan text, share, incoming share, insights')
add('GridAnimeDlgManage', grid('GridAnimeDlgManage', 'Anime manage dialogs', [
    ('AnimeDlgManage', f'kind="{k}"', 720, 780, c) for k, c in [('decknew', 'New deck'), ('deckdelete', 'Delete deck'), ('clear', 'Clear library'), ('import', 'Import')]
]), 'Crystal Star · Dialogs manage - new deck, delete deck, clear library, import')
add('PairAnimeFeedback', pair('PairAnimeFeedback', 'Anime feedback and menus', *tp('AnimeFeedback'), 1440, 900), 'Crystal Star · Feedback - toasts, rewards, sync status, account and library menus')
add('PairAnimeSystem', pair('PairAnimeSystem', 'Anime system states', *tp('AnimeSystem'), 1440, 900), 'Crystal Star · System states - error, offline, empty, all caught up, loading')

ANIME_SRC.update({
    'GridAnimeDlgStudy': 'AnimeDlgStudy', 'GridAnimeDlgStream': 'AnimeDlgStudy', 'GridAnimeDlgLibrary': 'AnimeDlgLibrary',
    'GridAnimeDlgManage': 'AnimeDlgManage', 'PairAnimeFeedback': 'AnimeFeedback', 'PairAnimeSystem': 'AnimeSystem',
})
ANIME_GROUPS.append(('anime-dialogs', 'Crystal Star — dialogs, feedback and system states',
                     ['GridAnimeDlgStudy', 'GridAnimeDlgStream', 'GridAnimeDlgLibrary', 'GridAnimeDlgManage', 'PairAnimeFeedback', 'PairAnimeSystem']))
