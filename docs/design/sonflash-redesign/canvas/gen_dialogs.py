"""Writes the dialog templates (src/Dlg*.dc.html). Shared header/footer/button markup lives here so the dialogs stay consistent."""
from pathlib import Path

SRC = Path(__file__).parent / 'src'

X = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"></path></svg>'
CHECK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"></path></svg>'
CHEV = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"></path></svg>'
SPARK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.2 6.3 6.3 2.2-6.3 2.2L12 19.5l-2.2-6.3L3.5 11l6.3-2.2z"></path></svg>'
WARN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path><path d="M12 9v4M12 17h.01"></path></svg>'
TRASH = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"></path></svg>'
DOWNLOAD = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"></path></svg>'
PLAY = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"></path></svg>'

LABEL = 'font-size: 12px; font-weight: 600; color: {{t.text2}};'
FIELD = 'box-sizing: border-box; height: 42px; padding: 0 14px; border-radius: {{t.fr}}px; border: 1px solid {{t.line}}; background: {{t.inputBg}}; color: {{t.textStrong}}; font-size: 14px; display: flex; align-items: center; gap: 8px;'
BTN2 = 'height: 44px; padding: 0 18px; border-radius: {{t.btnRadius}}; border: 1px solid {{t.line}}; background: {{t.secondaryBg}}; color: {{t.text}}; box-shadow: {{t.secondaryShadow}}; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; cursor: pointer;'
BTN1 = 'height: 44px; padding: 0 20px; border-radius: {{t.btnRadius}}; border: 0; background: {{t.primaryBg}}; color: {{t.primaryText}}; box-shadow: {{t.primaryShadow}}; font-size: 14px; font-weight: 650; display: flex; align-items: center; gap: 8px; cursor: pointer;'
BTND = 'height: 44px; padding: 0 20px; border-radius: {{t.btnRadius}}; border: 0; background: {{t.dangerSolid}}; color: {{t.dangerSolidText}}; box-shadow: 0 14px 30px -16px {{t.dangerSolid}}; font-size: 14px; font-weight: 650; display: flex; align-items: center; gap: 8px; cursor: pointer;'
MONO = "font-family: 'Geist Mono', ui-monospace, monospace;"
SERIF = 'font-family: Fraunces, Georgia, serif; font-optical-sizing: auto;'
EM = 'font-style: {{t.emStyle}}; color: {{t.emColor}}; text-shadow: {{t.emGlow}};'


def header(title, sub='', eyebrow='', lead=''):
    eb = f'<div style="font-size: 11.5px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: {{{{t.text3}}}};">{eyebrow}</div>\n      ' if eyebrow else ''
    sb = f'\n      <p style="margin: 6px 0 0; font-size: 13.5px; line-height: 1.5; color: {{{{t.text2}}}};">{sub}</p>' if sub else ''
    return f'''    <header style="flex-shrink: 0; padding: 22px 22px 18px 26px; display: flex; align-items: flex-start; gap: 14px; border-bottom: 1px solid {{{{t.line}}}};">
      {lead}<div style="flex-grow: 1; min-width: 0;">
      {eb}<h2 id="dlg-title" style="margin: {'6px' if eyebrow else '0'} 0 0; {SERIF} font-weight: {{{{t.displayWeight}}}}; font-size: 28px; line-height: 1.12; letter-spacing: -0.02em; color: {{{{t.textStrong}}}};">{title}</h2>{sb}
      </div>
      <button aria-label="Close" style="width: 36px; height: 36px; flex-shrink: 0; border-radius: 50%; border: 1px solid {{{{t.line}}}}; background: {{{{t.chipBg}}}}; color: {{{{t.text2}}}}; display: flex; align-items: center; justify-content: center; cursor: pointer;">{X}</button>
    </header>
'''


def footer(inner):
    return f'''    <footer style="flex-shrink: 0; padding: 16px 22px 20px 26px; border-top: 1px solid {{{{t.line}}}}; display: flex; align-items: center; gap: 10px;">
{inner}
    </footer>
'''


def body(inner, pad='20px 26px 22px', gap=16):
    return f'''    <div style="flex-grow: 1; min-height: 0; padding: {pad}; display: flex; flex-direction: column; gap: {gap}px;">
{inner}
    </div>
'''


def page(title, content, js_extra, js_return, dw, amb='{ ax: -180, ay: -220, bx: 380, by: 460 }'):
    return f'''<!--#HEAD {title}-->
<!--#DLGOPEN-->
{content}<!--#DLGCLOSE-->
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{{"theme":{{"editor":"enum","options":["dark","light"],"default":"dark"}},"$preview":{{"width":720,"height":780}}}}'>
class Component extends DCLogic {{
  renderVals() {{
//#TOKENS
    const dark = (this.props.theme ?? 'dark') === 'dark';
    const t = {{ ...sfTokens(dark), fr: dark ? 14 : 10 }};
{js_extra}    return {{
      t, dw: {dw}, grainId: '{title.lower().replace(' ', '-')}-grain-' + (dark ? 'd' : 'l'), amb: {amb},
{js_return}    }};
  }}
}}
</script>
</body>
</html>
'''


def write(name, s):
    (SRC / f'{name}.dc.html').write_text(s)


def headword(pre, stress, rest, size=30):
    return f'<span style="{SERIF} font-weight: {{{{t.displayWeight}}}}; font-size: {size}px; line-height: 1; letter-spacing: -0.02em; color: {{{{t.textStrong}}}};">{pre}<span style="{EM}">{stress}</span>{rest}</span>'


# ---------------------------------------------------------------- Practice mode menu
content = header('Choose a practice mode', 'Warm up differently — every answer still feeds the same memory schedule.', 'Practice · Unassigned · 3 cards') + body(f'''      <sc-for list="{{{{modes}}}}" as="m" hint-placeholder-count="5">
        <button aria-disabled="{{{{m.locked}}}}" style="width: 100%; box-sizing: border-box; min-height: 70px; padding: 12px 16px 12px 12px; border-radius: {{{{t.fr}}}}px; border: {{{{m.border}}}}; background: {{{{m.bg}}}}; box-shadow: {{{{m.shadow}}}}; opacity: {{{{m.opacity}}}}; display: flex; align-items: center; gap: 14px; text-align: left; color: {{{{t.text}}}}; cursor: {{{{m.cursor}}}};">
          <span aria-hidden="true" style="width: 44px; height: 44px; flex-shrink: 0; border-radius: 12px; background: {{{{m.iconBg}}}}; color: {{{{m.iconColor}}}}; display: flex; align-items: center; justify-content: center;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="{{{{m.icon}}}}"></path></svg></span>
          <span style="flex-grow: 1; min-width: 0;">
            <span style="display: flex; align-items: baseline; gap: 8px;"><span style="font-size: 15px; font-weight: 650; color: {{{{t.textStrong}}}};">{{{{m.name}}}}</span><span style="{MONO} font-size: 11.5px; color: {{{{t.text3}}}};">{{{{m.time}}}}</span></span>
            <span style="display: block; margin-top: 3px; font-size: 13px; line-height: 1.4; color: {{{{t.text2}}}};">{{{{m.desc}}}}</span>
          </span>
          <sc-if value="{{{{m.isLoading}}}}" hint-placeholder-val="{{{{false}}}}">
            <span role="status" style="flex-shrink: 0; display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; color: {{{{t.accentText}}}};"><span class="sf-spin" style="width: 16px; height: 16px; box-sizing: border-box; border-radius: 50%; border: 2px solid {{{{t.accentLine}}}}; border-top-color: {{{{t.accent}}}};"></span>Preparing…</span>
          </sc-if>
          <sc-if value="{{{{m.locked}}}}" hint-placeholder-val="{{{{false}}}}">
            <span style="flex-shrink: 0; height: 26px; padding: 0 10px; border-radius: 999px; border: 1px solid {{{{t.line}}}}; background: {{{{t.chipBg}}}}; color: {{{{t.text2}}}}; font-size: 11.5px; font-weight: 600; display: flex; align-items: center; gap: 6px;"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg>{{{{m.lockText}}}}</span>
          </sc-if>
          <sc-if value="{{{{m.ready}}}}" hint-placeholder-val="{{{{true}}}}">
            <span style="flex-shrink: 0; {MONO} width: 26px; height: 26px; border-radius: 7px; border: 1px solid {{{{t.line}}}}; color: {{{{t.text3}}}}; font-size: 12px; display: flex; align-items: center; justify-content: center;">{{{{m.key}}}}</span>
          </sc-if>
        </button>
      </sc-for>''', gap=8) + footer(f'''      <span style="font-size: 12.5px; color: {{{{t.text3}}}};">Press <span style="{MONO} padding: 1px 6px; border-radius: 5px; border: 1px solid {{{{t.line}}}};">1</span>–<span style="{MONO} padding: 1px 6px; border-radius: 5px; border: 1px solid {{{{t.line}}}};">5</span> to pick · add cards to unlock more</span>
      <button style="margin-left: auto; {BTN2}">Cancel</button>''')
