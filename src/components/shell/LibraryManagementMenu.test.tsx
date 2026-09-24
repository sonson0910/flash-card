import { renderToStaticMarkup } from 'react-dom/server';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { describe, expect, it, vi } from 'vitest';
import { LibraryManagementMenu } from './LibraryManagementMenu';

describe('LibraryManagementMenu', () => {
  it('groups maintenance actions behind a compact accessible trigger', () => {
    i18n.load('en', {});
    i18n.activate('en');
    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}><LibraryManagementMenu
      isExporting={false}
      isLibraryMutationPending={false}
      onExportLibrary={vi.fn()}
      onClearLibrary={vi.fn()}
    /></I18nProvider>);

    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Manage library"');
    expect(html).toContain('title="Manage library"');
    expect(html).toContain('size-11');
    expect(html).not.toContain('>Manage library</button>');
    expect(html).not.toContain('Export library to Excel');
    expect(html).not.toContain('Clear the entire library');
    expect(html).toContain('focus-visible:');
    expect(html).not.toMatch(/\bhidden\b.*\bxl:/);
  });
});
