import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createRadixDialogPassthroughMock } from '../../testing/radix-dialog-passthrough';
import { AnimeReveal, type AnimeRevealSourcePayload } from './AnimeReveal';

const theme = vi.hoisted(() => ({ family: 'classic' as 'classic' | 'crystal' }));
vi.mock('@radix-ui/react-dialog', () => createRadixDialogPassthroughMock());
vi.mock('../theme/ThemeProvider', () => ({ useTheme: () => ({ family: theme.family, mode: 'dark' }) }));
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

  it('offers to share the tier and streak reveals as an image, while level up keeps later and use frame', () => {
    const tier = render('tierup');
    expect(tier).toMatch(/data-reveal-share="true"[^>]*>Share card<\/button><button type="button" class="anime-reveal__primary"/);
    expect(tier).toContain('<p class="anime-reveal__share-status" role="status"></p>');
    expect(render('streak')).toMatch(/data-reveal-share="true"[^>]*>Share<\/button>/);
    const level = render('levelup');
    expect(level).not.toContain('data-reveal-share');
    expect(level).not.toContain('anime-reveal__share-status');
  });

  it('names the tier move by status in classic and by tier name in Crystal Star', () => {
    const move = { previousValue: 'learning', currentValue: 'mastered' };
    theme.family = 'classic';
    expect(render('tierup', true, move)).toContain('<b><span>Learning</span> <i>→</i> <em data-tier="mastered">Mastered</em></b>');
    theme.family = 'crystal';
    try {
      // The arrow is drawn; its text stays for assistive tech and for the tier move read as text.
      expect(render('tierup', true, move)).toMatch(/<b class="anime-reveal__tier-move"><span>Bloom<\/span> <i><svg [^>]*>.*?<\/svg><span class="sr-only">→<\/span><\/i> <em data-tier="mastered"><span>Star<\/span><\/em><\/b>/);
    } finally {
      theme.family = 'classic';
    }
  });

  it('stages Crystal Star like its board and leaves classic on its own art', () => {
    const payload = { previousValue: 'learning', currentValue: 'mastered', headword: 'Instant', translation: 'Khoảnh khắc' };
    theme.family = 'crystal';
    try {
      const tier = render('tierup', true, payload);
      expect(tier).toContain('class="anime-reveal__backdrop"');
      expect(tier).toContain('<div class="anime-reveal__beam" data-beam="left"></div>');
      expect(tier.match(/class="anime-reveal__wing crystal-wing-art"/g)).toHaveLength(2);
      expect(tier).toContain('<div class="anime-reveal__tier-art" data-tier="mastered" aria-hidden="true"><span class="anime-reveal__tier-rim"><span class="anime-reveal__tier-rim-spin"></span></span>');
      expect(tier).toContain('<strong>Instant</strong><span>Khoảnh khắc</span>');
      expect(tier).toMatch(/<p class="anime-reveal__kicker"><span>Tier up<\/span><\/p>/);
      const streak = render('streak', true, { streak: { length: 30, freezesEarned: 0 } });
      expect(streak).toMatch(/<span class="anime-reveal__streak-star"><svg viewBox="0 0 100 100"/);
      expect(streak).toMatch(/fill="url\(#[^)]*-flame\)"/);
      expect(render('levelup')).toMatch(/<span class="anime-reveal__level-star"><svg viewBox="0 0 100 100"/);
    } finally {
      theme.family = 'classic';
    }
    const classic = render('tierup', true, payload);
    expect(classic).not.toContain('anime-reveal__backdrop');
    expect(classic).not.toContain('anime-reveal__tier-rim');
    expect(render('levelup')).not.toContain('anime-reveal__level-star');
  });

  it('does not mount while closed', () => expect(render('tierup', false)).toBe(''));
});
