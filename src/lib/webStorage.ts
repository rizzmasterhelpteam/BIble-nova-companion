import { isNativePlatform } from "./native/platform";

const getStorage = () => {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

let preferencesPromise: Promise<typeof import("@capacitor/preferences").Preferences | null> | null =
  null;

const getPreferences = async () => {
  if (!isNativePlatform()) {
    return null;
  }

  if (!preferencesPromise) {
    preferencesPromise = import("@capacitor/preferences")
      .then(({ Preferences }) => Preferences)
      .catch(() => null);
  }

  return preferencesPromise;
};

export const storageGet = (key: string) => getStorage()?.getItem(key) ?? null;

export const storageSet = (key: string, value: string) => {
  try {
    const storage = getStorage();
    storage?.setItem(key, value);

    if (!isNativePlatform()) {
      return;
    }

    void getPreferences()
      .then((Preferences) => Preferences?.set({ key: `web_storage_${key}`, value }))
      .catch(() => {});
  } catch {
    // Ignore write failures in restricted browser contexts.
  }
};

export const storageRemove = (key: string) => {
  try {
    const storage = getStorage();
    storage?.removeItem(key);

    if (!isNativePlatform()) {
      return;
    }

    void getPreferences()
      .then((Preferences) => Preferences?.remove({ key: `web_storage_${key}` }))
      .catch(() => {});
  } catch {
    // Ignore removal failures in restricted browser contexts.
  }
};

/**
 * Call this on app startup to restore any missing localStorage keys from native preferences.
 */
export const restoreWebStorageFromPreferences = async () => {
  if (typeof window === "undefined" || !isNativePlatform()) return;

  try {
    const storage = getStorage();
    if (!storage) return;

    const Preferences = await getPreferences();
    if (!Preferences) return;

    const { keys } = await Preferences.keys();
    const missingPreferenceKeys = keys
      .filter((prefKey) => prefKey.startsWith("web_storage_"))
      .map((prefKey) => ({
        prefKey,
        originalKey: prefKey.replace("web_storage_", ""),
      }))
      .filter(({ originalKey }) => !storage.getItem(originalKey));

    const entries = await Promise.all(
      missingPreferenceKeys.map(async ({ prefKey, originalKey }) => {
        const { value } = await Preferences.get({ key: prefKey });
        return { originalKey, value };
      }),
    );

    for (const { originalKey, value } of entries) {
      if (value !== null) {
        storage.setItem(originalKey, value);
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
