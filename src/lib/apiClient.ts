import { isNativePlatform } from "./native/platform";

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, "") || "";
const shouldUseConfiguredApiBaseUrl = Boolean(configuredApiBaseUrl) && isNativePlatform();

export const getApiUrl = (path: string) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return shouldUseConfiguredApiBaseUrl
    ? `${configuredApiBaseUrl}${normalizedPath}`
    : normalizedPath;
};

export const apiFetch = (path: string, init?: RequestInit) => fetch(getApiUrl(path), init);
