import { isNativePlatform } from "./native/platform";
import { isSupabaseConfigured, supabase } from "./supabase";

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, "") || "";
const shouldUseConfiguredApiBaseUrl = Boolean(configuredApiBaseUrl) && isNativePlatform();
const NATIVE_API_CONFIGURATION_ERROR =
  "Server connection is not configured for this app build. Android builds require VITE_API_BASE_URL.";
export const API_REQUEST_TIMEOUT_MS = 30_000;
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
    (path === "/api/transcribe" || path.startsWith("/api/voice/"))
  ) {
    headers.set("X-Client-Request-Id", crypto.randomUUID());
  }
  if (!headers.has("Authorization") && isSupabaseConfigured) {
    const accessToken = await getApiAccessToken();
    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }
  }

  const controller = new AbortController();
  const callerSignal = init.signal;
  const forwardAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal) {
    if (callerSignal.aborted) forwardAbort();
    else callerSignal.addEventListener("abort", forwardAbort, { once: true });
  }
  const timeoutId = globalThis.setTimeout(() => {
    controller.abort(new Error("The server request timed out."));
  }, API_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(getApiUrl(path), {
      ...init,
      signal: controller.signal,
      headers,
    });
  } finally {
    globalThis.clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", forwardAbort);
  }
};
