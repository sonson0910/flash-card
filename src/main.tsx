import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {AppErrorBoundary} from './components/AppErrorBoundary.tsx';
import './index.css';
import { observeWebVitals } from './lib/performanceVitals.ts';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Application root element is missing.');

observeWebVitals();

createRoot(rootElement).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
