"""Builds canvas artboards from src/ templates and lays out the canvas index."""
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / 'src'
OUT = ROOT / 'project'
SEED = ROOT / 'seed'
CHECK = '--check' in sys.argv
OUT.mkdir(exist_ok=True)
for seed_file in SEED.iterdir():
    if seed_file.is_file() and not (CHECK and seed_file.name == 'canvas.json'):
        shutil.copyfile(seed_file, OUT / seed_file.name)

parts = {}
chunks = re.split(r'<!--@@(\w+)-->\n', (SRC / 'partials.html').read_text())
for name, body in zip(chunks[1::2], chunks[2::2]):
    parts[name] = body
tokens_js = (SRC / 'tokens.js').read_text() + parts['NAVJS']
atokens_js = (SRC / 'anime-tokens.js').read_text()

review_css = re.search(r'<style>\n(.*?)</style>', (OUT / 'Review.dc.html').read_text(), re.S).group(1)
SHARED_CSS = review_css + '''
.sf-press{transition:transform 180ms cubic-bezier(.16,1,.3,1), filter 180ms ease}
.sf-press:hover{transform:translateY(-2px);filter:brightness(1.06)}
.sf-press:active{transform:translateY(0) scale(.97)}
.sf-lift{transition:transform 260ms cubic-bezier(.16,1,.3,1), box-shadow 260ms ease}
.sf-lift:hover{transform:translateY(-6px) rotate(-.6deg)}
@keyframes sf-fall-k{0%{transform:translate3d(0,-20px,0) rotate(0)}100%{transform:translate3d(40px,960px,0) rotate(540deg)}}
.sf-fall{animation-name:sf-fall-k;animation-timing-function:linear;animation-iteration-count:infinite}
@keyframes sf-rise-k{from{opacity:0;transform:translate3d(0,14px,0)}to{opacity:1;transform:none}}
.sf-rise{animation:sf-rise-k 600ms cubic-bezier(.16,1,.3,1) both}
.sf-rise-2{animation:sf-rise-k 600ms cubic-bezier(.16,1,.3,1) 120ms both}
.sf-rise-3{animation:sf-rise-k 600ms cubic-bezier(.16,1,.3,1) 700ms both}
@keyframes sf-deal-k{from{opacity:0;transform:translate3d(0,60px,0) scale(.9) rotate(-8deg)}to{opacity:1;transform:none}}
.sf-deal-1{animation:sf-deal-k 700ms cubic-bezier(.16,1,.3,1) 250ms both}
.sf-deal-2{animation:sf-deal-k 700ms cubic-bezier(.16,1,.3,1) 380ms both}
.sf-deal-3{animation:sf-deal-k 700ms cubic-bezier(.16,1,.3,1) 510ms both}
@keyframes sf-sheen-k{0%,100%{background-position:100% 0}50%{background-position:0 0}}
.sf-sheen{animation:sf-sheen-k 3.6s ease-in-out infinite}
@keyframes sf-grow-k{from{transform:scaleX(.2)}to{transform:scaleX(1)}}
.sf-grow{transform-origin:left;animation:sf-grow-k 1.1s cubic-bezier(.16,1,.3,1) 800ms both}
@keyframes sf-bob-k{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(0,-8px,0)}}
.sf-bob-a{animation:sf-bob-k 5s ease-in-out infinite}
.sf-bob-b{animation:sf-bob-k 6s ease-in-out 1s infinite}
@keyframes sf-pop-k{from{opacity:0;transform:translate3d(0,-6px,0) scale(.96)}to{opacity:1;transform:none}}
.sf-pop{animation:sf-pop-k 380ms cubic-bezier(.16,1,.3,1) both;transform-origin:120px 0}
@keyframes sf-pulse-k{0%,100%{box-shadow:0 0 0 0 var(--sf-pulse, rgb(40 211 244 / 0.45))}50%{box-shadow:0 0 0 14px transparent}}
.sf-pulse{animation:sf-pulse-k 1.6s ease-out infinite}
@keyframes sf-wave-k{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}
.sf-wave{transform-origin:center;animation:sf-wave-k 900ms ease-in-out infinite}
@keyframes sf-shimmer-k{from{background-position:200% 0}to{background-position:-200% 0}}
.sf-shimmer{background-size:200% 100%;animation:sf-shimmer-k 1.6s linear infinite}
@keyframes sf-spin-k{to{transform:rotate(360deg)}}
.sf-spin{animation:sf-spin-k 900ms linear infinite}
@keyframes sf-shake-k{0%,100%{transform:none}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
.sf-shake{animation:sf-shake-k 320ms ease-in-out 2}
@keyframes nk-pop-k{0%{opacity:0;transform:scale(.6) rotate(-6deg)}70%{opacity:1;transform:scale(1.08) rotate(1deg)}100%{opacity:1;transform:none}}
.nk-pop{animation:nk-pop-k 520ms cubic-bezier(.34,1.56,.64,1) both}
.nk-pop-2{animation:nk-pop-k 520ms cubic-bezier(.34,1.56,.64,1) 140ms both}
.nk-pop-3{animation:nk-pop-k 520ms cubic-bezier(.34,1.56,.64,1) 280ms both}
@keyframes nk-stamp-k{0%{opacity:0;transform:scale(2.6) rotate(-32deg)}60%{opacity:1;transform:scale(.92) rotate(-10deg)}100%{opacity:1;transform:scale(1) rotate(-12deg)}}
.nk-stamp{animation:nk-stamp-k 620ms cubic-bezier(.34,1.56,.64,1) 400ms both}
@keyframes nk-spark-k{0%,100%{opacity:0;transform:scale(0) rotate(0)}50%{opacity:1;transform:scale(1) rotate(45deg)}}
.nk-spark{animation:nk-spark-k 1.8s ease-in-out infinite}
@keyframes nk-speed-k{0%,100%{opacity:.55}50%{opacity:.9}}
.nk-speed{animation:nk-speed-k 1.2s steps(3) infinite}
@keyframes nk-sweep-k{to{--nk-a:360deg}}
@keyframes nk-spin-k{to{transform:rotate(360deg)}}
.nk-rim-spin{animation:nk-spin-k 6s linear infinite}
@keyframes nk-float-k{0%,100%{transform:translate3d(0,0,0) rotate(-2deg)}50%{transform:translate3d(0,-10px,0) rotate(2deg)}}
.nk-float{animation:nk-float-k 3.2s ease-in-out infinite}
@keyframes nk-slide-k{from{opacity:0;transform:translate3d(-60px,0,0) skewX(-12deg)}to{opacity:1;transform:none}}
.nk-slide{animation:nk-slide-k 480ms cubic-bezier(.16,1,.3,1) both}
.nk-slide-2{animation:nk-slide-k 480ms cubic-bezier(.16,1,.3,1) 90ms both}
.nk-slide-3{animation:nk-slide-k 480ms cubic-bezier(.16,1,.3,1) 180ms both}
.nk-slide-4{animation:nk-slide-k 480ms cubic-bezier(.16,1,.3,1) 270ms both}
@keyframes nk-flash-k{0%{opacity:.85}100%{opacity:0}}
.nk-flash{animation:nk-flash-k 700ms ease-out both}
@keyframes nk-bar-k{0%,100%{transform:scaleY(.3)}33%{transform:scaleY(1)}66%{transform:scaleY(.6)}}
.nk-bar{transform-origin:bottom;animation:nk-bar-k 600ms steps(3) infinite}
@keyframes nk-shine-k{0%{transform:translateX(-120%) skewX(-20deg)}60%,100%{transform:translateX(220%) skewX(-20deg)}}
.nk-shine{animation:nk-shine-k 2.8s ease-in-out infinite}
@keyframes nk-marquee-k{to{transform:translateX(-50%)}}
.nk-marquee{animation:nk-marquee-k 24s linear infinite}
.nk-press{transition:transform 160ms cubic-bezier(.34,1.56,.64,1), box-shadow 160ms ease}
.nk-press:hover{transform:translate(-2px,-2px)}
.nk-press:active{transform:translate(3px,3px);box-shadow:0 0 0 transparent !important}
@keyframes nk-meteor-k{0%{opacity:0;transform:translate3d(0,0,0) rotate(-35deg)}8%{opacity:1}30%,100%{opacity:0;transform:translate3d(-420px,300px,0) rotate(-35deg)}}
.nk-meteor{transform:rotate(-35deg);animation:nk-meteor-k 6s ease-in infinite}
@keyframes nk-twinkle-k{0%,100%{opacity:.25;transform:scale(.6) rotate(0)}50%{opacity:1;transform:scale(1) rotate(20deg)}}
.nk-twinkle{animation:nk-twinkle-k 2.8s ease-in-out infinite}
@keyframes nk-drift-k{0%,100%{translate:0 0}50%{translate:60px 20px}}
.nk-drift{animation:nk-drift-k 18s ease-in-out infinite}
.nk-drift-b{animation:nk-drift-k 22s ease-in-out -6s infinite reverse}
@keyframes nk-rise-k{from{opacity:0;transform:translate3d(0,18px,0)}to{opacity:1;transform:none}}
.nk-rise{animation:nk-rise-k 700ms cubic-bezier(.16,1,.3,1) both}
.nk-rise-2{animation:nk-rise-k 700ms cubic-bezier(.16,1,.3,1) 120ms both}
.nk-rise-3{animation:nk-rise-k 700ms cubic-bezier(.16,1,.3,1) 240ms both}
.nk-lift{transition:transform 220ms cubic-bezier(.34,1.56,.64,1), box-shadow 220ms ease, filter 220ms ease}
.nk-lift:hover{transform:translateY(-3px);filter:brightness(1.06)}
.nk-lift:active{transform:translateY(0) scale(.97)}
@keyframes nk-flare-k{0%,100%{opacity:.55;transform:scale(.8) rotate(0)}50%{opacity:1;transform:scale(1.1) rotate(8deg)}}
.nk-flare{animation:nk-flare-k 3.4s ease-in-out infinite}
@keyframes nk-beam-k{0%,100%{opacity:.5;translate:0 0}50%{opacity:1;translate:40px 0}}
.nk-beam{animation:nk-beam-k 9s ease-in-out infinite}
@keyframes nk-starfield-k{0%,100%{opacity:.75}50%{opacity:1}}
.nk-starfield{animation:nk-starfield-k 4s ease-in-out infinite}
@keyframes nk-unfold-k{from{opacity:0;transform:scale(.4) rotate(-14deg)}to{opacity:1;transform:none}}
.nk-unfold{animation:nk-unfold-k 520ms cubic-bezier(.2,1.4,.4,1) both}
@keyframes nk-pillar-k{0%{opacity:0;transform:scaleX(.1)}30%{opacity:1;transform:scaleX(1)}100%{opacity:0;transform:scaleX(1.4)}}
.nk-pillar{animation:nk-pillar-k 800ms ease-out both}
@keyframes nk-banner-k{0%{opacity:0;transform:translateX(-80px) skewX(-16deg)}60%{opacity:1;transform:translateX(6px) skewX(-16deg)}100%{opacity:1;transform:skewX(-16deg)}}
.nk-banner{animation:nk-banner-k 520ms cubic-bezier(.2,1.4,.4,1) both}
@media (prefers-reduced-motion: reduce){.nk-flare,.nk-beam,.nk-starfield,.nk-unfold,.nk-pillar,.nk-banner{animation:none}}
@media (prefers-reduced-motion: reduce){.nk-meteor{animation:none;opacity:0}.nk-twinkle,.nk-drift,.nk-drift-b,.nk-rise,.nk-rise-2,.nk-rise-3{animation:none}.nk-lift{transition:none}}
@media (prefers-reduced-motion: reduce){.nk-pop,.nk-pop-2,.nk-pop-3,.nk-stamp,.nk-spark,.nk-speed,.nk-rim-spin,.nk-float,.nk-slide,.nk-slide-2,.nk-slide-3,.nk-slide-4,.nk-flash,.nk-bar,.nk-shine,.nk-marquee{animation:none}.nk-press{transition:none}}
@media (prefers-reduced-motion: reduce){.sf-fall,.sf-rise,.sf-rise-2,.sf-rise-3,.sf-deal-1,.sf-deal-2,.sf-deal-3,.sf-sheen,.sf-grow,.sf-bob-a,.sf-bob-b,.sf-pop,.sf-pulse,.sf-wave,.sf-shimmer,.sf-spin,.sf-shake{animation:none}.sf-fall{display:none}.sf-press,.sf-lift{transition:none}}
'''
COMPONENTS = sorted(f.name[:-len('.dc.html')] for f in SRC.glob('*.dc.html'))
for name in COMPONENTS:
    s = (SRC / f'{name}.dc.html').read_text()
    s = re.sub(r'<!--#HEAD (.*?)-->\n', lambda m: parts['HEAD'].replace('@TITLE', m.group(1)), s)
    s = re.sub(r'<!--#AHEAD (.*?)-->\n', lambda m: parts['AHEAD'].replace('@TITLE', m.group(1)), s)
    s = s.replace('<!--#ABG-->\n', parts['ABG']).replace('<!--#ANAV-->\n', parts['ANAV']).replace('<!--#WINGS-->\n', parts['WINGS'])
    s = re.sub(r'<!--#MASCOT ?(.*?)-->\n', lambda m: parts['MASCOT'].replace('@POSE', '{{lumiSrc}}' if m.group(1) == '$' else '{{t.lumi.' + (m.group(1) or 'idle') + '}}'), s)
    s = s.replace('<!--#STAR5-->\n', parts['STAR5'])
    s = s.replace('//#ATOKENS\n', atokens_js)
    s = s.replace('<!--#DLGOPEN-->\n', parts['DLGOPEN']).replace('<!--#DLGCLOSE-->\n', parts['DLGCLOSE'])
    s = s.replace('<!--#AMBIENT-->\n', parts['AMBIENT']).replace('<!--#NAV-->\n', parts['NAV'])
    s = s.replace('//#TOKENS\n', tokens_js)
    s = s.replace('<style>body{margin:0}</style>', '<style>body{margin:0}button{font-family:inherit}\n' + SHARED_CSS + '</style>')
    assert '<!--#' not in s and '//#' not in s, name
    assert s.count('<sc-if') == s.count('</sc-if>') and s.count('<sc-for') == s.count('</sc-for>'), name
    (OUT / f'{name}.dc.html').write_text(s)
