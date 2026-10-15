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
  completedLabel: 'Review done',
  nextLabel: 'New words',
  nextDescription: 'Meet new words.',
  liveMessage: '6 items next.',
  stats: [{ label: 'Reviewed', value: '2' }],
  comboCount: 2,
  stages: [
    { id: 'review', label: 'Review', completed: true, current: false },
    { id: 'new', label: 'New words', completed: false, current: true },
    { id: 'match', label: 'Word match', completed: false, current: false },
    { id: 'recap', label: 'Recap', completed: false, current: false },
  ],
  previewCard: { word: 'analysis', translation: 'sự phân tích', phonetic: '/əˈnæləsɪs/', category: 'IELTS', language: 'en' },
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
    expect(html).toContain('New words</h1>');
    expect(html).toContain('analysis');
    expect(html).toContain('sự phân tích');
    expect(html).toContain('aria-label="Exit session"');
    expect(html).toContain('data-session-combo="2"');
    expect(html).toContain('Reviewed');
    expect(html).not.toContain('Skip</');
  });

  it('hides the combo in focus mode and before two committed reviews', () => {
    expect(render({ ...model, comboCount: 1 })).not.toContain('data-session-combo');
    writeFocusModeEnabled(true);
    try {
      expect(render(model)).not.toContain('data-session-combo');
    } finally {
      writeFocusModeEnabled(false);
    }
  });

  it('explains an empty stage and offers Skip only when the next stage has real content', () => {
    const empty = render({ ...model, nextStage: 'match', skipReason: 'Only two distinct pairs.' });
    expect(empty).toContain('Only two distinct pairs.');
    expect(empty).not.toContain('Skip</');
    const available = render({ ...model, nextStage: 'match', canSkipNextStage: true });
    expect(available).toContain('Skip</');
  });
});