js = '''    const I = {
      quiz: 'M4 5h16v14H4zM8 9h8M8 13h5',
      spell: 'M4 17 9 5l5 12M6 13h6M15 17h5M15 12h5',
      match: 'M4 7h6M4 17h6M14 7h6M14 17h6M10 7l4 10M10 17l4-10',
      shadow: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
      story: 'M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2zM8 7h6M8 11h6',
    };
    const rows = [
      { name: 'Quiz', desc: 'Pick the right meaning out of four.', time: '~3 min', icon: I.quiz, state: 'loading', key: '1' },
      { name: 'Spelling', desc: 'Hear the word, type it letter by letter.', time: '~4 min', icon: I.spell, state: 'ready', key: '2' },
      { name: 'Word Match', desc: 'Pair words and meanings against a 60-second clock.', time: '60 s', icon: I.match, state: 'locked', lockText: 'Needs 4 cards · you have 3', key: '3' },
      { name: 'Shadowing', desc: 'Say the example sentence, then compare word by word.', time: '~5 min', icon: I.shadow, state: 'ready', key: '4' },
      { name: 'Story', desc: 'A short AI story woven from the words you are learning.', time: '~6 min', icon: I.story, state: 'locked', lockText: 'Needs 5 cards · you have 3', key: '5' },
    ];
    const modes = rows.map(r => {
      const loading = r.state === 'loading', locked = r.state === 'locked';
      return { ...r, isLoading: loading, locked, ready: r.state === 'ready', lockText: r.lockText || '',
        border: loading ? '1px solid ' + t.accentLine : '1px solid ' + t.line,
        bg: loading ? t.accentSoft : (dark ? 'rgb(255 255 255 / 0.025)' : t.chipBg),
        shadow: loading && dark ? '0 0 30px -12px rgb(40 211 244 / 0.6)' : 'none',
        opacity: locked ? 0.55 : 1, cursor: locked ? 'not-allowed' : 'pointer',
        iconBg: locked ? t.chipBg : t.accentSoft, iconColor: locked ? t.text3 : t.accentText };
    });
'''
write('DlgPractice', page('Practice modes', content, js, '      modes,\n', 560))

# ---------------------------------------------------------------- AI tutor
lead = f'<span aria-hidden="true" style="width: 48px; height: 48px; flex-shrink: 0; border-radius: 14px; background: {{{{t.logoBg}}}}; box-shadow: {{{{t.logoShadow}}}}; color: {{{{t.logoText}}}}; display: flex; align-items: center; justify-content: center;">{SPARK}</span>\n      '
content = header(f'Ask about {headword("im", "me", "diate", 28)}', '<span style="font-family: \'Geist Mono\', ui-monospace, monospace;">/ɪˈmiːdiət/</span> · adjective · ngay lập tức', 'AI tutor', lead) + body(f'''      <div role="group" aria-label="Suggested questions" style="display: flex; flex-wrap: wrap; gap: 8px;">
        <sc-for list="{{{{presets}}}}" as="p" hint-placeholder-count="3">
          <button aria-pressed="{{{{p.on}}}}" style="height: 34px; padding: 0 14px; border-radius: 999px; border: 1px solid {{{{p.border}}}}; background: {{{{p.bg}}}}; color: {{{{p.color}}}}; font-size: 13px; font-weight: 600; cursor: pointer;">{{{{p.label}}}}</button>
        </sc-for>
      </div>
      <div style="position: relative; padding: 18px 20px; border-radius: {{{{t.fr}}}}px; border: 1px solid {{{{t.line}}}}; background: {{{{t.chipBg}}}};">
        <div style="display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; color: {{{{t.accentText}}}};">{SPARK}Three ways you'd hear it at work</div>
        <ol style="margin: 12px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 12px;">
          <sc-for list="{{{{examples}}}}" as="e" hint-placeholder-count="3">
            <li style="display: flex; gap: 12px;">
              <span style="{MONO} width: 22px; height: 22px; flex-shrink: 0; border-radius: 50%; border: 1px solid {{{{t.accentLine}}}}; color: {{{{t.accentText}}}}; font-size: 11px; display: flex; align-items: center; justify-content: center;">{{{{e.n}}}}</span>
              <span>
                <span style="display: block; font-size: 14.5px; line-height: 1.5; color: {{{{t.textStrong}}}};">{{{{e.a}}}}<span style="font-weight: 650; {EM}">{{{{e.w}}}}</span>{{{{e.b}}}}</span>
                <span style="display: block; margin-top: 2px; font-size: 13px; line-height: 1.45; color: {{{{t.text2}}}};">{{{{e.vi}}}}</span>
              </span>
            </li>
          </sc-for>
        </ol>
        <div style="margin-top: 14px; padding-top: 12px; border-top: 1px dashed {{{{t.lineStrong}}}}; font-size: 13px; line-height: 1.5; color: {{{{t.body}}}};"><span style="font-weight: 650; color: {{{{t.textStrong}}}};">Collocations:</span> immediate <span style="{MONO} font-size: 12px; color: {{{{t.text3}}}};">+</span> action · effect · family · future. Stronger than <span style="font-style: italic;">quick</span>, less formal than <span style="font-style: italic;">instantaneous</span>.</div>
      </div>
      <form style="margin-top: auto; {FIELD} height: 50px; padding: 0 6px 0 16px; border-color: {{{{t.accentLine}}}}; box-shadow: 0 0 0 4px {{{{t.accentSoft}}}};">
        <input aria-label="Ask a question about this word" placeholder="Ask anything — “Is it formal?”, “immediate vs. instant”" style="flex-grow: 1; min-width: 0; border: 0; outline: none; background: transparent; color: {{{{t.textStrong}}}}; font-size: 14px; font-family: inherit;">
        <button aria-label="Send" style="width: 38px; height: 38px; border-radius: 10px; border: 0; background: {{{{t.primaryBg}}}}; color: {{{{t.primaryText}}}}; display: flex; align-items: center; justify-content: center; cursor: pointer;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"></path></svg></button>
      </form>''') + footer(f'''      <span style="font-size: 12.5px; color: {{{{t.text3}}}};">AI-generated · each question uses 1 AI request</span>
      <button style="margin-left: auto; {BTN2}">Save to Memory hook</button>''')
js = '''    const presets = [['3 work examples', true], ['Synonym nuances', false], ['Native idioms & collocations', false]].map(([label, on]) => ({
      label, on: String(on), border: on ? t.accentLine : t.line, bg: on ? t.accentSoft : 'transparent', color: on ? t.accentText : t.text }));
    const examples = [
      { n: 1, a: 'We need an ', w: 'immediate', b: ' fix before the release goes out.', vi: 'Chúng ta cần sửa ngay trước khi phát hành.' },
      { n: 2, a: 'The new policy takes effect with ', w: 'immediate', b: ' effect.', vi: 'Chính sách mới có hiệu lực ngay lập tức.' },
      { n: 3, a: 'Please flag anything that needs ', w: 'immediate', b: ' attention.', vi: 'Hãy đánh dấu mọi thứ cần xử lý ngay.' },
    ];
'''
write('DlgTutor', page('AI tutor', content, js, '      presets, examples,\n', 600))

