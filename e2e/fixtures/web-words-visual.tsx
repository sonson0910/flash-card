import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import '../../src/index.css';
import { ThemeProvider } from '../../src/features/theme/ThemeProvider';
import { WebWordsPage } from '../../src/features/webWords/WebWordsPage';
import { I18nProvider, useUiLocale } from '../../src/i18n/I18nProvider';
import { loadCatalog } from '../../src/i18n/loadCatalog';

function WebWordsVisualFixture() {
  const locale = useUiLocale();
  const [ready, setReady] = useState(false);

  useEffect(() => { void loadCatalog(locale, 'today').then(() => setReady(true)); }, [locale]);
  if (!ready) return null;
  return <WebWordsPage ownerId={null} targetLanguage="en" onClose={() => undefined} />;
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider><I18nProvider><WebWordsVisualFixture /></I18nProvider></ThemeProvider>,
);
