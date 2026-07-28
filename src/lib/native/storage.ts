let preferencesPromise: Promise<typeof import("@capacitor/preferences").Preferences> | null = null;

const getPreferences = () => {
  preferencesPromise ||= import("@capacitor/preferences").then(({ Preferences }) => Preferences);
  return preferencesPromise;
};

export const nativeStorage = {
  async get(key: string) {
    const Preferences = await getPreferences();
    const { value } = await Preferences.get({ key });
    return value;
  },

  async set(key: string, value: string) {
    const Preferences = await getPreferences();
    await Preferences.set({ key, value });
  },

  async remove(key: string) {
    const Preferences = await getPreferences();
    await Preferences.remove({ key });
  },

  async clear() {
    const Preferences = await getPreferences();
    await Preferences.clear();
  },
};

type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

const RECOVERY_STORAGE_PREFIX = "bible_nova_recovery:";

export const createNativeRecoveryStorage = (
  getStorage: () => RecoveryStorage | null = () => {
    try {
      return typeof window === "undefined" ? null : window.localStorage;
    } catch {
      return null;
    }
  },
) => {
  const fallback = new Map<string, string>();
  const prefixed = (key: string) => `${RECOVERY_STORAGE_PREFIX}${key}`;

  const readStorage = () => {
    try {
      return getStorage();
    } catch {
      return null;
    }
  };

  return {
    async get(key: string) {
      const storageKey = prefixed(key);
      const storage = readStorage();
      if (!storage) return fallback.get(storageKey) ?? null;
      try {
        return storage.getItem(storageKey);
      } catch {
        return fallback.get(storageKey) ?? null;
      }
    },

    async set(key: string, value: string) {
      const storageKey = prefixed(key);
      fallback.set(storageKey, value);
      const storage = readStorage();
      if (!storage) return;
      try {
        storage.setItem(storageKey, value);
      } catch {
        // Recovery state is best effort and remains available in memory.
      }
    },

    async remove(key: string) {
      const storageKey = prefixed(key);
      fallback.delete(storageKey);
      const storage = readStorage();
      if (!storage) return;
      try {
        storage.removeItem(storageKey);
      } catch {
        // Recovery state is best effort.
      }
    },

    async clear() {
      fallback.clear();
      const storage = readStorage();
      if (!storage) return;
      try {
        const recoveryKeys: string[] = [];
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (key?.startsWith(RECOVERY_STORAGE_PREFIX)) recoveryKeys.push(key);
        }
        recoveryKeys.forEach((key) => storage.removeItem(key));
      } catch {
        // Recovery state is best effort.
      }
    },
  };
};

// Voice crash-recovery values are non-secret request/lease identifiers. Keep
// them in WebView localStorage so a slow Capacitor bridge cannot stall startup
// or leave a completed session looking active. General app preferences still
// use Capacitor Preferences above.
export const nativeRecoveryStorage = createNativeRecoveryStorage();
