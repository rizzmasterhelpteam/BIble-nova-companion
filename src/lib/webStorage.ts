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
  } catch {
    // Ignore write failures in restricted browser contexts.
  }
};

export const storageRemove = (key: string) => {
  try {
    getStorage()?.removeItem(key);
  } catch {
    // Ignore removal failures in restricted browser contexts.
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
