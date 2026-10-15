import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createRadixDialogPassthroughMock } from '../../testing/radix-dialog-passthrough';
import { AnimeReveal } from './AnimeReveal';

vi.mock('@radix-ui/react-dialog', () => createRadixDialogPassthroughMock());
i18n.load('en', {});
i18n.activate('en');

const render = (event: 'tierup' | 'streak' | 'levelup', open = true, payload: { title: string; previousValue: string; currentValue: string; description: string; rewardLabels: string[] } | null = { title: 'Committed event', previousValue: '12', currentValue: '13', description: 'From the committed source.', rewardLabels: ['Reward A'] }) => renderToStaticMarkup(<I18nProvider i18n={i18n}><AnimeReveal
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
    expect(render('levelup')).toContain('12 <i>→</i> 13');
    expect(render('streak')).toContain('Continue learning');
    expect(render('streak')).toContain('anime-reveal__streak-art');
    expect(render('streak')).not.toContain('Later');
  });

  it('keeps the verified streak milestone and badge without promising a freeze', () => {
    const html = render('streak', true, null);

    expect(html).toContain('Streak milestone');
    expect(html).toContain('Web Wanderer');
    expect(html).not.toContain('freeze');
  });

  it('does not mount while closed', () => expect(render('tierup', false)).toBe(''));
});