if CHECK:
    print('compiled', len(COMPONENTS), 'components')
    sys.exit(0)

(ROOT / 'shared.css').write_text(SHARED_CSS)

HEAD = '''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..600&amp;family=Geist:wght@400;500;600;700&amp;family=Geist+Mono:wght@400;500&amp;family=Kanit:ital,wght@1,600;1,700;1,800;1,900&amp;family=Nunito:ital,wght@0,500;0,600;0,700;0,800;0,900;1,800&amp;display=swap" rel="stylesheet">
<style>
body{{margin:0}}
button{{font-family:inherit}}
{css}
</style>
</helmet>
'''
TAIL = '''</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"$preview":{{"width":{w},"height":{h}}}}}'>
class Component extends DCLogic {{
  renderVals() {{
    return {{}};
  }}
}}
</script>
</body>
</html>
'''
BG = 'linear-gradient(90deg, #03101a 0%, #03101a 50%, #e3dccd 50%, #e3dccd 100%)'


def label(text, dark):
    color = '#99a7b0' if dark else '#6b6255'
    return f'<div style="font-family: Geist, system-ui, sans-serif; font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: {color};">{text}</div>'


def pair(name, title, left, right, w, h, gap=80):
    """left/right: (component, extra attrs). Returns board size."""
    bw, bh = w * 2 + gap, h
    body = f'''<div style="width: {bw}px; height: {bh}px; display: flex; gap: {gap}px; background: {BG};">
  <div style="width: {w}px; height: {h}px; position: relative; overflow: hidden;"><dc-import name="{left[0]}" {left[1]} hint-size="{w}px,{h}px"></dc-import></div>
  <div style="width: {w}px; height: {h}px; position: relative; overflow: hidden;"><dc-import name="{right[0]}" {right[1]} hint-size="{w}px,{h}px"></dc-import></div>
</div>
'''
    (OUT / f'{name}.dc.html').write_text(HEAD.format(title=title, css=SHARED_CSS) + body + TAIL.format(w=bw, h=bh))
    return bw, bh