# ---------------------------------------------------------------- Create card with AI
content = header('Add a word', 'SonFlash drafts the card — you decide what stays.', 'New card') + body(f'''      <div style="display: grid; grid-template-columns: 1fr 1.35fr; gap: 12px;">
        <label style="display: flex; flex-direction: column; gap: 6px;"><span style="{LABEL}">Word or phrase</span><span style="{FIELD} border-color: {{{{t.accentLine}}}}; box-shadow: 0 0 0 4px {{{{t.accentSoft}}}};"><input value="resilient" style="width: 100%; border: 0; outline: none; background: transparent; color: {{{{t.textStrong}}}}; {SERIF} font-size: 18px;"></span></label>
        <label style="display: flex; flex-direction: column; gap: 6px;"><span style="{LABEL}">Context sentence <span style="font-weight: 400; color: {{{{t.text3}}}};">· optional</span></span><span style="{FIELD} color: {{{{t.body}}}}; font-size: 13px;">The team stayed resilient after the launch slipped.</span></label>
      </div>
      <div role="radiogroup" aria-label="Part of speech" style="display: flex; gap: 4px; padding: 4px; border-radius: {{{{t.fr}}}}px; border: 1px solid {{{{t.line}}}}; background: {{{{t.chipBg}}}};">
        <sc-for list="{{{{pos}}}}" as="p" hint-placeholder-count="5">
          <button role="radio" aria-checked="{{{{p.on}}}}" style="flex: 1; height: 32px; border-radius: 9px; border: 0; background: {{{{p.bg}}}}; color: {{{{p.color}}}}; box-shadow: {{{{p.shadow}}}}; font-size: 13px; font-weight: 600; cursor: pointer;">{{{{p.label}}}}</button>
        </sc-for>
      </div>
      <div style="position: relative; display: flex; gap: 16px; padding: 16px; border-radius: {{{{t.fr}}}}px; border: {{{{preview.border}}}}; background: {{{{preview.bg}}}}; box-shadow: {{{{preview.shadow}}}};">
        <div aria-hidden="true" style="width: 128px; flex-shrink: 0; border-radius: 12px; background: {{{{preview.cover}}}}; display: flex; align-items: flex-end; padding: 10px 12px; box-sizing: border-box; overflow: hidden;"><span style="{SERIF} font-style: italic; font-size: 92px; line-height: 0.8; color: {{{{preview.coverText}}}};">r</span></div>
        <div style="flex-grow: 1; min-width: 0;">
          <div style="display: flex; align-items: center; gap: 8px;"><span style="height: 22px; padding: 0 8px; border-radius: 999px; background: {{{{t.accentSoft}}}}; color: {{{{t.accentText}}}}; font-size: 11px; font-weight: 650; display: flex; align-items: center; gap: 5px;">{SPARK}AI draft</span><span style="margin-left: auto; font-size: 12px; color: {{{{t.text3}}}};">Click any field to edit</span></div>
          <div style="margin-top: 10px; display: flex; align-items: center; gap: 10px;">{headword("re", "sil", "ient", 34)}<button aria-label="Play pronunciation" style="width: 30px; height: 30px; border-radius: 50%; border: 1px solid {{{{t.accentLine}}}}; background: {{{{t.accentSoft}}}}; color: {{{{t.accentText}}}}; display: flex; align-items: center; justify-content: center;">{PLAY}</button></div>
          <div style="margin-top: 6px; font-size: 12.5px; color: {{{{t.text2}}}};"><span style="{MONO}">/rɪˈzɪliənt/</span> · adjective · C1</div>
          <div style="margin-top: 10px; {SERIF} font-size: 22px; color: {{{{t.accentText}}}};">kiên cường, mau phục hồi</div>
          <p style="margin: 6px 0 0; font-size: 13px; line-height: 1.5; color: {{{{t.body}}}}; font-style: italic;">“Children are often more <span style="font-weight: 650; font-style: normal; color: {{{{t.textStrong}}}};">resilient</span> than we expect.”</p>
          <div style="margin-top: 8px; font-size: 12.5px; color: {{{{t.text2}}}};">Family: resilience · resiliently</div>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 10px;">
        <span style="{LABEL}">Save to</span>
        <button style="height: 36px; padding: 0 12px; border-radius: 10px; border: 1px solid {{{{t.line}}}}; background: {{{{t.secondaryBg}}}}; color: {{{{t.text}}}}; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px;">IELTS {CHEV}</button>
        <span style="margin-left: auto; font-size: 12.5px; color: {{{{t.text3}}}};">First review: tomorrow</span>
      </div>''') + footer(f'''      <span style="font-size: 12.5px; color: {{{{t.text3}}}}; display: flex; align-items: center; gap: 6px;">{SPARK}1 AI request</span>
      <button style="margin-left: auto; {BTN2}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"></path></svg>Regenerate</button>
      <button class="sf-press" style="{BTN1}">Save card</button>''')
js = '''    const pos = ['Auto', 'noun', 'verb', 'adjective', 'adverb'].map(label => {
      const on = label === 'adjective';
      return { label, on: String(on), bg: on ? (dark ? 'rgb(255 255 255 / 0.1)' : t.primaryBg) : 'transparent', color: on ? (dark ? t.textStrong : t.primaryText) : t.text2, shadow: on && dark ? 'inset 0 1px 0 rgb(255 255 255 / 0.08)' : 'none' };
    });
    const preview = dark
      ? { border: '1.5px solid transparent', bg: 'radial-gradient(ellipse 70% 60% at 100% 0%, rgb(150 108 215 / 0.2), transparent 70%) padding-box, ' + t.cardBg + ' padding-box, ' + t.rimLearning + ' border-box', shadow: '0 20px 40px -24px rgb(0 0 0 / 0.9), 0 0 36px -16px rgb(40 211 244 / 0.5)', cover: 'radial-gradient(circle at 30% 20%, rgb(126 230 250 / 0.5), transparent 60%), linear-gradient(160deg, #1b3b4a, #2a2150)', coverText: 'rgb(229 236 241 / 0.9)' }
      : { border: '0', bg: t.cardBg, shadow: 'inset 0 1px 0 #ffffff, inset 0 0 0 1px rgb(29 26 22 / 0.07), 0 14px 26px -18px rgb(60 40 20 / 0.45)', cover: 'linear-gradient(160deg, #e9dcc4, #d8c6a4)', coverText: '#97400d' };
'''
write('DlgCreate', page('Add a word', content, js, '      pos, preview,\n', 620))

# ---------------------------------------------------------------- Card editor
def fld(label, inner, extra=''):
    return f'<label style="display: flex; flex-direction: column; gap: 5px; min-width: 0;{extra}"><span style="{LABEL}">{label}</span>{inner}</label>'

