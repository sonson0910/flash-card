import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {AppErrorBoundary} from './components/AppErrorBoundary.tsx';
import { I18nProvider } from './i18n/I18nProvider';
import { ThemeProvider } from './features/theme/ThemeProvider';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root');

// Buffered performance entries preserve startup measurements without delaying the app.
void import('./lib/performanceVitals').then(({ observeWebVitals }) => observeWebVitals()).catch(() => undefined);

createRoot(rootElement).render(
  <AppErrorBoundary>
    <I18nProvider><ThemeProvider><App /></ThemeProvider></I18nProvider>
  </AppErrorBoundary>,
);