def gallery(name, title, items, pad=60, gap=60, labelled=True):
    """items: list of (component, attrs, w, h, caption, dark)."""
    maxh = max(i[3] for i in items)
    bw = pad * 2 + sum(i[2] for i in items) + gap * (len(items) - 1)
    bh = pad * 2 + maxh + (36 if labelled else 0)
    cells = []
    for comp, attrs, w, h, cap, dark in items:
        cells.append(f'''  <div style="display: flex; flex-direction: column; gap: 16px;">
    {label(cap, dark)}
    <div style="width: {w}px; height: {h}px; position: relative; overflow: hidden; border-radius: {28 if h > 800 else 16}px; box-shadow: 0 30px 60px -30px rgb(0 0 0 / 0.5);"><dc-import name="{comp}" {attrs} hint-size="{w}px,{h}px"></dc-import></div>
  </div>''')
    body = f'''<div style="width: {bw}px; height: {bh}px; box-sizing: border-box; padding: {pad}px; display: flex; align-items: flex-start; gap: {gap}px; background: linear-gradient(90deg, #03101a 0%, #03101a 50%, #e3dccd 50%, #e3dccd 100%);">
{chr(10).join(cells)}
</div>
'''
    (OUT / f'{name}.dc.html').write_text(HEAD.format(title=title, css=SHARED_CSS) + body + TAIL.format(w=bw, h=bh))
    return bw, bh


