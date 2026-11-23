import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SessionBridge } from './SessionBridge';
import type { SessionBridgeModel } from './dailyLearningPresentation';
import { writeFocusModeEnabled } from '../settings/focus-mode-preference';
import { ThemeProvider } from '../theme/ThemeProvider';

i18n.load('en', {});
i18n.activate('en');

const model: SessionBridgeModel = {
  completedStage: 'review',
  nextStage: 'new',
  completedLabel: 'Review done · 2 of 2',
  nextLabel: 'New words',
  stepLabel: 'Part 2 of 4',
  nextDescription: 'Meet new words.',
  nextSummary: '6 words · 2 from the web',
  liveMessage: '6 items next.',
  stats: [{ label: 'Reviewed', value: '2' }],
  comboCount: 2,
  recentAnswers: [true, true],
  xpEarned: 12,
  stages: [
    { id: 'review', label: 'Review', completed: true, current: false, meta: '2/2' },
    { id: 'new', label: 'New words', completed: false, current: true, meta: '0/6' },
    { id: 'match', label: 'Word match', completed: false, current: false, meta: '0/6' },
    { id: 'recap', label: 'Recap', completed: false, current: false, meta: '' },
  ],
  previewCard: {
    word: 'analysis', translation: 'sự phân tích', phonetic: '/əˈnæləsɪs/', category: 'IELTS', language: 'en',
    translationLanguage: 'vi', partOfSpeech: 'noun', sourceSite: 'bbc.co.uk', exampleSentence: 'A careful analysis of the data.',
  },
  canSkipNextStage: false,
};

const actions = { continue: vi.fn(), skip: vi.fn(), exit: vi.fn() };
const render = (value: SessionBridgeModel) => renderToStaticMarkup(
  <I18nProvider i18n={i18n}><SessionBridge model={value} actions={actions} /></I18nProvider>,
);

