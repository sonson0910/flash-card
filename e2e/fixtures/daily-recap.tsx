import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import '../../src/index.css';
import { I18nProvider, useUiLocale } from '../../src/i18n/I18nProvider';
import { loadCatalog } from '../../src/i18n/loadCatalog';
import { SessionRecapModal } from '../../src/features/practice/SessionRecapModal';
import { ThemeProvider } from '../../src/features/theme/ThemeProvider';

const weakCards = [
  { id: 'recap-weak-1', word: 'meticulous', normalizedWord: 'meticulous', translation: 'tỉ mỉ', explanation: '', phonetic: '', emoji: '📝', category: 'Visual acceptance', audioUrl: null, imageUrl: null, language: 'en' },
  { id: 'recap-weak-2', word: 'resilient', normalizedWord: 'resilient', translation: 'kiên cường', explanation: '', phonetic: '', emoji: '💪', category: 'Visual acceptance', audioUrl: null, imageUrl: null, language: 'en' },
  { id: 'recap-weak-3', word: 'nuance', normalizedWord: 'nuance', translation: 'sắc thái', explanation: '', phonetic: '', emoji: '🎨', category: 'Visual acceptance', audioUrl: null, imageUrl: null, language: 'en' },
];

function RecapFixture() {
  const locale = useUiLocale();
  const [ready, setReady] = useState(false);

  useEffect(() => { void loadCatalog(locale, 'practice').then(() => setReady(true)); }, [locale]);
  if (!ready) return null;

  return <SessionRecapModal
    open
    onClose={() => undefined}
    onRetryWeak={() => undefined}
    totalCards={12}
    goodCount={10}
    againCount={2}
    xpEarned={175}
    weakCards={weakCards}
  />;
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <I18nProvider>
      <RecapFixture />
    </I18nProvider>
  </ThemeProvider>,
);
