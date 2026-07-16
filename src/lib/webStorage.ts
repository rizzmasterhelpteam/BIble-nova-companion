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

const PREFERENCES_TIMEOUT_MS = 1500;

const LEGACY_GUEST_KEYS = new Set([
  "is_guest",
  "onboardingComplete_guest",
  "isSubscribed_guest",
  "subscriptionSource_guest",
  "bible-nova-companion-chat-guest",
  "bible-nova-companion-intentions-guest",
  "bible-nova-companion-profile-name-guest",
  "bible-nova-companion-profile-avatar-guest",
  "bible-nova-companion-shadow-notes-guest",
]);

const withPreferencesTimeout = <T,>(operation: Promise<T>, label: string) =>
  new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${label} timed out.`));
    }, PREFERENCES_TIMEOUT_MS);

    operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });

const getPreferences = async () => {
  if (!isNativePlatform()) {
    return null;
  }

  if (!preferencesPromise) {
    preferencesPromise = withPreferencesTimeout(
      import("@capacitor/preferences").then(({ Preferences }) => Preferences),
      "Native Preferences module loading",
    ).catch(() => null);
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
      .then((Preferences) =>
        Preferences
          ? withPreferencesTimeout(
              Preferences.set({ key: `web_storage_${key}`, value }),
              "Native Preferences write",
            )
          : undefined,
      )
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
      .then((Preferences) =>
        Preferences
          ? withPreferencesTimeout(
              Preferences.remove({ key: `web_storage_${key}` }),
              "Native Preferences removal",
            )
          : undefined,
      )
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

    const { keys } = await withPreferencesTimeout(
      Preferences.keys(),
      "Native Preferences listing",
    );
    const missingPreferenceKeys = keys
      .filter((prefKey) => prefKey.startsWith("web_storage_"))
      .map((prefKey) => ({
        prefKey,
        originalKey: prefKey.replace("web_storage_", ""),
      }))
      .filter(
        ({ originalKey }) =>
          !LEGACY_GUEST_KEYS.has(originalKey) && !storage.getItem(originalKey),
      );

    const entries = await Promise.all(
      missingPreferenceKeys.map(async ({ prefKey, originalKey }) => {
        const { value } = await withPreferencesTimeout(
          Preferences.get({ key: prefKey }),
          "Native Preferences read",
        );
        return { originalKey, value };
      }),
    );

    for (const { originalKey, value } of entries) {
      if (value !== null) {
        storage.setItem(originalKey, value);
      }
    }

    window.dispatchEvent(new CustomEvent("bible-nova-storage-restored"));
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