def grid(name, title, cols, pad=60, gap=60):
    """cols: list of (component, attrs, w, h, caption). Top row dark, bottom row light."""
    w = max(c[2] for c in cols)
    h = max(c[3] for c in cols)
    row_h = 36 + h
    bw = pad * 2 + sum(c[2] for c in cols) + gap * (len(cols) - 1)
    bh = pad * 4 + row_h * 2
    def row(theme, dark):
        cells = []
        for comp, attrs, cw, ch, cap in cols:
            cells.append(f'''  <div style="display: flex; flex-direction: column; gap: 16px;">
    {label(cap + ' · ' + theme, dark)}
    <div style="width: {cw}px; height: {ch}px; position: relative; overflow: hidden; border-radius: {28 if ch > 800 else 16}px; box-shadow: 0 30px 60px -30px rgb(0 0 0 / 0.5);"><dc-import name="{comp}" theme="{theme}" {attrs} hint-size="{cw}px,{ch}px"></dc-import></div>
  </div>''')
        return f'<div style="height: {row_h}px; display: flex; align-items: flex-start; gap: {gap}px;">\n' + '\n'.join(cells) + '\n</div>'
    body = f'''<div style="width: {bw}px; height: {bh}px; box-sizing: border-box; padding: {pad}px; display: flex; flex-direction: column; gap: {pad * 2}px; background: linear-gradient(180deg, #03101a 0%, #03101a 50%, #e3dccd 50%, #e3dccd 100%);">
{row('dark', True)}
{row('light', False)}
</div>
'''
    (OUT / f'{name}.dc.html').write_text(HEAD.format(title=title, css=SHARED_CSS) + body + TAIL.format(w=bw, h=bh))
    return bw, bh

