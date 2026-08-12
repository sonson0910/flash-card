import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LibraryManagementMenu } from './LibraryManagementMenu';

describe('LibraryManagementMenu', () => {
  it('groups responsive Library maintenance actions behind one accessible trigger', () => {
    const html = renderToStaticMarkup(<LibraryManagementMenu
      isExporting={false}
      isLibraryMutationPending={false}
      onExportLibrary={vi.fn()}
      onClearLibrary={vi.fn()}
    />);

    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Manage library');
    expect(html).not.toContain('Export library to Excel');
    expect(html).not.toContain('Clear the entire library');
    expect(html).toContain('focus-visible:');
    expect(html).not.toMatch(/\bhidden\b.*\bxl:/);
  });
});