describe('SessionBridge', () => {
  it('shows real session progress and a card from the loaded next stage', () => {
    const html = render(model);
    expect(html).toContain('data-session-shell="bridge"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('aria-label="New words"');
    expect(html).toContain('<em>New</em><br/><span>words</span></h1>');
    expect(html).toContain('Part 2 of 4');
    expect(html).toContain('6 words · 2 from the web');
    expect(html).toContain('0/6');
    expect(html).toContain('analysis');
    expect(html).toContain('sự phân tích');
    expect(html).toContain('/əˈnæləsɪs/ · noun');
    expect(html).toContain('From bbc.co.uk');
    expect(html).toContain('A careful analysis of the data.');
    expect(html).toContain('aria-label="Exit session"');
    expect(html).toContain('data-session-combo="2"');
    expect(html).toContain('+12 XP this session');
    expect(html).not.toContain('Skip</');
  });

  it('shows the committed count instead of the combo in focus mode and before a two-answer run', () => {
    const shortRun = render({ ...model, comboCount: 1 });
    expect(shortRun).not.toContain('data-session-combo');
    expect(shortRun).toContain('Reviewed');
    writeFocusModeEnabled(true);
    try {
      const focused = render(model);
      expect(focused).not.toContain('data-session-combo');
      expect(focused).not.toContain('XP this session');
      expect(focused).toContain('Reviewed');
    } finally {
      writeFocusModeEnabled(false);
    }
  });

  it('keeps the back of the card hidden from assistive technology until it is flipped', () => {
    const html = render(model);
    expect(html).toContain('aria-pressed="false"');
    expect(html).toMatch(/session-bridge-card-back" aria-hidden="true"/);
  });

  it('explains an empty stage and offers Skip only when the next stage has real content', () => {
    const empty = render({ ...model, nextStage: 'match', skipReason: 'Only two distinct pairs.' });
    expect(empty).toContain('Only two distinct pairs.');
    expect(empty).not.toContain('Skip</');
    const available = render({ ...model, nextStage: 'match', canSkipNextStage: true });
    expect(available).toContain('Skip</');
  });
  it('names the Crystal combo by the length of the correct run and keeps the shards decorative', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => ({ sonflash_theme_family: 'crystal', sonflash_lumi_enabled: 'false' })[key] ?? null,
      setItem: () => undefined,
    });
    try {
      const crystal = (comboCount: number) => renderToStaticMarkup(
        <I18nProvider i18n={i18n}><ThemeProvider><SessionBridge model={{ ...model, comboCount }} actions={actions} /></ThemeProvider></I18nProvider>,
      );
      const tier = (html: string) => html.match(/session-bridge-combo-tier" aria-hidden="true">([^<]+)</)?.[1];
      expect(tier(crystal(2))).toBe('Sweet');
      expect(tier(crystal(3))).toBe('Lovely');
      expect(tier(crystal(4))).toBe('Sparkly');
      expect(tier(crystal(5))).toBe('Dreamy');
      expect(tier(crystal(9))).toBe('Dreamy+');
      const html = crystal(5);
      expect(html).toContain('correct in a row');
      expect(html.match(/session-bridge-wing session-bridge-wing--(start|end) crystal-wing-art" aria-hidden="true"/g)).toHaveLength(2);
      expect(html).toContain('session-bridge-combo-star crystal-star-art" aria-hidden="true"');
    } finally {
      vi.unstubAllGlobals();
    }
    const classic = render({ ...model, comboCount: 5 });
    expect(classic).not.toContain('session-bridge-combo-tier');
    expect(classic).not.toContain('crystal-wing-art');
    expect(classic).toContain('correct answers in a row');
  });

  it('writes the Crystal card tier as name and status and quotes the source sentence on the front', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => ({ sonflash_theme_family: 'crystal', sonflash_lumi_enabled: 'false' })[key] ?? null,
      setItem: () => undefined,
    });
    const tiered = { ...model, previewCard: { ...model.previewCard!, tier: 'new' as const } };
    try {
      const html = renderToStaticMarkup(
        <I18nProvider i18n={i18n}><ThemeProvider><SessionBridge model={tiered} actions={actions} /></ThemeProvider></I18nProvider>,
      );
      expect(html).toContain('<span class="session-bridge-card-tier" data-tier="new"><b>Bud</b><span>New</span></span>');
      expect(html).toMatch(/<span class="session-bridge-card-quote" lang="en"><q>A careful <b>analysis<\/b> of the data\.<\/q><\/span>/);
    } finally {
      vi.unstubAllGlobals();
    }
    const classic = render(tiered);
    expect(classic).not.toContain('session-bridge-card-tier');
    expect(classic).not.toContain('session-bridge-card-quote');
  });

  it('picks out the previewed word itself, not a fragment of an earlier word', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => ({ sonflash_theme_family: 'crystal', sonflash_lumi_enabled: 'false' })[key] ?? null,
      setItem: () => undefined,
    });
    const quote = (word: string, exampleSentence: string) => {
      const html = renderToStaticMarkup(
        <I18nProvider i18n={i18n}><ThemeProvider>
          <SessionBridge model={{ ...model, previewCard: { ...model.previewCard!, word, exampleSentence, tier: 'new' as const } }} actions={actions} />
        </ThemeProvider></I18nProvider>,
      );
      return html.slice(html.indexOf('<q>'), html.indexOf('</q>') + 4);
    };
    try {
      expect(quote('art', 'Start with the art of small talk.')).toBe('<q>Start with the <b>art</b> of small talk.</q>');
      expect(quote('is', 'This is my brother.')).toBe('<q>This <b>is</b> my brother.</q>');
      // An inflected form or a script written without spaces has no whole-word match and still gets a highlight.
      expect(quote('walk', 'She walked home.')).toBe('<q>She <b>walk</b>ed home.</q>');
      expect(quote('日本', '私は日本語を学ぶ。')).toBe('<q>私は<b>日本</b>語を学ぶ。</q>');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
