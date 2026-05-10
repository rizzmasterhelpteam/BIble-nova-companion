import { Preferences } from "@capacitor/preferences";

export const nativeStorage = {
  async get(key: string) {
    const { value } = await Preferences.get({ key });
    return value;
  },

  async set(key: string, value: string) {
    await Preferences.set({ key, value });
  },

  async remove(key: string) {
    await Preferences.remove({ key });
  },

  async clear() {
    await Preferences.clear();
  },
};
