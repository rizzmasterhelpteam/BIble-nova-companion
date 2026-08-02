import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { startup } from './lib/startup';
import { registerWebApp } from './lib/webApp';

startup.mark("main-evaluated");
registerWebApp();

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

renderApp();
