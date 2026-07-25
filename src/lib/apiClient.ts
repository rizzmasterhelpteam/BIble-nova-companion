import { isNativePlatform } from "./native/platform";
import { isSupabaseConfigured, supabase } from "./supabase";

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, "") || "";
const shouldUseConfiguredApiBaseUrl = Boolean(configuredApiBaseUrl) && isNativePlatform();
const NATIVE_API_CONFIGURATION_ERROR =
  "Server connection is not configured for this app build. Android builds require VITE_API_BASE_URL.";

export const isNativeApiConfigured = () => !isNativePlatform() || Boolean(configuredApiBaseUrl);

export const getApiUrl = (path: string) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return shouldUseConfiguredApiBaseUrl
    ? `${configuredApiBaseUrl}${normalizedPath}`
    : normalizedPath;
};

export const apiFetch = async (path: string, init: RequestInit = {}) => {
  if (!isNativeApiConfigured()) {
    if (import.meta.env.DEV) {
      console.warn(NATIVE_API_CONFIGURATION_ERROR);
    }
    throw new Error(NATIVE_API_CONFIGURATION_ERROR);
  }

  const headers = new Headers(init.headers);
  if (!headers.has("Authorization") && isSupabaseConfigured) {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }
  }

  return fetch(getApiUrl(path), {
    ...init,
    headers,
  });
};
