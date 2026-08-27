import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LibraryOverview } from './LibraryOverview';

describe('LibraryOverview', () => {
  it('points an empty library to the single creator without duplicating actions', () => {
    const html = renderToStaticMarkup(<LibraryOverview total={0} due={0} mastered={0} streak={0} level={1} xp={0} canStudy={false} onStartStudy={vi.fn()} onCreateCard={vi.fn()} />);

    expect(html).toContain('Start with one word below');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('Supporting evidence');
  });

  it('uses honest singular streak copy for a populated library', () => {
    const html = renderToStaticMarkup(<LibraryOverview total={8} due={2} mastered={3} streak={1} level={2} xp={120} canStudy onStartStudy={vi.fn()} onCreateCard={vi.fn()} />);

    expect(html).toContain('1 day');
    expect(html).not.toContain('1 days');
    expect(html).toContain('data-library-overview-mode="compact"');
    expect(html).not.toContain('min-h-[260px]');
    expect(html).toContain('Learning snapshot');
    expect(html).toContain('data-react-bits="spotlight-card"');
  });
});
