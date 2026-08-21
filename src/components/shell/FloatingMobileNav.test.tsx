import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FloatingMobileNav } from './FloatingMobileNav';

const destinations = [
  { view: 'today', renderedLabel: 'Today&#x27;s plan', text: 'Today' },
  { view: 'catalog', renderedLabel: 'Learning paths', text: 'Paths' },
  { view: 'library', renderedLabel: 'Vocabulary Library', text: 'Vocabulary' },
  { view: 'progress', renderedLabel: 'Progress &amp; Achievements', text: 'Progress' },
] as const;

const renderNav = (activeView: (typeof destinations)[number]['view'] = 'today') => renderToStaticMarkup(
  <FloatingMobileNav
    activeView={activeView}
    onSelectView={vi.fn()}
  />
);

describe('FloatingMobileNav', () => {
  it('renders the ADR-003 Today, Paths, Vocabulary and Progress IA', () => {
    const html = renderNav();

    expect(html).toContain('Today');
    expect(html).toContain('Paths');
    expect(html).toContain('Vocabulary');
    expect(html).toContain('Progress');
    expect(html).not.toContain('Home');
    expect(html).not.toContain('>Library<');
  });

  it.each(destinations)('marks only $view active with aria-current', ({ view, renderedLabel }) => {
    const html = renderNav(view);

    expect(html.match(/aria-current="page"/g) ?? []).toHaveLength(1);
    const activeButton = html.split('<button').find(button => button.includes('aria-current="page"'));
    expect(activeButton).toContain(`aria-label="${renderedLabel}"`);
  });

  it('keeps all four mobile targets touch-sized', () => {
    const html = renderNav();
    const buttons = html.match(/<button[^>]*>/g) ?? [];

    expect(buttons).toHaveLength(4);
    expect(buttons.every(button => button.includes('min-h-11'))).toBe(true);
    expect(buttons.every(button => button.includes('min-w-11'))).toBe(true);
  });

  it.each(['landing', 'study', 'quiz', 'spelling', 'story', 'match', 'shadowing'] as const)(
    'hides the shell navigation on %s',
    activeView => {
      expect(renderToStaticMarkup(
        <FloatingMobileNav activeView={activeView} onSelectView={vi.fn()} />,
      )).toBe('');
    },
  );

  it('keeps Paths reachable from every non-practice destination', () => {
    for (const { view } of destinations) {
      const onSelectView = vi.fn();
      const html = renderToStaticMarkup(
        <FloatingMobileNav activeView={view} onSelectView={onSelectView} />,
      );

      expect(html).toContain('Learning paths');
      onSelectView('catalog');
      expect(onSelectView).toHaveBeenCalledWith('catalog');
    }
  });
});