content = header('Edit card', '', 'IELTS · added 12 Sep · reviewed 4 times') + body(f'''      <div style="display: grid; grid-template-columns: 1.4fr 1fr; gap: 12px;">
        {fld('Word', f'<span style="{FIELD} {SERIF} font-size: 18px;">immediate</span>')}
        {fld('Part of speech', f'<span style="{FIELD}">adjective<span style="margin-left: auto; color: {{{{t.text3}}}};">{CHEV}</span></span>')}
        {fld('Meaning (Vietnamese)', f'<span style="{FIELD} border-color: {{{{t.accentLine}}}}; box-shadow: 0 0 0 4px {{{{t.accentSoft}}}};">ngay lập tức<span style="width: 1.5px; height: 18px; margin-left: -6px; background: {{{{t.accent}}}};"></span></span>')}
        {fld('IPA', f'<span style="{FIELD} {MONO} font-size: 13.5px;">/ɪˈmiːdiət/</span>')}
      </div>
      {fld('Example', f'<span style="{FIELD} font-size: 13.5px;">The council demanded an immediate response.</span>')}
      {fld('Example translation', f'<span style="{FIELD} font-size: 13.5px; color: {{{{t.body}}}};">Hội đồng yêu cầu phản hồi ngay lập tức.</span>')}
      {fld('Memory hook', f'<span style="{FIELD} height: 52px; align-items: flex-start; padding-top: 8px; font-size: 13.5px; line-height: 1.45; color: {{{{t.body}}}};">im + media: không có gì ở giữa → xảy ra ngay, không qua trung gian.</span>')}
      <div style="display: grid; grid-template-columns: 1.4fr 1fr; gap: 12px;">
        {fld('Image URL', f'<span style="{FIELD} padding-left: 5px; font-size: 13px; color: {{{{t.text2}}}};"><img src="/_blob/dc9678b28352d8aeb0fea95d3a58a38d" alt="" style="width: 32px; height: 32px; border-radius: 7px; object-fit: cover;"><span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">images.sonflash.app/w/immediate.jpg</span></span>')}
        {fld('Deck', f'<span style="{FIELD}">IELTS<span style="margin-left: auto; color: {{{{t.text3}}}};">{CHEV}</span></span>')}
      </div>
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="{LABEL}">Difficulty</span>
        <div role="radiogroup" aria-label="Difficulty" style="display: flex; gap: 4px; padding: 3px; border-radius: 10px; border: 1px solid {{{{t.line}}}}; background: {{{{t.chipBg}}}};">
          <sc-for list="{{{{diff}}}}" as="d" hint-placeholder-count="3">
            <button role="radio" aria-checked="{{{{d.on}}}}" style="height: 30px; padding: 0 14px; border-radius: 8px; border: 0; background: {{{{d.bg}}}}; color: {{{{d.color}}}}; font-size: 12.5px; font-weight: 600; display: flex; align-items: center; gap: 6px;"><span style="width: 7px; height: 7px; border-radius: 50%; background: {{{{d.dot}}}};"></span>{{{{d.label}}}}</button>
          </sc-for>
        </div>
        <button aria-pressed="true" style="margin-left: auto; height: 34px; padding: 0 12px; border-radius: 10px; border: 1px solid {{{{t.warmLine}}}}; background: {{{{t.warmBg}}}}; color: {{{{t.warm}}}}; font-size: 12.5px; font-weight: 600; display: flex; align-items: center; gap: 6px;"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"></path></svg>Starred</button>
      </div>''', pad='16px 26px 16px', gap=10) + footer(f'''      <button style="height: 44px; padding: 0 4px; border: 0; background: none; color: {{{{t.danger}}}}; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 7px; cursor: pointer;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"></path></svg>Delete card</button>
      <button style="margin-left: auto; {BTN2}">Cancel</button>
      <button class="sf-press" style="{BTN1}">Save changes</button>''')
js = '''    const diff = [['Easy', t.good], ['Medium', t.accent], ['Hard', t.hard]].map(([label, dot]) => {
      const on = label === 'Medium';
      return { label, dot, on: String(on), bg: on ? (dark ? 'rgb(255 255 255 / 0.1)' : '#ffffff') : 'transparent', color: on ? t.textStrong : t.text2 };
    });
'''
write('DlgEdit', page('Edit card', content, js, '      diff,\n', 620))

# ---------------------------------------------------------------- Word extractor
content = header('Scan text', 'Paste a passage — SonFlash pulls out words worth learning.', 'Word extractor') + body(f'''      <div aria-label="Pasted text" style="position: relative; padding: 14px 16px; border-radius: {{{{t.fr}}}}px; border: 1px solid {{{{t.line}}}}; background: {{{{t.inputBg}}}}; font-size: 14px; line-height: 1.75; color: {{{{t.body}}}};">
        When the river <sc-for list="{{{{p1}}}}" as="w" hint-placeholder-count="1"><mark style="background: {{{{w.bg}}}}; color: {{{{w.color}}}}; border-bottom: 1.5px solid {{{{w.line}}}}; padding: 0 2px; border-radius: 3px;">{{{{w.text}}}}</mark></sc-for> at dawn, residents who spent years <sc-for list="{{{{p2}}}}" as="w" hint-placeholder-count="1"><mark style="background: {{{{w.bg}}}}; color: {{{{w.color}}}}; border-bottom: 1.5px solid {{{{w.line}}}}; padding: 0 2px; border-radius: 3px;">{{{{w.text}}}}</mark></sc-for> for new <sc-for list="{{{{p3}}}}" as="w" hint-placeholder-count="1"><mark style="background: {{{{w.bg}}}}; color: {{{{w.color}}}}; border-bottom: 1.5px solid {{{{w.line}}}}; padding: 0 2px; border-radius: 3px;">{{{{w.text}}}}</mark></sc-for> felt <sc-for list="{{{{p4}}}}" as="w" hint-placeholder-count="1"><mark style="background: {{{{w.bg}}}}; color: {{{{w.color}}}}; border-bottom: 1.5px solid {{{{w.line}}}}; padding: 0 2px; border-radius: 3px;">{{{{w.text}}}}</mark></sc-for>. The council’s response was <sc-for list="{{{{p5}}}}" as="w" hint-placeholder-count="1"><mark style="background: {{{{w.bg}}}}; color: {{{{w.color}}}}; border-bottom: 1.5px solid {{{{w.line}}}}; padding: 0 2px; border-radius: 3px;">{{{{w.text}}}}</mark></sc-for>, yet engineers called the <sc-for list="{{{{p6}}}}" as="w" hint-placeholder-count="1"><mark style="background: {{{{w.bg}}}}; color: {{{{w.color}}}}; border-bottom: 1.5px solid {{{{w.line}}}}; padding: 0 2px; border-radius: 3px;">{{{{w.text}}}}</mark></sc-for> a <sc-for list="{{{{p7}}}}" as="w" hint-placeholder-count="1"><mark style="background: {{{{w.bg}}}}; color: {{{{w.color}}}}; border-bottom: 1.5px solid {{{{w.line}}}}; padding: 0 2px; border-radius: 3px;">{{{{w.text}}}}</mark></sc-for> fix and asked for a <sc-for list="{{{{p8}}}}" as="w" hint-placeholder-count="1"><mark style="background: {{{{w.bg}}}}; color: {{{{w.color}}}}; border-bottom: 1.5px solid {{{{w.line}}}}; padding: 0 2px; border-radius: 3px;">{{{{w.text}}}}</mark></sc-for>, <sc-for list="{{{{p9}}}}" as="w" hint-placeholder-count="1"><mark style="background: {{{{w.bg}}}}; color: {{{{w.color}}}}; border-bottom: 1.5px solid {{{{w.line}}}}; padding: 0 2px; border-radius: 3px;">{{{{w.text}}}}</mark></sc-for> plan.
        <span style="position: absolute; right: 12px; bottom: 8px; {MONO} font-size: 11px; color: {{{{t.text3}}}};">48 words</span>
      </div>
      <div style="display: flex; align-items: baseline; gap: 10px;">
        <span style="font-size: 14px; font-weight: 650; color: {{{{t.textStrong}}}};">Found 9 words</span><span style="font-size: 12.5px; color: {{{{t.text3}}}};">2 already in your library</span>
        <button style="margin-left: auto; border: 0; background: none; padding: 0; font-size: 12.5px; font-weight: 600; color: {{{{t.accentText}}}}; cursor: pointer;">Clear selection</button>
      </div>
      <ul style="margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px;">
        <sc-for list="{{{{words}}}}" as="w" hint-placeholder-count="9">
          <li style="height: 42px; box-sizing: border-box; padding: 0 12px 0 10px; border-radius: 11px; border: 1px solid {{{{w.border}}}}; background: {{{{w.bg}}}}; opacity: {{{{w.opacity}}}}; display: flex; align-items: center; gap: 10px;">
            <span role="checkbox" aria-checked="{{{{w.on}}}}" aria-disabled="{{{{w.disabled}}}}" style="width: 18px; height: 18px; flex-shrink: 0; box-sizing: border-box; border-radius: 5px; border: {{{{w.boxBorder}}}}; background: {{{{w.boxBg}}}}; color: {{{{t.primaryText}}}}; display: flex; align-items: center; justify-content: center;">{{{{w.tick}}}}</span>
            <span style="{SERIF} font-size: 16px; color: {{{{t.textStrong}}}};">{{{{w.word}}}}</span>
            <span style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: {{{{t.text2}}}};">{{{{w.vi}}}}</span>
            <span style="margin-left: auto; flex-shrink: 0; {MONO} font-size: 10.5px; color: {{{{w.tagColor}}}};">{{{{w.tag}}}}</span>
          </li>
        </sc-for>
      </ul>''', gap=14) + footer(f'''      <button style="height: 36px; padding: 0 12px; border-radius: 10px; border: 1px solid {{{{t.line}}}}; background: {{{{t.secondaryBg}}}}; color: {{{{t.text}}}}; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px;">Deck: Unassigned {CHEV}</button>
      <button style="margin-left: auto; {BTN2}">Cancel</button>
      <button class="sf-press" style="{BTN1}">Save 7 cards</button>''')
