import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const planUsage = vi.hoisted(() => ({
  current: { tier: 'free', used: 30, limit: 30, enforced: true, periodEndsAt: new Date('2026-09-30T17:00:00.000Z') } as {
    tier: 'free' | 'pro'; used: number; limit: number; enforced: boolean; periodEndsAt: Date;
  },
}));
vi.mock('./usePlanUsage', () => ({ usePlanUsage: () => planUsage.current }));

import { PlanUsageMeter } from './PlanUsageMeter';

i18n.load('en', {});
i18n.activate('en');

const withI18n = (node: ReactNode) => renderToStaticMarkup(
  <I18nProvider i18n={i18n}>{node}</I18nProvider>,
);

describe('plan usage meter', () => {
  it('explains the exhausted state without disabling manual cards or review', () => {
    const html = withI18n(<PlanUsageMeter />);
    expect(html).toContain('30 / 30 AI cards this month');
    expect(html).toContain('review, add cards manually, and export your data');
    expect(html).toContain('Pro adds more generations');
  });

  it('does not call the allowance exhausted or upsell Pro while the server is not enforcing it', () => {
    planUsage.current = { ...planUsage.current, used: 31, enforced: false };
    const html = withI18n(<PlanUsageMeter />);
    expect(html).toContain('31 / 30 AI cards this month');
    expect(html).not.toContain('No AI card generations left');
    expect(html).not.toContain('Pro adds more generations');
    expect(html).not.toContain('See Pro plan');
  });

  it('says when an exhausted Pro plan ends instead of promising a reset', () => {
    planUsage.current = { tier: 'pro', used: 1_000, limit: 1_000, enforced: true, periodEndsAt: new Date('2026-12-22T17:00:00.000Z') };
    const html = withI18n(<PlanUsageMeter />);
    expect(html).toContain('No AI card generations left on this Pro plan');
    expect(html).toContain('Pro ends Dec 23, 2026');
    expect(html).not.toContain('Resets');
  });
});