boards = {}
def add(name, size, title, interactive=True):
    boards[name] = {'w': size[0], 'h': size[1], 'title': title, 'is_interactive': interactive}

def tp(comp):
    return ((comp, 'theme="dark"'), (comp, 'theme="light"'))

SCREENS = [
    ('PairAnimeLanding', 'Anime landing', *tp('AnimeLanding'), 'Crystal Star · Landing — meteor-night key visual, fanned star cards'),
    ('PairAnimeToday', 'Anime home', *tp('AnimeToday'), 'Crystal Star · Today home — one lesson, route, quests'),
    ('PairAnimeReview', 'Anime review', *tp('AnimeReview'), 'Crystal Star · Review — wings unfold on hover, Bud/Bloom/Star tiers, flare spotlight, transform flip, sealed hint, combo banner'),
    ('PairAnimeRecap', 'Anime result', *tp('AnimeRecap'), 'Crystal Star · Lesson clear — star rating, crystals leveled up, what next'),
    ('PairAnimeAchievements', 'Anime collection', *tp('AnimeAchievements'), 'Crystal Star · Star collection — student card, badges by tier'),
    ('PairAnimeLeague', 'Anime league', *tp('AnimeLeague'), 'Crystal Star · League — podium, promotion zone, study buddy'),
    ('PairAnimePricing', 'Anime pricing', *tp('AnimePricing'), 'Crystal Star · Pricing — academy membership, transparent'),
    ('PairReview', 'Review', ('Aurora', ''), ('Atelier', ''), 'Review session — dark · light (hover, flip, grade, star, blind, listen)'),
    ('PairRecap', 'Session recap', *tp('RecapScreen'), 'Session complete — level-ups, stats, next review'),
    ('PairQuiz', 'Quiz', *tp('QuizScreen'), 'Practice · Quiz — multiple choice, answered state'),
    ('PairSpelling', 'Spelling', *tp('SpellingScreen'), 'Practice · Spelling — listen and type, letter feedback'),
    ('PairMatch', 'Word match', *tp('MatchScreen'), 'Practice · Word Match — 60-second pairs'),
    ('PairShadowing', 'Shadowing', *tp('ShadowingScreen'), 'Practice · Shadowing — record and compare'),
    ('PairStory', 'Story', *tp('StoryScreen'), 'Practice · Story — AI reading with glosses'),
    ('PairLesson', 'Lesson', *tp('LessonScreen'), 'Today lesson — active recall / cloze exercise'),
    ('PairPlacement', 'Placement', *tp('PlacementScreen'), 'Placement check — find a starting level'),
    ('PairToday', 'Today', *tp('TodayScreen'), 'Today — home (hover the card stack)'),
    ('PairVocabulary', 'Vocabulary', *tp('LibraryScreen'), 'Vocabulary — decks, filters, mini cards'),
    ('PairPaths', 'Paths', *tp('PathsScreen'), 'Paths — current path and shelf'),
    ('PairProgress', 'Progress', *tp('ProgressScreen'), 'Progress — activity, mastery, forecast'),
    ('PairAchievements', 'Achievements', *tp('AchievementsScreen'), 'Achievements — level, XP, badges'),
    ('PairFeedback', 'Feedback and menus', *tp('FeedbackSheet'), 'Toasts, sync status, account and library menus'),
    ('PairSystem', 'System states', *tp('SystemStates'), 'Error, offline, empty and loading states'),
    ('PairLanding', 'Landing', *tp('LandingScreen'), 'Landing — live card in the hero (hover, click to flip)'),
    ('PairLandingSales', 'Landing sales', *tp('LandingSales'), 'Landing — live demo, social proof, Free vs Pro, FAQ'),
    ('PairTodaySession', 'Today session', *tp('TodaySession'), 'Today — one session CTA, plan timeline, words from the web'),
    ('PairSessionBridge', 'Session bridge', *tp('SessionBridge'), 'Session — interstitial between parts, combo'),
    ('PairRecapNext', 'Recap next', *tp('RecapNext'), 'Recap — meaningful progress and what next'),
    ('PairWebWords', 'Web words', *tp('WebWords'), 'Words you met on the web — extension inbox'),
    ('PairPricing', 'Pricing', *tp('PricingScreen'), 'Pricing — Free, Pro, Exam Sprint'),
    ('PairProStates', 'Pro states', *tp('ProStates'), 'Trial, quota, downgrade and Pro moments'),
    ('PairReminders', 'Reminders', *tp('ReminderSettings'), 'Settings — reminders, sounds and haptics'),
    ('PairWeeklyRecap', 'Weekly recap', *tp('WeeklyRecap'), 'Weekly recap — shareable card'),
    ('PairReferral', 'Referral', *tp('ReferralScreen'), 'Referral — give 7 days, get 7 days'),
    ('PairLeague', 'League', *tp('LeagueScreen'), 'Weekly league and study buddy'),
    ('PairMotion', 'Motion storyboard', *tp('MotionStoryboard'), 'Motion — shared-element transitions spec'),
    ('PairEditSheet', 'Edit side sheet', *tp('EditSheet'), 'Edit card in a side sheet without leaving review'),
]
for n, title, l, r, cap in SCREENS:
    add(n, pair(n, title, l, r, 1440, 900), cap)