js = '''    const W = [
      ['crested', 'đạt đỉnh (lũ)', 'C1', false], ['lobbying', 'vận động hành lang', 'C1', false], ['barriers', 'rào chắn', 'B1', false],
      ['vindicated', 'được minh oan', 'C2', false], ['immediate', 'ngay lập tức', 'In library', true], ['embankments', 'đê, bờ kè', 'C1', false],
      ['provisional', 'tạm thời', 'C1', false], ['resilient', 'kiên cường', 'In library', true], ['comprehensive', 'toàn diện', 'B2', false],
    ];
    const hl = (w, owned) => [{ text: w, bg: owned ? 'transparent' : t.accentSoft, color: owned ? t.text2 : t.textStrong, line: owned ? t.lineStrong : t.accent }];
    const words = W.map(([word, vi, tag, owned]) => ({
      word, vi, tag, on: String(!owned), disabled: String(owned), tick: owned ? '' : '✓',
      border: owned ? t.line : t.accentLine, bg: owned ? 'transparent' : (dark ? 'rgb(40 211 244 / 0.05)' : t.chipBg), opacity: owned ? 0.55 : 1,
      boxBorder: owned ? '1.5px solid ' + t.lineStrong : '0', boxBg: owned ? 'transparent' : t.primaryBg, tagColor: owned ? t.text3 : t.accentText,
    }));
'''
ret = "      words, p1: hl('crested'), p2: hl('lobbying'), p3: hl('barriers'), p4: hl('vindicated'), p5: hl('immediate', true), p6: hl('embankments'), p7: hl('provisional'), p8: hl('resilient', true), p9: hl('comprehensive'),\n"
write('DlgExtract', page('Scan text', content, js, ret, 620))

# ---------------------------------------------------------------- Share deck (outgoing)
content = header('Share “IELTS core”', 'Anyone with the link can preview this deck and copy it into their own library.', 'Share deck') + body(f'''      <div style="display: flex; align-items: center; gap: 16px; padding: 14px; border-radius: {{{{t.fr}}}}px; border: 1px solid {{{{t.line}}}}; background: {{{{t.chipBg}}}};">
        <div aria-hidden="true" style="position: relative; width: 64px; height: 72px; flex-shrink: 0;">
          <span style="position: absolute; inset: 0; transform: rotate(-8deg) translate(-4px, 2px); border-radius: 10px; background: {{{{cover.back}}}};"></span>
          <span style="position: absolute; inset: 0; transform: rotate(5deg) translate(4px, 1px); border-radius: 10px; background: {{{{cover.mid}}}};"></span>
          <span style="position: absolute; inset: 0; border-radius: 10px; background: {{{{cover.front}}}}; box-shadow: {{{{cover.shadow}}}}; display: flex; align-items: flex-end; padding: 6px 8px; box-sizing: border-box; {SERIF} font-style: italic; font-size: 36px; line-height: 0.8; color: {{{{cover.text}}}};">I</span>
        </div>
        <div style="flex-grow: 1; min-width: 0;">
          <div style="{SERIF} font-size: 20px; color: {{{{t.textStrong}}}};">IELTS core</div>
          <div style="margin-top: 4px; font-size: 13px; color: {{{{t.text2}}}};"><span style="{MONO}">120</span> cards · <span style="{MONO}">38</span> mastered · Band 6.5–7</div>
        </div>
      </div>
      <label style="display: flex; flex-direction: column; gap: 6px;"><span style="{LABEL}">Share link</span>
        <span style="{FIELD} height: 50px; padding: 0 6px 0 14px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="{{{{t.text3}}}}" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"></path></svg><span style="flex-grow: 1; min-width: 0; {MONO} font-size: 13px; color: {{{{t.textStrong}}}}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">sonflash.app/s/ielts-core-7Qm2x</span>
          <button aria-live="polite" style="height: 38px; padding: 0 14px; border-radius: 10px; border: 1px solid {{{{t.okLine}}}}; background: {{{{t.okBg}}}}; color: {{{{t.ok}}}}; font-size: 13px; font-weight: 650; display: flex; align-items: center; gap: 6px;">{CHECK}Copied</button></span>
      </label>
      <ul style="margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px;">
        <sc-for list="{{{{facts}}}}" as="f" hint-placeholder-count="3">
          <li style="display: flex; gap: 10px; font-size: 13.5px; line-height: 1.45; color: {{{{t.body}}}};"><span style="margin-top: 2px; width: 18px; height: 18px; flex-shrink: 0; border-radius: 50%; background: {{{{t.accentSoft}}}}; color: {{{{t.accentText}}}}; display: flex; align-items: center; justify-content: center;">{CHECK}</span>{{{{f}}}}</li>
        </sc-for>
      </ul>
      <div role="alert" style="display: flex; gap: 10px; padding: 12px 14px; border-radius: 12px; border: 1px solid {{{{t.warnLine}}}}; background: {{{{t.warnBg}}}}; color: {{{{t.warn}}}}; font-size: 13px; line-height: 1.45;"><span style="flex-shrink: 0; margin-top: 1px;">{WARN}</span><span>Your memory hooks and personal notes are included in shared cards. Remove anything private before sending the link.</span></div>''') + footer(f'''      <button style="height: 44px; padding: 0 4px; border: 0; background: none; color: {{{{t.danger}}}}; font-size: 14px; font-weight: 600; cursor: pointer;">Revoke link</button>
      <button class="sf-press" style="margin-left: auto; {BTN1}">Done</button>''')
js = '''    const cover = dark
      ? { back: 'rgb(150 108 215 / 0.35)', mid: 'rgb(40 211 244 / 0.3)', front: 'linear-gradient(150deg, #7ee6fa, #28d3f4 45%, #966cd7)', shadow: '0 10px 24px -8px rgb(40 211 244 / 0.6)', text: '#04141c' }
      : { back: '#d8c6a4', mid: '#e7d9bf', front: '#337344', shadow: '0 8px 16px -8px rgb(60 40 20 / 0.6)', text: '#f3d58a' };
    const facts = ['Recipients get their own copy — your progress and review history stay private.', 'Edits you make later are not pushed to copies already taken.', 'The link works until you revoke it.'];
'''
write('DlgShare', page('Share deck', content, js, '      cover, facts,\n', 560))

