import { isNativePlatform } from "./native/platform";
import { isSupabaseConfigured, supabase } from "./supabase";
import { API_CONTRACT_VERSION } from "../platform/types";

const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, "") || "";
const currentPageOrigin = typeof window === "undefined" ? "" : window.location.origin;
const shouldUseConfiguredApiBaseUrl =
  Boolean(configuredApiBaseUrl) &&
  isNativePlatform() &&
  configuredApiBaseUrl !== currentPageOrigin;
export const API_REQUEST_TIMEOUT_MS = 30_000;
export const API_CONTRACT_MISMATCH_MESSAGE =
  "This app and its server are out of sync. Refresh the app or install the latest version.";
export const API_CONTRACT_MISSING_MESSAGE =
  "The server did not identify its API version. Refresh the app and try again.";
let cachedAccessToken: string | null | undefined;
let accessTokenRequest: Promise<string | null> | null = null;
let sessionGeneration = 0;
const activeControllers = new Set<AbortController>();

export const setApiAccessToken = (accessToken: string | null) => {
  cachedAccessToken = accessToken;
};

export const invalidateApiSession = () => {
  sessionGeneration += 1;
  cachedAccessToken = null;
  accessTokenRequest = null;
  activeControllers.forEach((controller) =>
    controller.abort(new DOMException("Account session changed.", "AbortError")),
  );
  activeControllers.clear();
};

const getApiAccessToken = async () => {
  if (!isSupabaseConfigured) return null;
  if (cachedAccessToken !== undefined) return cachedAccessToken;
  if (accessTokenRequest) return accessTokenRequest;

  const tokenGeneration = sessionGeneration;
  const request = supabase.auth.getSession()
    .then(({ data }) => {
      if (tokenGeneration !== sessionGeneration) {
        throw new DOMException("Account session changed.", "AbortError");
      }
      cachedAccessToken = data.session?.access_token || null;
      return cachedAccessToken;
    })
    .finally(() => {
      if (accessTokenRequest === request) accessTokenRequest = null;
    });
  accessTokenRequest = request;

  return accessTokenRequest;
};

export const isNativeApiConfigured = () => true;

export const getApiUrl = (path: string) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return shouldUseConfiguredApiBaseUrl
    ? `${configuredApiBaseUrl}${normalizedPath}`
    : normalizedPath;
};

export const apiFetch = async (path: string, init: RequestInit = {}) => {
  const requestGeneration = sessionGeneration;
  const headers = new Headers(init.headers);
  if (!headers.has("X-Client-Request-Id")) {
    const requestId = globalThis.crypto?.randomUUID?.()
      || `request-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    headers.set("X-Client-Request-Id", requestId);
  }
  if (!headers.has("Authorization") && isSupabaseConfigured) {
    const accessToken = await getApiAccessToken();
    if (requestGeneration !== sessionGeneration) {
      throw new DOMException("Account session changed.", "AbortError");
    }
    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }
  }

  const controller = new AbortController();
  activeControllers.add(controller);
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
    if (requestGeneration !== sessionGeneration) {
      throw new DOMException("Account session changed.", "AbortError");
    }
    const requestMethod = (init.method || "GET").toUpperCase();
    let response = await fetch(getApiUrl(path), {
      ...init,
      signal: controller.signal,
      headers,
    });

    // Only safe reads may retry once after Supabase refreshes an expired token.
    // Purchase and other mutation requests must never be replayed implicitly.
    if (response.status === 401 && requestMethod === "GET" && isSupabaseConfigured) {
      const { data, error } = await supabase.auth.refreshSession();
      if (requestGeneration !== sessionGeneration) {
        throw new DOMException("Account session changed.", "AbortError");
      }
      if (!error && data.session?.access_token) {
        cachedAccessToken = data.session.access_token;
        headers.set("Authorization", `Bearer ${data.session.access_token}`);
        response = await fetch(getApiUrl(path), {
          ...init,
          signal: controller.signal,
          headers,
        });
      }
    }

    if (requestGeneration !== sessionGeneration) {
      throw new DOMException("Account session changed.", "AbortError");
    }
    const contractVersion = response.headers.get("X-API-Contract-Version");
    if (!contractVersion) {
      throw new Error(API_CONTRACT_MISSING_MESSAGE);
    }
    if (contractVersion !== String(API_CONTRACT_VERSION)) {
      throw new Error(API_CONTRACT_MISMATCH_MESSAGE);
    }
    return response;
  } finally {
    activeControllers.delete(controller);
    globalThis.clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", forwardAbort);
  }
};
