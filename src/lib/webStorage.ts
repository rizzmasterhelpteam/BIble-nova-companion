import { Preferences } from '@capacitor/preferences';

const getStorage = () => {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const storageGet = (key: string) => getStorage()?.getItem(key) ?? null;

export const storageSet = (key: string, value: string) => {
  try {
    getStorage()?.setItem(key, value);
    void Preferences.set({ key: `web_storage_${key}`, value }).catch(() => {});
  } catch {
    // Ignore write failures in restricted browser contexts.
  }
};

export const storageRemove = (key: string) => {
  try {
    getStorage()?.removeItem(key);
    void Preferences.remove({ key: `web_storage_${key}` }).catch(() => {});
  } catch {
    // Ignore removal failures in restricted browser contexts.
  }
};

/**
 * Call this on app startup to restore any missing localStorage keys from native preferences.
 */
export const restoreWebStorageFromPreferences = async () => {
  if (typeof window === "undefined" || !getStorage()) return;
  try {
    const { keys } = await Preferences.keys();
    for (const prefKey of keys) {
      if (prefKey.startsWith('web_storage_')) {
        const originalKey = prefKey.replace('web_storage_', '');
        if (!getStorage()?.getItem(originalKey)) {
          const { value } = await Preferences.get({ key: prefKey });
          if (value !== null) {
            getStorage()?.setItem(originalKey, value);
          }
        }
      }
    }
  } catch (err) {
    console.warn('Failed to restore web storage from preferences', err);
  }
};

export const storageGetJson = <T,>(key: string, fallback: T): T => {
  const raw = storageGet(key);
  if (!raw) return fallback;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};