# ---------------------------------------------------------------- Incoming share
lead = f'<span aria-hidden="true" style="width: 48px; height: 48px; flex-shrink: 0; border-radius: 50%; background: {{{{t.avatarBg}}}}; color: {{{{t.avatarText}}}}; border: 1px solid {{{{t.line}}}}; font-size: 15px; font-weight: 700; display: flex; align-items: center; justify-content: center;">MT</span>\n      '
content = header('Business English essentials', 'Minh Tran shared this deck with you · 2 days ago', 'Shared with you', lead) + body(f'''      <div style="display: grid; grid-template-columns: repeat(3, 1fr); border-radius: {{{{t.fr}}}}px; border: 1px solid {{{{t.line}}}}; background: {{{{t.chipBg}}}};">
        <div style="padding: 12px 16px; border-right: 1px solid {{{{t.line}}}};"><div style="font-size: 12px; color: {{{{t.text2}}}};">Cards</div><div style="margin-top: 2px; {SERIF} font-size: 28px; color: {{{{t.textStrong}}}};">48</div></div>
        <div style="padding: 12px 16px; border-right: 1px solid {{{{t.line}}}};"><div style="font-size: 12px; color: {{{{t.text2}}}};">Category</div><div style="margin-top: 8px; font-size: 14px; font-weight: 600; color: {{{{t.textStrong}}}};">Business & law</div></div>
        <div style="padding: 12px 16px;"><div style="font-size: 12px; color: {{{{t.text2}}}};">Level</div><div style="margin-top: 8px; font-size: 14px; font-weight: 600; color: {{{{t.textStrong}}}};">B2 – C1</div></div>
      </div>
      <div style="display: flex; align-items: baseline; justify-content: space-between;"><span style="{LABEL}">A few words inside</span><span style="font-size: 12.5px; color: {{{{t.text3}}}};">+ 43 more</span></div>
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
        <sc-for list="{{{{samples}}}}" as="s" hint-placeholder-count="5">
          <div style="height: 104px; box-sizing: border-box; padding: 14px; border-radius: {{{{mini.radius}}}}px; border: {{{{mini.border}}}}; background: {{{{mini.bg}}}}; box-shadow: {{{{mini.shadow}}}}; transform: rotate({{{{s.rot}}}}deg); display: flex; flex-direction: column;">
            <span style="{SERIF} font-weight: {{{{t.displayWeight}}}}; font-size: 21px; line-height: 1; letter-spacing: -0.01em; color: {{{{t.textStrong}}}};">{{{{s.pre}}}}<span style="{EM}">{{{{s.stress}}}}</span>{{{{s.rest}}}}</span>
            <span style="margin-top: auto; font-size: 12.5px; color: {{{{t.text2}}}};">{{{{s.vi}}}}</span>
          </div>
        </sc-for>
        <div style="height: 104px; box-sizing: border-box; border-radius: {{{{mini.radius}}}}px; border: 1.5px dashed {{{{t.lineStrong}}}}; color: {{{{t.text3}}}}; display: flex; align-items: center; justify-content: center; {SERIF} font-size: 22px;">+43</div>
      </div>
      <p style="margin: 0; display: flex; gap: 10px; padding: 12px 14px; border-radius: 12px; border: 1px solid {{{{t.infoLine}}}}; background: {{{{t.infoBg}}}}; font-size: 13px; line-height: 1.45; color: {{{{t.body}}}};">Cards go into a new deck with the same name. Your existing cards and progress stay untouched.</p>''') + footer(f'''      <button style="margin-left: auto; {BTN2}">Cancel</button>
      <button class="sf-press" style="{BTN1}">Add 48 cards</button>''')
js = '''    const samples = [
      ['ne', 'go', 'tiate', 'đàm phán', -1.5], ['', 'lev', 'erage', 'đòn bẩy', 1], ['lia', 'bil', 'ity', 'trách nhiệm pháp lý', -0.5],
      ['', 'stake', 'holder', 'bên liên quan', 1.2], ['', 'rev', 'enue', 'doanh thu', -1],
    ].map(([pre, stress, rest, vi, rot]) => ({ pre, stress, rest, vi, rot }));
    const mini = dark
      ? { radius: 16, border: '1px solid transparent', bg: t.cardBg + ' padding-box, ' + t.rimNew + ' border-box', shadow: '0 14px 30px -18px rgb(0 0 0 / 0.9)' }
      : { radius: 12, border: '0', bg: t.cardBg, shadow: 'inset 0 1px 0 #ffffff, inset 0 0 0 1px rgb(29 26 22 / 0.07), 0 10px 18px -14px rgb(60 40 20 / 0.5)' };
'''
write('DlgShareIn', page('Shared deck', content, js, '      samples, mini,\n', 580))

# ---------------------------------------------------------------- New deck
content = header('New deck', 'Group words by exam, trip, book — anything you like.') + body(f'''      <label style="display: flex; flex-direction: column; gap: 6px;"><span style="{LABEL}">Deck name</span>
        <span style="{FIELD} height: 48px; border-color: {{{{t.dangerLine}}}}; box-shadow: 0 0 0 4px {{{{t.dangerBg}}}};"><input aria-invalid="true" aria-describedby="deck-err" value="IELTS" placeholder="IELTS, Travel…" style="width: 100%; border: 0; outline: none; background: transparent; color: {{{{t.textStrong}}}}; {SERIF} font-size: 19px;"></span>
        <span id="deck-err" style="display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: {{{{t.danger}}}};">{WARN}A deck with this name already exists</span>
      </label>
      <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px;"><span style="font-size: 12.5px; color: {{{{t.text3}}}}; margin-right: 2px;">Try</span>
        <sc-for list="{{{{suggest}}}}" as="s" hint-placeholder-count="3"><button style="height: 30px; padding: 0 12px; border-radius: 999px; border: 1px solid {{{{t.line}}}}; background: {{{{t.chipBg}}}}; color: {{{{t.text}}}}; font-size: 13px; cursor: pointer;">{{{{s}}}}</button></sc-for>
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px;"><span style="{LABEL}">Cover</span>
        <div role="radiogroup" aria-label="Deck cover" style="display: flex; gap: 10px;">
          <sc-for list="{{{{covers}}}}" as="c" hint-placeholder-count="5">
            <button role="radio" aria-checked="{{{{c.on}}}}" aria-label="{{{{c.name}}}}" style="width: 72px; height: 90px; padding: 0; border-radius: 12px; border: 0; background: {{{{c.bg}}}}; box-shadow: {{{{c.ring}}}}; display: flex; align-items: flex-end; justify-content: flex-start; overflow: hidden; cursor: pointer;"><span style="padding: 0 0 6px 9px; {SERIF} font-style: italic; font-size: 48px; line-height: 0.8; color: {{{{c.text}}}};">I</span></button>
          </sc-for>
        </div>
      </div>''', gap=18) + footer(f'''      <button style="margin-left: auto; {BTN2}">Cancel</button>
      <button disabled aria-disabled="true" style="{BTN1} opacity: 0.4; box-shadow: none; cursor: not-allowed;">Create deck</button>''')
js = '''    const C = dark
      ? [['Aurora', 'linear-gradient(150deg, #7ee6fa, #28d3f4 45%, #966cd7)', '#04141c'], ['Violet', 'linear-gradient(160deg, #3a2a63, #1d1535)', '#c9b3f0'], ['Amber', 'linear-gradient(160deg, #5a3b0e, #2b1d08)', '#f5ae39'], ['Slate', 'linear-gradient(160deg, #1d3a48, #0f2430)', '#e5ecf1'], ['Moss', 'linear-gradient(160deg, #1f4a2c, #10261a)', '#9be09e']]
      : [['Terracotta', '#b4461a', '#fbf6ec'], ['Moss', '#337344', '#f3d58a'], ['Gold', '#d9b76a', '#1d1a16'], ['Ink', '#1d1a16', '#fbf6ec'], ['Linen', '#e8dfcf', '#97400d']];
    const covers = C.map(([name, bg, text], i) => ({ name, bg, text, on: String(i === 0),
      ring: i === 0 ? '0 0 0 2px ' + (dark ? '#06161f' : '#fffcf5') + ', 0 0 0 4px ' + t.accent : 'inset 0 0 0 1px ' + t.line }));
'''
write('DlgDeckNew', page('New deck', content, js, "      covers, suggest: ['IELTS Writing', 'Travel', 'TOEIC 600'],\n", 520))

