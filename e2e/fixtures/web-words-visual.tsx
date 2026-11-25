import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import '../../src/index.css';
import '../../src/styles/themes/crystal-motion.css';
import '../../src/styles/themes/classic-motion.css';
import '../../src/styles/app-bootstrap.css';
import { ThemeProvider } from '../../src/features/theme/ThemeProvider';
import { WebWordsPage } from '../../src/features/webWords/WebWordsPage';
import { I18nProvider, useUiLocale } from '../../src/i18n/I18nProvider';
import { loadCatalog } from '../../src/i18n/loadCatalog';

function WebWordsVisualFixture() {
  const locale = useUiLocale();
  const [ready, setReady] = useState(false);

  useEffect(() => { void loadCatalog(locale, 'today').then(() => setReady(true)); }, [locale]);
  if (!ready) return null;
  // The page is a workspace view; the fixture gives it the same workspace padding the app shell does.
  return <main className="app-canvas min-h-dvh">
    <div className="claude-workspace-inner relative w-full max-w-[1440px] mx-auto px-5 pt-5 pb-28 sm:px-8 lg:px-11 lg:pt-3 lg:pb-8">
      <WebWordsPage ownerId={null} targetLanguage="en" translationLanguage="vi" onClose={() => undefined} />
    </div>
  </main>;
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider><I18nProvider><WebWordsVisualFixture /></I18nProvider></ThemeProvider>,
);
