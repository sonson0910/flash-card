import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {AppErrorBoundary} from './components/AppErrorBoundary.tsx';
import { I18nProvider } from './i18n/I18nProvider';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Application root element is missing.');

createRoot(rootElement).render(
  <AppErrorBoundary>
    <I18nProvider><App /></I18nProvider>
  </AppErrorBoundary>,
);
