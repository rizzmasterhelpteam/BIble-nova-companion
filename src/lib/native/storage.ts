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
