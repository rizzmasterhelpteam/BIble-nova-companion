import { apiFetch } from "./apiClient";
import { isNativePlatform } from "./native/platform";

export type ApiStatus = {
  chatReady: boolean;
  prayerReady: boolean;
  speechReady?: boolean;
  ttsReady?: boolean;
  voiceReady?: boolean;
  connectionError?: string;
};

export const DEFAULT_API_STATUS: ApiStatus = {
  chatReady: false,
  prayerReady: false,
  speechReady: false,
  ttsReady: false,
  voiceReady: false,
};

type StatusFetcher = (path: string, init?: RequestInit) => Promise<Response>;
type StatusDiagnostics = {
  requestUrl: string;
  forceRefresh: boolean;
  httpStatus: number | null;
  responseOk: boolean | null;
  cacheMode: RequestCache;
  returnedVoiceReady: boolean;
  usedLastKnownGood: boolean;
  error?: string;
};
type StatusLogger = (details: StatusDiagnostics) => void;

class ApiStatusRequestError extends Error {
  readonly status: number;
  readonly responseOk: boolean;

  constructor(status: number, responseOk: boolean) {
    super(`Status request failed with ${status}.`);
    this.name = "ApiStatusRequestError";
    this.status = status;
    this.responseOk = responseOk;
  }
}

const logStatusDiagnostics: StatusLogger = (details) => {
  if (import.meta.env.DEV || isNativePlatform()) {
    console.info("[Bible Nova API status diagnostics]", details);
  }
};

export const createApiStatusLoader = (
  fetcher: StatusFetcher = apiFetch,
  logger: StatusLogger = logStatusDiagnostics,
) => {
  let apiStatusPromise: Promise<ApiStatus> | null = null;
  let lastSuccessfulApiStatus: ApiStatus | null = null;

  const loadApiStatus = (forceRefresh = false) => {
    if (forceRefresh) {
      apiStatusPromise = null;
    }

    if (!apiStatusPromise) {
      const requestUrl = forceRefresh ? `/api/status?refresh=${Date.now()}` : "/api/status";
      const cacheMode: RequestCache = "no-store";
      let responseStatus: number | null = null;
      let responseOk: boolean | null = null;

      apiStatusPromise = fetcher(requestUrl, {
        cache: cacheMode,
        headers: { "Cache-Control": "no-cache" },
      })
        .then(async (response) => {
          responseStatus = response.status;
          responseOk = response.ok;
          if (!response.ok) {
            throw new ApiStatusRequestError(response.status, response.ok);
          }

          const data = (await response.json()) as ApiStatus;
          if (!data || typeof data !== "object") {
            throw new Error("Status response was invalid.");
          }

          lastSuccessfulApiStatus = { ...data, connectionError: undefined };
          logger({
            requestUrl,
            forceRefresh,
            httpStatus: responseStatus,
            responseOk,
            cacheMode,
            returnedVoiceReady: lastSuccessfulApiStatus.voiceReady === true,
            usedLastKnownGood: false,
          });
          return lastSuccessfulApiStatus;
        })
        .catch((error: unknown) => {
          apiStatusPromise = null;
          const message = error instanceof Error ? error.message : "Server connection is unavailable.";
          const fallback = lastSuccessfulApiStatus
            ? { ...lastSuccessfulApiStatus, connectionError: message }
            : { ...DEFAULT_API_STATUS, connectionError: message };
          logger({
            requestUrl,
            forceRefresh,
            httpStatus: error instanceof ApiStatusRequestError ? error.status : responseStatus,
            responseOk: error instanceof ApiStatusRequestError ? error.responseOk : responseOk,
            cacheMode,
            returnedVoiceReady: fallback.voiceReady === true,
            usedLastKnownGood: Boolean(lastSuccessfulApiStatus),
            error: message,
          });
          return fallback;
        });
    }

    return apiStatusPromise;
  };

  return loadApiStatus;
};
