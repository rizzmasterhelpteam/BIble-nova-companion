import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { restoreWebStorageFromPreferences } from './lib/webStorage';
import { startup } from './lib/startup';

startup.mark("main-evaluated");

const renderApp = () => {
  const rootElement = document.getElementById('root');

  if (!rootElement) {
    startup.fail("root-element-missing");
    return;
  }

  try {
    createRoot(rootElement).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    startup.mark("react-root-mounted");
    window.requestAnimationFrame(() => startup.mark("first-frame-painted"));
  } catch (error) {
    console.error("Could not mount Bible Nova Companion:", error);
    startup.fail("react-root-mount");
  }
};

// Local web storage restoration is a best-effort upgrade path. It must never
// delay the first React render or the login route.
renderApp();
void restoreWebStorageFromPreferences().catch((error) => {
  console.warn("Continuing without restored native web storage:", error);
});
