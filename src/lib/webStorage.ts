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
let restorePromise: Promise<void> | null = null;

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

const unwrapStoredValue = (raw: string | null) => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { value?: unknown; schemaVersion?: unknown };
    return typeof parsed?.value === "string" && typeof parsed.schemaVersion === "number"
      ? parsed.value
      : raw;
  } catch {
    return raw;
  }
};

const getStoredUpdatedAt = (raw: string | null) => {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as { updatedAt?: unknown; schemaVersion?: unknown };
    return typeof parsed.schemaVersion === "number" && typeof parsed.updatedAt === "number"
      ? parsed.updatedAt
      : 0;
  } catch {
    return 0;
  }
};

export const storageGet = (key: string) => unwrapStoredValue(getStorage()?.getItem(key) ?? null);

export const storageSet = (key: string, value: string) => {
  try {
    const storage = getStorage();
    const envelope = JSON.stringify({ value, updatedAt: Date.now(), schemaVersion: 1 });
    storage?.setItem(key, envelope);

    if (!isNativePlatform()) {
      return;
    }

    void getPreferences()
      .then((Preferences) =>
        Preferences
          ? withPreferencesTimeout(
              Preferences.set({ key: `web_storage_${key}`, value: envelope }),
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
const restoreWebStorageFromPreferencesImpl = async () => {
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
    const storedPreferenceKeys = keys
      .filter((prefKey) => prefKey.startsWith("web_storage_"))
      .map((prefKey) => ({
        prefKey,
        originalKey: prefKey.replace("web_storage_", ""),
      }))
      .filter(({ originalKey }) => !LEGACY_GUEST_KEYS.has(originalKey));

    const entries = await Promise.all(
      storedPreferenceKeys.map(async ({ prefKey, originalKey }) => {
        const { value } = await withPreferencesTimeout(
          Preferences.get({ key: prefKey }),
          "Native Preferences read",
        );
        return { prefKey, originalKey, value };
      }),
    );

    for (const { prefKey, originalKey, value } of entries) {
      if (value !== null) {
        const localRaw = storage.getItem(originalKey);
        const preferenceUpdatedAt = getStoredUpdatedAt(value);
        const localUpdatedAt = getStoredUpdatedAt(localRaw);
        const localIsMissing = localRaw === null;
        const preferenceIsLegacy = preferenceUpdatedAt === 0;
        if (localIsMissing || (!preferenceIsLegacy && preferenceUpdatedAt > localUpdatedAt)) {
          const migratedValue = preferenceIsLegacy
            ? JSON.stringify({ value: unwrapStoredValue(value), updatedAt: Date.now(), schemaVersion: 1 })
            : value;
          storage.setItem(originalKey, migratedValue);
          if (preferenceIsLegacy) {
            void withPreferencesTimeout(
              Preferences.set({ key: prefKey, value: migratedValue }),
              "Native Preferences migration",
            ).catch(() => undefined);
          }
        }
      }
    }

    window.dispatchEvent(new CustomEvent("bible-nova-storage-restored"));
  } catch (err) {
    console.warn('Failed to restore web storage from preferences', err);
    throw err;
  }
};

export const restoreWebStorageFromPreferences = () => {
  if (!isNativePlatform()) return Promise.resolve();
  restorePromise ||= restoreWebStorageFromPreferencesImpl().finally(() => {
    restorePromise = null;
  });
  return restorePromise;
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
