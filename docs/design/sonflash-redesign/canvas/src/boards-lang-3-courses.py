# Multilingual courses: several (target, native) courses and one switcher — web, mobile, Crystal Star.
add('GridLangCourses', grid('GridLangCourses', 'Language courses', [
    ('LangCourses', f'state="{k}"', 1440, 900, c) for k, c in [('open', 'Course switcher open'), ('add', 'Add a language'), ('switched', 'Switched to 日本語')]
]), 'Multilingual · Course switcher — 한국어 / 日本語 / English from Tiếng Việt, add a language, switched state')
add('GalleryLangMobile', gallery('GalleryLangMobile', 'Mobile courses', [
    ('LangMobile', 'theme="dark" screen="courses"', 390, 844, 'Courses sheet · dark', True),
    ('LangMobile', 'theme="dark" screen="review"', 390, 844, 'Korean card · dark', True),
    ('LangMobile', 'theme="light" screen="courses"', 390, 844, 'Courses sheet · light', False),
    ('LangMobile', 'theme="light" screen="review"', 390, 844, 'Korean card · light', False),
], gap=70), 'Multilingual · Mobile — course switcher sheet, Korean review card with romanization and audio')
add('GridAnimeLangCourses', grid('GridAnimeLangCourses', 'Anime course select', [
    ('AnimeLangCourses', f'state="{k}"', 1440, 900, c) for k, c in [('open', 'Course select'), ('switched', 'Switched to 日本語')]
]), 'Crystal Star · Course select — one course per language, Lumi, extension save target')
ANIME_SRC.update({'GridLangCourses': 'LangCourses', 'GalleryLangMobile': 'LangMobile', 'GridAnimeLangCourses': 'AnimeLangCourses'})
LANG_GROUPS.append(('lang-courses', 'Multilingual — several courses, one switcher', ['GridLangCourses', 'GalleryLangMobile', 'GridAnimeLangCourses']))
