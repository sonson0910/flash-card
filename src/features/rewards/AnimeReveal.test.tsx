import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createRadixDialogPassthroughMock } from '../../testing/radix-dialog-passthrough';
import { AnimeReveal, type AnimeRevealSourcePayload } from './AnimeReveal';

vi.mock('@radix-ui/react-dialog', () => createRadixDialogPassthroughMock());
i18n.load('en', {});
i18n.activate('en');

const render = (event: 'tierup' | 'streak' | 'levelup', open = true, payload: AnimeRevealSourcePayload | null = { title: 'Committed event', previousValue: '12', currentValue: '13', description: 'From the committed source.', rewardLabels: ['Reward A'] }) => renderToStaticMarkup(<I18nProvider i18n={i18n}><AnimeReveal
  open={open} event={event} onContinue={vi.fn()} onEquip={vi.fn()} onLater={vi.fn()} lumiEnabled={false} reducedMotion
  payload={payload ?? undefined}
/></I18nProvider>);

describe('AnimeReveal', () => {
  it('renders only source payload values and does not invent Canvas sample rewards', () => {
    const html = render('tierup');
    expect(html).toContain('Committed event');
    expect(html).toContain('Reward A');
    expect(html).not.toContain('+25 XP');
    expect(html).toContain('data-motion="reduced"');
    expect(html).toContain('anime-reveal__tier-card');
  });

  it('renders the level-up equip and later actions, while other events continue', () => {
    expect(render('levelup')).toContain('Use frame');
    expect(render('levelup')).toContain('Later');
    expect(render('levelup')).toContain('LV</small><strong>13</strong>');
    const sourced = render('levelup', true, { previousValue: '12', currentValue: '13' });
    expect(sourced).toContain('LV 12 <i>→</i> 13');
    expect(sourced).toContain('Level up: level 12 to 13');
    expect(render('streak')).toContain('Keep going');
    expect(render('streak')).toContain('anime-reveal__streak-art');
    expect(render('streak')).not.toContain('Later');
  });

  it('keeps the verified streak milestone and badge without promising a freeze', () => {
    const html = render('streak', true, null);

    expect(html).toContain('Streak milestone');
    expect(html).toContain('Web Wanderer');
    expect(html).not.toContain('freeze');
  });

  it('shows only the freeze, XP and badge the milestone review reported', () => {
    const html = render('streak', true, { streak: { length: 30, freezesEarned: 1, freezesHeld: 2, milestoneXp: 100 }, rewardLabels: ['Web Wanderer'] });
    expect(html).toContain('30-day streak');
    expect(html).toContain('<strong>30</strong>');
    expect(html).toContain('A full month of study. You earned 1 streak freeze, so one missed day will not break the chain. You now hold 2.');
    expect(html).toContain('<li data-tone="holo">+1 streak freeze</li>');
    expect(html).toContain('<li data-tone="gold">+100 XP</li>');
    expect(html).toContain('<li data-tone="crimson">Badge · Web Wanderer</li>');

    const plain = render('streak', true, { streak: { length: 30, freezesEarned: 0 }, rewardLabels: ['Web Wanderer'] });
    expect(plain).toContain('A full month of study.');
    expect(plain).not.toMatch(/freeze|XP|You now hold/);
    expect(plain).toContain('Badge · Web Wanderer');
    expect(render('streak', true, { streak: { length: 60, freezesEarned: 2 } })).toContain('60 days of study in a row. You earned 2 streak freezes, so 2 missed days will not break the chain.');
  });

  it('does not mount while closed', () => expect(render('tierup', false)).toBe(''));
});