D = lambda c, cap: (c, '', 720, 780, cap)
add('Dialogs1', grid('Dialogs1', 'Dialogs — study', [D('DlgPractice', 'Practice mode'), D('DlgTutor', 'AI tutor'), D('DlgCreate', 'Add a word with AI'), D('DlgEdit', 'Edit card')]), 'Dialogs — practice menu, AI tutor, add word, edit card')
add('Dialogs2', grid('Dialogs2', 'Dialogs — library', [D('DlgExtract', 'Scan text'), D('DlgShare', 'Share deck'), D('DlgShareIn', 'Shared deck received'), D('DlgInsights', 'Learning insights')]), 'Dialogs — scan text, share, incoming share, insights')
add('Dialogs3', grid('Dialogs3', 'Dialogs — manage', [D('DlgDeckNew', 'New deck'), D('DlgDeckDelete', 'Delete deck'), D('DlgClear', 'Clear library'), D('DlgImport', 'Import')]), 'Dialogs — deck create/delete, clear library, import')

add('GridOnboarding', grid('GridOnboarding', 'Onboarding', [('Onboarding', f'step="{k}"', 1440, 900, c) for k, c in [('goal', '1 Goal'), ('exam', '2 Exam'), ('pace', '3 Pace'), ('aha', '4 First cards'), ('reminder', '5 Reminder + trial')]]), 'Onboarding — goal, exam, pace, first cards, reminder + trial')
add('DialogsPaywall', grid('DialogsPaywall', 'Paywall moments', [('DlgPaywall', f'moment="{k}"', 720, 780, c) for k, c in [('recap', 'After recap'), ('ai', 'AI quota used'), ('streak', 'Streak at risk'), ('band', 'Band projection')]]), 'Paywall — contextual moments')
add('DialogsCheckout', grid('DialogsCheckout', 'Checkout', [('DlgCheckout', 'step="pay"', 720, 780, 'Pay'), ('DlgCheckout', 'step="success"', 720, 780, 'Welcome to Pro'), ('AiStreaming', '', 720, 780, 'AI card streaming')]), 'Checkout and AI streaming')
add('DialogsStreak', grid('DialogsStreak', 'Streak', [('DlgStreak', f'state="{k}"', 720, 780, c) for k, c in [('freeze', 'Freeze used'), ('repair', 'Repair'), ('milestone', '30-day milestone')]]), 'Streak — freeze, repair, milestone')
add('GridAnimeOnboarding', grid('GridAnimeOnboarding', 'Anime onboarding', [('AnimeOnboarding', f'step="{k}"', 1440, 900, c) for k, c in [('goal', 'Enrollment · pick a path'), ('aha', 'Enrollment · first cards + trial')]]), 'Crystal Star · Onboarding — enrollment chapter')
add('GridAnimeReveal', grid('GridAnimeReveal', 'Anime reveal', [('AnimeReveal', f'state="{k}"', 720, 780, c) for k, c in [('tierup', 'Glow up to Star'), ('streak', '30-day streak'), ('levelup', 'Level up')]]), 'Crystal Star · Ceremonies — tier up, streak, level up')
add('Mobile', gallery('Mobile', 'Mobile', [
    ('MobileReview', 'theme="dark"', 390, 844, 'Review · dark', True),
    ('MobileToday', 'theme="dark"', 390, 844, 'Today · dark', True),
    ('MobileQuiz', 'theme="dark"', 390, 844, 'Quiz · dark', True),
    ('MobileSheet', 'theme="dark"', 390, 844, 'Practice sheet · dark', True),
    ('MobileOnboard', 'theme="dark"', 390, 844, 'Onboarding · dark', True),
    ('MobilePaywall', 'theme="dark"', 390, 844, 'Pro · dark', True),
    ('MobileReview', 'theme="light"', 390, 844, 'Review · light', False),
    ('MobileToday', 'theme="light"', 390, 844, 'Today · light', False),
    ('MobileQuiz', 'theme="light"', 390, 844, 'Quiz · light', False),
    ('MobileSheet', 'theme="light"', 390, 844, 'Practice sheet · light', False),
    ('MobileOnboard', 'theme="light"', 390, 844, 'Onboarding · light', False),
    ('MobilePaywall', 'theme="light"', 390, 844, 'Pro · light', False),
], gap=70), 'Mobile — review, Today, quiz, practice sheet')
add('ExtPopups', grid('ExtPopups', 'Extension popup', [
    ('ExtPopup', '', 380, 640, 'Saved'),
    ('ExtPopupState', 'state="idle"', 380, 640, 'Idle'),
    ('ExtPopupState', 'state="quick"', 380, 640, 'Quick translate'),
    ('ExtPopupState', 'state="error"', 380, 640, 'Error'),
    ('ExtLoop', 'state="loop"', 380, 640, 'Back to app'),
    ('ExtLoop', 'state="quota"', 380, 640, 'AI quota'),
    ('ExtContextMenu', '', 380, 640, 'Context menu'),
]), 'Chrome extension — popup states and context menu')
add('PairExtInPage', pair('PairExtInPage', 'Extension in page', *tp('ExtInPage'), 1200, 760), 'Chrome extension — selection bubble on any page')
add('PairExtOptions', pair('PairExtOptions', 'Extension options', *tp('ExtOptions'), 960, 900), 'Chrome extension — options page')

