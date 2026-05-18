import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initializeNativeApp } from './lib/native/app';

import { restoreWebStorageFromPreferences } from './lib/webStorage';

void initializeNativeApp();

restoreWebStorageFromPreferences().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
