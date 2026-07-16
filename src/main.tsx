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

// Native Preferences is only a convenience mirror for local web state. It must
// never be allowed to hold the WebView at an empty page if the native bridge is
// slow or a previous plugin call is stuck.
const STORAGE_RESTORE_TIMEOUT_MS = 900;

const restoreStorageWithoutBlockingStartup = async () => {
  let timeoutId: number | undefined;
  let didTimeout = false;

  const restorePromise = restoreWebStorageFromPreferences().catch((error) => {
    console.warn("Continuing without restored native web storage:", error);
  });

  const timeoutPromise = new Promise<void>((resolve) => {
    timeoutId = window.setTimeout(() => {
      didTimeout = true;
      console.warn("Native web storage restore timed out. Continuing startup.");
      resolve();
    }, STORAGE_RESTORE_TIMEOUT_MS);
  });

  await Promise.race([restorePromise, timeoutPromise]);

  if (timeoutId !== undefined) {
    window.clearTimeout(timeoutId);
  }

  if (!didTimeout) {
    await restorePromise;
  }
};

void restoreStorageWithoutBlockingStartup().finally(renderApp);
