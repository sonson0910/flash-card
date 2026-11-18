import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./usePlanUsage', () => ({ usePlanUsage: () => ({
  tier: 'free', used: 30, limit: 30, periodEndsAt: new Date('2026-09-30T17:00:00.000Z'),
}) }));

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
});