# Anime boards appear only once their source component exists.
ANIME_SRC = {'PairAnimeLanding': 'AnimeLanding', 'PairAnimeToday': 'AnimeToday', 'PairAnimeReview': 'AnimeReview', 'PairAnimeRecap': 'AnimeRecap',
             'PairAnimeAchievements': 'AnimeAchievements', 'PairAnimeLeague': 'AnimeLeague', 'PairAnimePricing': 'AnimePricing',
             'GridAnimeOnboarding': 'AnimeOnboarding', 'GridAnimeReveal': 'AnimeReveal'}
# Each anime batch registers its boards in its own src/boards-anime-*.py fragment:
# it calls add()/grid()/pair()/gallery()/tp(), fills ANIME_SRC and appends (gid, title, [board names]) to ANIME_GROUPS.
ANIME_GROUPS = []
for frag in sorted(SRC.glob('boards-anime-*.py')):
    exec(frag.read_text(), globals())
# Multilingual (any native language -> any target language) boards: src/boards-lang-*.py fragments, same contract,
# appending to LANG_GROUPS; the guard map ANIME_SRC is shared (board name -> source component).
LANG_GROUPS = []
for frag in sorted(SRC.glob('boards-lang-*.py')):
    exec(frag.read_text(), globals())
# Supplemental auth and file workflows are designed here before their API migration.
PHASE14_GROUPS = []
for frag in sorted(SRC.glob('boards-phase14-*.py')):
    exec(frag.read_text(), globals())
import os
READY = os.environ.get('ANIME_READY')
for bname, comp in ANIME_SRC.items():
    if not (SRC / f'{comp}.dc.html').exists() or (READY and comp not in READY.split(',')):
        boards.pop(bname, None)
        (OUT / f'{bname}.dc.html').unlink(missing_ok=True)

canvas = json.loads((OUT / 'canvas.json').read_text())
old = canvas['boards']
for gone in ('Review.dc.html', 'TodayDark.dc.html', 'TodayLight.dc.html', 'LibraryDark.dc.html', 'LibraryLight.dc.html'):
    old.pop(gone, None)

