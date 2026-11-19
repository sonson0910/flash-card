import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SessionBridge } from './SessionBridge';
import type { SessionBridgeModel } from './dailyLearningPresentation';
import { writeFocusModeEnabled } from '../settings/focus-mode-preference';

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
});