# ---------------------------------------------------------------- Delete deck
lead = f'<span aria-hidden="true" style="width: 48px; height: 48px; flex-shrink: 0; border-radius: 14px; background: {{{{t.dangerBg}}}}; border: 1px solid {{{{t.dangerLine}}}}; color: {{{{t.danger}}}}; display: flex; align-items: center; justify-content: center;">{TRASH}</span>\n      '
chip = lambda name, n, sub: f'<div style="flex: 1; padding: 14px 16px; border-radius: {{{{t.fr}}}}px; border: 1px solid {{{{t.line}}}}; background: {{{{t.chipBg}}}};"><div style="font-size: 12px; color: {{{{t.text2}}}};">{name}</div><div style="margin-top: 4px; {SERIF} font-size: 26px; line-height: 1.1; color: {{{{t.textStrong}}}};">{n}</div><div style="margin-top: 2px; font-size: 12px; color: {{{{t.text3}}}};">{sub}</div></div>'
content = header('Delete “TACN”?', '', 'Delete deck', lead) + body(f'''      <p style="margin: 0; font-size: 15px; line-height: 1.55; color: {{{{t.body}}}};">The deck goes away, but its <span style="{MONO} color: {{{{t.textStrong}}}};">170</span> cards stay in your library and move to <span style="font-weight: 650; color: {{{{t.textStrong}}}};">Unassigned</span>. Nothing you have learned is lost.</p>
      <div style="display: flex; align-items: center; gap: 10px;">
        {chip('TACN', '<span style="text-decoration: line-through; text-decoration-color: ' + '{{t.danger}}' + ';">170</span>', 'deck removed')}
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="{{{{t.text3}}}}" stroke-width="2" stroke-linecap="round"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>
        {chip('Unassigned', '1,012', '842 + 170 cards')}
      </div>
      <p style="margin: 0; font-size: 13px; color: {{{{t.text3}}}};">Review schedules and mastery are kept for every card.</p>''') + footer(f'''      <button style="margin-left: auto; {BTN2}">Keep deck</button>
      <button class="sf-press" style="{BTND}">Delete deck</button>''')
write('DlgDeckDelete', page('Delete deck', content, '', '', 500))

# ---------------------------------------------------------------- Clear library
lead = f'<span aria-hidden="true" style="width: 48px; height: 48px; flex-shrink: 0; border-radius: 14px; background: {{{{t.dangerSolid}}}}; color: {{{{t.dangerSolidText}}}}; box-shadow: 0 10px 30px -10px {{{{t.dangerSolid}}}}; display: flex; align-items: center; justify-content: center;">{WARN.replace("16", "22", 2)}</span>\n      '
content = header('Clear the entire library?', '', 'Danger zone', lead) + body(f'''      <p style="margin: 0; font-size: 15px; line-height: 1.55; color: {{{{t.body}}}};">This permanently deletes every card, deck and review history on all your synced devices. <span style="font-weight: 650; color: {{{{t.danger}}}};">It can’t be undone.</span></p>
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); border-radius: {{{{t.fr}}}}px; border: 1px solid {{{{t.dangerLine}}}}; background: {{{{t.dangerBg}}}};">
        <div style="padding: 12px 16px; border-right: 1px solid {{{{t.dangerLine}}}};"><div style="{SERIF} font-size: 28px; color: {{{{t.textStrong}}}};">1,228</div><div style="font-size: 12px; color: {{{{t.text2}}}};">cards</div></div>
        <div style="padding: 12px 16px; border-right: 1px solid {{{{t.dangerLine}}}};"><div style="{SERIF} font-size: 28px; color: {{{{t.textStrong}}}};">5</div><div style="font-size: 12px; color: {{{{t.text2}}}};">decks</div></div>
        <div style="padding: 12px 16px;"><div style="{SERIF} font-size: 28px; color: {{{{t.textStrong}}}};">312</div><div style="font-size: 12px; color: {{{{t.text2}}}};">mastered words</div></div>
      </div>
      <div style="display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 12px; border: 1px solid {{{{t.line}}}}; background: {{{{t.chipBg}}}};">
        <span style="font-size: 13.5px; line-height: 1.4; color: {{{{t.body}}}};">Keep a copy first — export everything as CSV.</span>
        <button style="margin-left: auto; flex-shrink: 0; height: 36px; padding: 0 12px; border-radius: 10px; border: 1px solid {{{{t.line}}}}; background: {{{{t.secondaryBg}}}}; color: {{{{t.text}}}}; font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px;">{DOWNLOAD}Export CSV</button>
      </div>
      <label style="display: flex; flex-direction: column; gap: 6px;"><span style="{LABEL}">Type <span style="{MONO} color: {{{{t.danger}}}};">DELETE</span> to confirm</span>
        <span style="{FIELD} height: 48px; border-color: {{{{t.dangerLine}}}};"><input value="DELETE" aria-label="Type DELETE to confirm" style="width: 100%; border: 0; outline: none; background: transparent; color: {{{{t.textStrong}}}}; {MONO} font-size: 15px; letter-spacing: 0.12em;"><span style="color: {{{{t.danger}}}};">{CHECK}</span></span>
      </label>''') + footer(f'''      <button style="margin-left: auto; {BTN2}">Keep library</button>
      <button class="sf-press" style="{BTND}">Delete everything</button>''')
write('DlgClear', page('Clear library', content, '', '', 540))

# ---------------------------------------------------------------- Import
content = header('Import from spreadsheet', '<span style="font-family: \'Geist Mono\', ui-monospace, monospace;">vocab-ielts-week-6.xlsx</span> · 120 rows', 'Import') + body(f'''      <div role="status" style="padding: 16px; border-radius: {{{{t.fr}}}}px; border: 1px solid {{{{t.accentLine}}}}; background: {{{{t.accentSoft}}}};">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span class="sf-spin" style="width: 16px; height: 16px; box-sizing: border-box; border-radius: 50%; border: 2px solid {{{{t.accentLine}}}}; border-top-color: {{{{t.accent}}}};"></span>
          <span style="font-size: 14px; font-weight: 650; color: {{{{t.textStrong}}}};">Importing <span style="{MONO}">38</span> of <span style="{MONO}">120</span></span>
          <span style="margin-left: auto; font-size: 13px; color: {{{{t.text2}}}};">current: <span style="{SERIF} font-size: 15px; color: {{{{t.accentText}}}};">resilient</span></span>
        </div>
        <div role="progressbar" aria-valuenow="38" aria-valuemin="0" aria-valuemax="120" style="margin-top: 12px; height: 8px; border-radius: 8px; background: {{{{t.track}}}}; overflow: hidden;"><div class="sf-grow" style="width: 32%; height: 100%; border-radius: 8px; background: {{{{bar}}}};"></div></div>
        <div style="margin-top: 8px; font-size: 12px; color: {{{{t.text3}}}};">You can close this — the import keeps running in the background.</div>
      </div>
      <div style="display: flex; align-items: center; gap: 8px;"><span style="height: 24px; padding: 0 9px; border-radius: 999px; border: 1px solid {{{{t.warnLine}}}}; background: {{{{t.warnBg}}}}; color: {{{{t.warn}}}}; font-size: 11.5px; font-weight: 650; display: flex; align-items: center;">Partial</span><span style="font-size: 14px; font-weight: 650; color: {{{{t.textStrong}}}};">When it finishes</span><span style="margin-left: auto; font-size: 12.5px; color: {{{{t.text3}}}};">Result preview</span></div>
      <div style="border-radius: {{{{t.fr}}}}px; border: 1px solid {{{{t.line}}}}; overflow: hidden;">
        <sc-for list="{{{{rows}}}}" as="r" hint-placeholder-count="4">
          <div style="height: 46px; padding: 0 16px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid {{{{t.line}}}}; background: {{{{r.bg}}}};">
            <span style="width: 8px; height: 8px; border-radius: 50%; background: {{{{r.dot}}}};"></span>
            <span style="font-size: 14px; color: {{{{t.text}}}};">{{{{r.label}}}}</span><span style="font-size: 12.5px; color: {{{{t.text3}}}};">{{{{r.hint}}}}</span>
            <span style="margin-left: auto; {MONO} font-size: 15px; color: {{{{r.color}}}};">{{{{r.n}}}}</span>
          </div>
        </sc-for>
        <ul style="margin: 0; padding: 10px 16px 12px 36px; list-style: none; display: flex; flex-direction: column; gap: 6px; background: {{{{t.dangerBg}}}};">
          <sc-for list="{{{{errors}}}}" as="e" hint-placeholder-count="2">
            <li style="font-size: 12.5px; line-height: 1.45; color: {{{{t.body}}}};"><span style="{MONO} color: {{{{t.danger}}}};">{{{{e.row}}}}</span> · {{{{e.msg}}}}</li>
          </sc-for>
        </ul>
      </div>''', gap=14) + footer(f'''      <button style="{BTN2}">{DOWNLOAD}Download error report</button>
      <button class="sf-press" style="margin-left: auto; {BTN1}">Done</button>''')
