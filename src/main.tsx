import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {AppErrorBoundary} from './components/AppErrorBoundary.tsx';
import { I18nProvider } from './i18n/I18nProvider';
import { ThemeProvider } from './features/theme/ThemeProvider';
import './index.css';
import './styles/themes/classic-motion.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root');

// Neither the startup measurements (buffered entries) nor the reminder click relay is needed for first paint.
void import('./app/deferredStartup').then(({ startDeferredShellWork }) => startDeferredShellWork()).catch(() => undefined);

const render = () => createRoot(rootElement).render(
  <AppErrorBoundary>
    <I18nProvider><ThemeProvider><App /></ThemeProvider></I18nProvider>
  </AppErrorBoundary>,
);

// index.html's boot script has already put the saved family on the root. Crystal's entrances have to be in place
// before its first paint, or they would start over when their sheet arrived, so a Crystal visit renders once the
// sheet has settled. A Classic visit never downloads it.
if (document.documentElement.dataset.themeFamily === 'crystal') {
  void import('./styles/themes/crystal-motion.css').then(render, render);
} else {
  render();
}
