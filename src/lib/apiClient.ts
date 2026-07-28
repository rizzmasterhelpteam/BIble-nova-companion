import { isNativePlatform } from "./native/platform";
import { isSupabaseConfigured, supabase } from "./supabase";

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, "") || "";
const shouldUseConfiguredApiBaseUrl = Boolean(configuredApiBaseUrl) && isNativePlatform();
const NATIVE_API_CONFIGURATION_ERROR =
  "Server connection is not configured for this app build. Android builds require VITE_API_BASE_URL.";
let cachedAccessToken: string | null | undefined;
let accessTokenRequest: Promise<string | null> | null = null;

export const setApiAccessToken = (accessToken: string | null) => {
  cachedAccessToken = accessToken;
};

const getApiAccessToken = async () => {
  if (!isSupabaseConfigured) return null;
  if (cachedAccessToken !== undefined) return cachedAccessToken;
  if (accessTokenRequest) return accessTokenRequest;

  accessTokenRequest = supabase.auth
    .getSession()
    .then(({ data }) => {
      cachedAccessToken = data.session?.access_token || null;
      return cachedAccessToken;
    })
    .finally(() => {
      accessTokenRequest = null;
    });

  return accessTokenRequest;
};

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
  if (
    !headers.has("X-Client-Request-Id") &&
    (path === "/api/transcribe" || path.startsWith("/api/live/"))
  ) {
    headers.set("X-Client-Request-Id", crypto.randomUUID());
  }
  if (!headers.has("Authorization") && isSupabaseConfigured) {
    const accessToken = await getApiAccessToken();
    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }
  }

  return fetch(getApiUrl(path), {
    ...init,
    headers,
  });
};
