import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initializeNativeApp } from './lib/native/app';

import { restoreWebStorageFromPreferences } from './lib/webStorage';

void initializeNativeApp();

const renderApp = () => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
};

restoreWebStorageFromPreferences()
  .catch((error) => {
    console.warn("Continuing without restored native web storage:", error);
  })
  .finally(renderApp);