js = '''    const rows = [
      ['Created', 'new cards', 96, t.good, t.textStrong], ['Reused', 'already in library', 18, t.accent, t.textStrong],
      ['Skipped', 'duplicate rows', 4, t.text3, t.text2], ['Failed', 'see below', 2, t.dangerSolid, t.danger],
    ].map(([label, hint, n, dot, color]) => ({ label, hint, n, dot, color, bg: label === 'Failed' ? t.dangerBg : 'transparent' }));
    const errors = [{ row: 'Row 47', msg: '“colleage” has no dictionary match — check the spelling.' }, { row: 'Row 88', msg: 'Meaning column is empty.' }];
'''
write('DlgImport', page('Import', content, js, "      rows, errors, bar: dark ? 'linear-gradient(90deg, #28d3f4, #966cd7)' : t.accent,\n", 580))

# ---------------------------------------------------------------- Insights
content = header('Learning insights', '', 'Stats · last 30 days') + body(f'''      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
        <sc-for list="{{{{tiles}}}}" as="s" hint-placeholder-count="4">
          <div style="padding: 12px 14px; border-radius: {{{{t.fr}}}}px; border: 1px solid {{{{s.border}}}}; background: {{{{s.bg}}}};">
            <div style="font-size: 12px; color: {{{{t.text2}}}};">{{{{s.label}}}}</div>
            <div style="margin-top: 4px; {SERIF} font-weight: {{{{t.displayWeight}}}}; font-size: 30px; line-height: 1.1; color: {{{{s.color}}}};">{{{{s.n}}}}</div>
          </div>
        </sc-for>
      </div>
      <div style="display: grid; grid-template-columns: 1.35fr 1fr; gap: 12px;">
        <div style="padding: 14px 16px; border-radius: {{{{t.fr}}}}px; border: 1px solid {{{{t.line}}}}; background: {{{{t.chipBg}}}};">
          <div style="{LABEL}">By category</div>
          <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 7px;">
            <sc-for list="{{{{cats}}}}" as="c" hint-placeholder-count="5">
              <div><div style="display: flex; justify-content: space-between; font-size: 12.5px; color: {{{{t.text}}}};"><span>{{{{c.name}}}}</span><span style="{MONO} color: {{{{t.text2}}}};">{{{{c.n}}}}</span></div>
              <div style="margin-top: 4px; height: 6px; border-radius: 6px; background: {{{{t.track}}}};"><div class="sf-grow" style="width: {{{{c.pct}}}}%; height: 100%; border-radius: 6px; background: {{{{c.color}}}};"></div></div></div>
            </sc-for>
          </div>
        </div>
        <div style="padding: 14px 16px; border-radius: {{{{t.fr}}}}px; border: 1px solid {{{{t.line}}}}; background: {{{{t.chipBg}}}};">
          <div style="{LABEL}">Difficulty</div>
          <div style="margin-top: 8px; display: flex; align-items: center; gap: 14px;">
            <svg width="110" height="110" viewBox="0 0 110 110" role="img" aria-label="Easy 46%, Medium 38%, Hard 16%" style="transform: rotate(-90deg); flex-shrink: 0;">
              <circle cx="55" cy="55" r="42" fill="none" stroke="{{{{t.track}}}}" stroke-width="12"></circle>
              <sc-for list="{{{{donut}}}}" as="d" hint-placeholder-count="3"><circle cx="55" cy="55" r="42" fill="none" stroke="{{{{d.color}}}}" stroke-width="12" stroke-dasharray="{{{{d.dash}}}}" stroke-dashoffset="{{{{d.offset}}}}"></circle></sc-for>
            </svg>
            <div style="display: flex; flex-direction: column; gap: 8px;">
              <sc-for list="{{{{donut}}}}" as="d" hint-placeholder-count="3"><div style="display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: {{{{t.text}}}};"><span style="width: 8px; height: 8px; border-radius: 2px; background: {{{{d.color}}}};"></span>{{{{d.label}}}}<span style="{MONO} color: {{{{t.text2}}}};">{{{{d.pct}}}}%</span></div></sc-for>
            </div>
          </div>
        </div>
      </div>
      <div style="padding: 14px 16px 10px; border-radius: {{{{t.fr}}}}px; border: 1px solid {{{{t.line}}}}; background: {{{{t.chipBg}}}};">
        <div style="display: flex; align-items: baseline;"><span style="{LABEL}">XP · last 14 days</span><span style="margin-left: auto; {MONO} font-size: 13px; color: {{{{t.accentText}}}};">+1,340 XP</span></div>
        <svg width="100%" height="60" viewBox="0 0 560 90" preserveAspectRatio="none" role="img" aria-label="Daily XP over the last 14 days" style="margin-top: 8px; display: block;">
          <path d="{{{{spark.area}}}}" fill="{{{{t.sparkFill}}}}"></path>
          <path d="{{{{spark.line}}}}" fill="none" stroke="{{{{t.accent}}}}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></path>
          <circle cx="{{{{spark.lx}}}}" cy="{{{{spark.ly}}}}" r="4" fill="{{{{t.accent}}}}"></circle>
        </svg>
        <div style="display: flex; justify-content: space-between; {MONO} font-size: 10.5px; color: {{{{t.text3}}}};"><span>10 Sep</span><span>Today</span></div>
      </div>''', gap=12) + footer(f'''      <a href="#" style="font-size: 14px; font-weight: 600; color: {{{{t.accentText}}}}; text-decoration: none;">Open full Progress →</a>
      <button style="margin-left: auto; {BTN2}">Close</button>''')
js = '''    const tiles = [['Total', '1,228', false], ['Mastered', '312', false], ['Learning', '304', false], ['Due today', '12', true]].map(([label, n, hot]) => ({
      label, n, color: hot ? t.accentText : t.textStrong, border: hot ? t.accentLine : t.line, bg: hot ? t.accentSoft : t.chipBg }));
    const palette = dark ? ['#28d3f4', '#966cd7', '#f5ae39', '#75d079', '#7ee6fa'] : ['#b4461a', '#337344', '#b8862b', '#1d1a16', '#8a8072'];
    const cats = [['IELTS', 420], ['Daily English', 300], ['Business & law', 242], ['TACN', 170], ['Deep learning', 96]].map(([name, n], i) => ({ name, n, pct: Math.round(n / 420 * 100), color: palette[i] }));
    const C = 2 * Math.PI * 42;
    let cum = 0;
    const donut = [['Easy', 46, t.good], ['Medium', 38, t.accent], ['Hard', 16, t.hard]].map(([label, pct, color]) => {
      const d = { label, pct, color, dash: (C * pct / 100 - 2).toFixed(1) + ' ' + C.toFixed(1), offset: (-C * cum / 100).toFixed(1) };
      cum += pct; return d;
    });
    const xp = [60, 90, 40, 120, 80, 0, 110, 140, 95, 130, 70, 150, 125, 130];
    const pts = xp.map((v, i) => [i * 560 / 13, 84 - v / 160 * 76]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const spark = { line, area: line + ' L560 90 L0 90 Z', lx: pts[13][0].toFixed(1), ly: pts[13][1].toFixed(1) };
'''
write('DlgInsights', page('Learning insights', content, js, '      tiles, cats, donut, spark,\n', 640))

print('ok')
