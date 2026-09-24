import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./usePlanUsage', () => ({ usePlanUsage: () => ({
  tier: 'free', used: 30, limit: 30, periodEndsAt: new Date('2026-09-30T17:00:00.000Z'),
}) }));

import { PlanUsageMeter } from './PlanUsageMeter';

describe('plan usage meter', () => {
  it('explains the exhausted state without disabling manual cards or review', () => {
    const html = renderToStaticMarkup(<PlanUsageMeter />);
    expect(html).toContain('30 / 30 thẻ AI');
    expect(html).toContain('ôn tập, thêm thẻ thủ công và xuất dữ liệu');
    expect(html).toContain('Gói Pro có thêm lượt');
  });
});