layout = {}
notes = {}
y = 0
groups = [
    *LANG_GROUPS,
    ('anime', 'Anime edition — Crystal Star · dark: Starry Night · light: Prism Day', ['PairAnimeLanding', 'GridAnimeOnboarding', 'PairAnimeToday', 'PairAnimeReview', 'PairAnimeRecap', 'GridAnimeReveal', 'PairAnimeAchievements', 'PairAnimeLeague', 'PairAnimePricing']),
    *ANIME_GROUPS,
    ('onboard', 'Onboarding and the daily session loop', ['GridOnboarding', 'PairTodaySession', 'PairSessionBridge', 'PairRecapNext', 'PairWebWords']),
    ('money', 'Pricing and Pro', ['PairPricing', 'DialogsPaywall', 'DialogsCheckout', 'PairProStates']),
    ('growth', 'Retention and growth', ['DialogsStreak', 'PairReminders', 'PairWeeklyRecap', 'PairReferral', 'PairLeague']),
    ('motion', 'Motion and flow', ['PairMotion', 'PairEditSheet']),
    ('study', 'Study flow', ['PairReview', 'PairRecap']),
    ('practice', 'Practice modes and lessons', ['PairQuiz', 'PairSpelling', 'PairMatch', 'PairShadowing', 'PairStory', 'PairLesson', 'PairPlacement']),
    ('home', 'Home, library and progress', ['PairToday', 'PairVocabulary', 'PairPaths', 'PairProgress', 'PairAchievements']),
    ('dialogs', 'Dialogs (top: dark · bottom: light)', ['Dialogs1', 'Dialogs2', 'Dialogs3']),
    ('states', 'Feedback, menus and system states', ['PairFeedback', 'PairSystem']),
    *PHASE14_GROUPS,
    ('web', 'Landing', ['PairLanding', 'PairLandingSales']),
    ('mobile', 'Mobile', ['Mobile']),
    ('ext', 'Chrome extension', ['ExtPopups', 'PairExtInPage', 'PairExtOptions']),
]
LEFT_W = max(b['w'] for b in boards.values())
for gid, gtitle, names in groups:
    names = [n for n in names if n in boards]
    notes[gid] = {'kind': 'title1', 'x': 0, 'y': y - 260, 'maxW': LEFT_W, 'text': gtitle}
    for n in names:
        layout[n] = (0, y)
        y += boards[n]['h'] + 120
    y += 300

new_boards = {}
for n, b in boards.items():
    x, by = layout[n]
    new_boards[f'{n}.dc.html'] = {'x': x, 'y': by, **b}

# Source components packed into rows to the right of the pair boards.
PREVIEW = {}
for f in sorted(SRC.glob('*.dc.html')) + [OUT / 'Aurora.dc.html', OUT / 'Atelier.dc.html', OUT / 'TodayScreen.dc.html', OUT / 'LibraryScreen.dc.html']:
    m = re.search(r'"\$preview":\{"width":(\d+),"height":(\d+)\}', f.read_text())
    PREVIEW[f.name[:-len('.dc.html')]] = (int(m.group(1)), int(m.group(2))) if m else (1440, 900)
src_names = sorted(PREVIEW, key=lambda n: (-PREVIEW[n][1] * PREVIEW[n][0], n))
sx = LEFT_W + 400
notes['sources'] = {'kind': 'title1', 'x': sx, 'y': -260, 'maxW': 3000, 'text': 'Components (single theme, used on the left)'}
cx, cy, row_h = sx, 0, 0
for n in src_names:
    w, h = PREVIEW[n]
    if cx + w > sx + 3000 and cx > sx:
        cx, cy, row_h = sx, cy + row_h + 120, 0
    prev = old.get(f'{n}.dc.html', {})
    new_boards[f'{n}.dc.html'] = {**prev, 'x': cx, 'y': cy, 'w': w, 'h': h, 'title': prev.get('title', f'Component — {n}'), 'is_interactive': True}
    cx += w + 80
    row_h = max(row_h, h)

# Archive of the superseded v2 boards below everything.
arch_y = y + 200
notes['old'] = {'kind': 'title1', 'x': 0, 'y': arch_y - 260, 'maxW': 2960, 'text': 'Archive — v2 (superseded)'}
arch = {'Main.dc.html': (0, 0), 'CardStatesDark.dc.html': (1520, 0), 'CardStatesLight.dc.html': (3740, 0), 'FlashFront.dc.html': (0, 1020), 'FlashBack.dc.html': (540, 1020)}
for n, (ax, ay) in arch.items():
    if n in old:
        new_boards[n] = {**old[n], 'x': ax, 'y': arch_y + ay}

notes['directions'] = {'kind': 'title1', 'x': 0, 'y': -560, 'maxW': 6400, 'text': 'SonFlash — left: dark · Midnight Aurora   right: light · Ink & Paper'}
canvas['boards'] = new_boards
canvas['notes'] = notes
canvas['order'] = [f'{n}.dc.html' for n in boards] + [f'{n}.dc.html' for n in src_names] + [n for n in arch if n in old]
(OUT / 'canvas.json').write_text(json.dumps(canvas, indent=2, ensure_ascii=False))
print(len(new_boards), 'boards; left column height', y)
