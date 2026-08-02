import { apiFetch } from "./apiClient";
import type {
  EntitlementSnapshot,
  EntitlementSource,
  EntitlementStatus,
} from "../types/entitlement";

export const ENTITLEMENT_CACHE_TTL_MS = 60_000;

type EntitlementResponse = {
  state?: string;
  active?: boolean;
  status?: string;
  source?: string;
  productId?: string | null;
  expiresAt?: string | null;
  verifiedAt?: string | null;
  error?: string;
};

type CachedEntitlement = {
  userId: string;
  expiresAt: number;
  snapshot: EntitlementSnapshot;
};

let cachedEntitlement: CachedEntitlement | null = null;
let inFlightRequest: { userId: string; promise: Promise<EntitlementSnapshot> } | null = null;
const STATUS_RETRY_DELAYS_MS = [250, 750];

const isStatus = (value: string | undefined): value is EntitlementStatus =>
  value === "active" ||
  value === "grace_period" ||
  value === "canceled_until_expiry" ||
  value === "expired" ||
  value === "none" ||
  value === "unknown";

const isSource = (value: string | undefined): value is EntitlementSource =>
  value === "server" ||
  value === "signed_session_metadata" ||
  value === "google_play" ||
  value === "none";

const getErrorMessage = (response: Response, data: EntitlementResponse) =>
  data.error ||
  (response.status === 503
    ? "Premium verification is temporarily unavailable."
    : "Premium verification failed.");

export const clearEntitlementCache = (userId?: string) => {
  if (!userId || cachedEntitlement?.userId === userId) cachedEntitlement = null;
};

export const fetchEntitlementStatus = async (
  userId: string,
  { force = false, signal, bypassInFlight = false }: { force?: boolean; signal?: AbortSignal; bypassInFlight?: boolean } = {},
): Promise<EntitlementSnapshot> => {
  if (!force && cachedEntitlement?.userId === userId && cachedEntitlement.expiresAt > Date.now()) {
    return cachedEntitlement.snapshot;
  }

  if (!bypassInFlight && inFlightRequest?.userId === userId) return inFlightRequest.promise;

  const request = (async () => {
    let response: Response | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= STATUS_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        response = await apiFetch("/api/subscription/status", {
          method: "GET",
          cache: "no-store",
          signal,
          headers: { "Cache-Control": "no-cache" },
        });
        if (response.status !== 503 || attempt === STATUS_RETRY_DELAYS_MS.length) break;
      } catch (error) {
        lastError = error;
        if (attempt === STATUS_RETRY_DELAYS_MS.length) throw error;
      }
      await new Promise<void>((resolve, reject) => {
        const timer = globalThis.setTimeout(resolve, STATUS_RETRY_DELAYS_MS[attempt]);
        signal?.addEventListener("abort", () => {
          globalThis.clearTimeout(timer);
          reject(signal.reason || new Error("Premium verification was cancelled."));
        }, { once: true });
      });
    }
    if (!response) throw (lastError || new Error("Premium verification failed."));
    const data = (await response.json().catch(() => ({}))) as EntitlementResponse;
    if (!response.ok) throw new Error(getErrorMessage(response, data));

    const status = isStatus(data.status) ? data.status : data.active === true ? "active" : "none";
    const active = data.active === true;
    const snapshot: EntitlementSnapshot = {
      state: active ? "active" : "inactive",
      active,
      status,
      source: isSource(data.source) ? data.source : "server",
      productId: typeof data.productId === "string" ? data.productId : null,
      expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : null,
      verifiedAt: typeof data.verifiedAt === "string" ? data.verifiedAt : null,
      error: null,
    };
    cachedEntitlement = {
      userId,
      expiresAt: Date.now() + ENTITLEMENT_CACHE_TTL_MS,
      snapshot,
    };
    return snapshot;
  })();

  inFlightRequest = { userId, promise: request };
  try {
    return await request;
  } finally {
    if (inFlightRequest?.promise === request) inFlightRequest = null;
  }
};

export const getProvisionalEntitlement = (user: {
  app_metadata?: Record<string, unknown>;
} | null): EntitlementSnapshot | null => {
  const subscription = user?.app_metadata?.subscription;
  if (!subscription || typeof subscription !== "object") return null;

  const value = subscription as Record<string, unknown>;
  const status = value.status;
  const expiry = typeof value.trialEndsAt === "string" ? value.trialEndsAt : null;
  const expiryIsValid = !expiry || (Number.isFinite(Date.parse(expiry)) && Date.parse(expiry) > Date.now());
  const active =
    (status === "active" || status === "grace_period" || status === "canceled") &&
    expiryIsValid;
  if (!active) return null;

  return {
    state: "active",
    active: true,
    status: status === "canceled" ? "canceled_until_expiry" : status === "grace_period" ? "grace_period" : "active",
    source: value.source === "native_google_play" ? "google_play" : "signed_session_metadata",
    productId: typeof value.productId === "string" ? value.productId : null,
    expiresAt: expiry,
    verifiedAt: typeof value.linkedAt === "string" ? value.linkedAt : null,
    error: null,
  };
};
