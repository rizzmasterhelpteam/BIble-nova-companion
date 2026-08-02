import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { storageGet, storageSet } from "../lib/webStorage";
import { updateNativeStatusBarTheme } from "../lib/native/app";

type Theme = 'dark' | 'light' | 'system';

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
  theme: 'system',
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'vite-ui-theme',
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (storageGet(storageKey) as Theme) || defaultTheme
  );

  useEffect(() => {
    const root = window.document.documentElement;
    const mediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

    const applyTheme = (nextTheme: Theme) => {
      const resolvedTheme =
        nextTheme === 'system' ? (mediaQuery?.matches ? 'dark' : 'light') : nextTheme;

      if (!root.classList.contains(resolvedTheme)) {
        root.classList.remove('light', 'dark');
        root.classList.add(resolvedTheme);
      }
      root.dataset.design = 'nocturne';
      root.style.colorScheme = resolvedTheme;
      const themeColor = root.ownerDocument.querySelector<HTMLMetaElement>('#theme-color-meta');
      if (themeColor) {
        themeColor.content = resolvedTheme === 'dark' ? '#050b14' : '#d9e9f7';
      }
      void updateNativeStatusBarTheme(resolvedTheme);
    };

    applyTheme(theme);

    if (theme !== 'system' || !mediaQuery) {
      return;
    }

    const handleChange = () => applyTheme('system');
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener && mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener && mediaQuery.removeListener(handleChange);
  }, [theme]);

  useEffect(() => {
    const handleStorageRestore = () => {
      const restoredTheme = storageGet(storageKey) as Theme | null;
      if (restoredTheme === 'dark' || restoredTheme === 'light' || restoredTheme === 'system') {
        setTheme(restoredTheme);
      }
    };

    window.addEventListener('bible-nova-storage-restored', handleStorageRestore);
    return () => window.removeEventListener('bible-nova-storage-restored', handleStorageRestore);
  }, [storageKey]);

  const setThemeValue = useCallback((theme: Theme) => {
      storageSet(storageKey, theme);
      setTheme(theme);
    },
    [storageKey],
  );

  const value = useMemo(
    () => ({
      theme,
      setTheme: setThemeValue,
    }),
    [setThemeValue, theme],
  );

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error('useTheme must be used within a ThemeProvider');

  return context;
};
