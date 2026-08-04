import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizeShadowNotes } from "./src/lib/shadowMemory.js";
import type { VoiceUsageSummary } from "./src/types/live.js";

type RequestLike = {
  headers?: Record<string, string | string[] | undefined>;
};

export type RateLimitRule = {
  key: string;
  limit: number;
};

const RATE_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_VOICE_RATE_LIMIT = 60;
const DEFAULT_VOICE_RATE_LIMIT_WINDOW_SECONDS = 10 * 60;

let cachedAdminClient: { key: string; client: SupabaseClient } | null = null;
let cachedAuthClient: { key: string; client: SupabaseClient } | null = null;

export class HttpError extends Error {
  readonly statusCode: number;
  readonly retryAfterSeconds?: number;

  constructor(message: string, statusCode: number, retryAfterSeconds?: number) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const getHeader = (req: RequestLike, name: string) => {
  const headers = req.headers || {};
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};

const getSupabaseServerConfig = () => {
  // Never fall back to VITE_* here. Vite variables are intentionally exposed
  // to the browser and must not be accepted as server configuration.
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey || url.includes("placeholder.supabase.co")) {
    throw new HttpError("Authentication is not configured on the server.", 503);
  }
  return { url, anonKey };
};

export const getSupabaseAdminClient = (): SupabaseClient => {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey || url.includes("placeholder.supabase.co")) {
    throw new HttpError("Server persistence is not configured.", 503);
  }

  const key = `${url}|${serviceRoleKey}`;
  if (cachedAdminClient?.key === key) return cachedAdminClient.client;

  const client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  cachedAdminClient = { key, client };
  return client;
};

const getSupabaseAuthClient = (url: string, anonKey: string): SupabaseClient => {
  const key = `${url}|${anonKey}`;
  if (cachedAuthClient?.key === key) return cachedAuthClient.client;

  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  cachedAuthClient = { key, client };
  return client;
};

type VerifiedClaims = {
  sub?: unknown;
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  role?: unknown;
};

const hasExpectedAudience = (audience: unknown) =>
  audience === "authenticated" ||
  (Array.isArray(audience) && audience.includes("authenticated"));

const isVerifiedAuthenticatedClaims = (
  claims: VerifiedClaims,
  supabaseUrl: string,
) => {
  const expectedIssuer = `${supabaseUrl.replace(/\/+$/, "")}/auth/v1`;
  return (
    typeof claims.sub === "string" &&
    claims.sub.length > 0 &&
    claims.iss === expectedIssuer &&
    hasExpectedAudience(claims.aud) &&
    claims.role === "authenticated" &&
    typeof claims.exp === "number" &&
    claims.exp * 1_000 > Date.now()
  );
};

export const requireAuthenticatedRequest = async (req: RequestLike) => {
  const authorization = getHeader(req, "authorization")?.trim();
  const accessToken = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    throw new HttpError("Authentication is required.", 401);
  }

  const { url, anonKey } = getSupabaseServerConfig();
  const authClient = getSupabaseAuthClient(url, anonKey);

  // getClaims cryptographically verifies the access token. With asymmetric
  // signing keys it uses cached JWKS verification instead of a round trip to
  // Auth; legacy symmetric projects transparently use the safe server path.
  try {
    const claimsResult = await authClient.auth.getClaims(accessToken);
    if (claimsResult.data?.claims) {
      if (!isVerifiedAuthenticatedClaims(claimsResult.data.claims, url)) {
        throw new HttpError("Your session is invalid or expired.", 401);
      }
      return {
        accessToken,
        userId: claimsResult.data.claims.sub,
      };
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    // A legacy signing key, unavailable Web Crypto implementation, or an
    // unexpected verification failure falls through to Auth's authoritative
    // getUser endpoint below.
  }

  const { data, error } = await authClient.auth.getUser(accessToken);
  if (error || !data.user) {
    throw new HttpError("Your session is invalid or expired.", 401);
  }

  return {
    accessToken,
    userId: data.user.id,
  };
};

export type SubscriptionAccessStatus = {
  active: boolean;
  state: "active" | "inactive";
  status: "active" | "grace_period" | "canceled_until_expiry" | "expired" | "none";
  source: "server" | "google_play" | "none";
  productId: string | null;
  expiresAt: string | null;
  verifiedAt: string | null;
  reconciliationRecommended: boolean;
};

export const isPremiumTestAccount = async (userId: string) => {
  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("premium_test_accounts")
    .select("created_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("Premium test-account lookup unavailable:", error.message);
    return { active: false, createdAt: null as string | null };
  }

  return {
    active: Boolean(data),
    createdAt: data?.created_at || null,
  };
};

export const getSubscriptionAccessStatus = async (
  userId: string,
): Promise<SubscriptionAccessStatus> => {
  const client = getSupabaseAdminClient();
  const testAccount = await isPremiumTestAccount(userId);

  if (testAccount.active) {
    return {
      active: true,
      state: "active",
      status: "active",
      source: "server",
      productId: null,
      expiresAt: null,
      verifiedAt: testAccount.createdAt,
      reconciliationRecommended: false,
    };
  }

  const { data, error } = await client
    .from("subscription_entitlements")
    .select("status, platform, product_id, expiry_time, verified_at")
    .eq("user_id", userId)
    .order("verified_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("Subscription access check failed:", error.message);
    throw new HttpError("Premium verification is temporarily unavailable.", 503);
  }

  const now = Date.now();
  const entitlement = (data || []).find((row) => {
    if (row.status !== "active" && row.status !== "grace_period" && row.status !== "canceled") return false;
    if (!row.expiry_time) return false;
    const expiry = Date.parse(row.expiry_time);
    return Number.isFinite(expiry) && expiry > now;
  });

  const latest = entitlement || data?.[0] || null;
  const activeStatus = entitlement?.status === "canceled"
    ? "canceled_until_expiry"
    : entitlement?.status || "none";
  const inactiveStatus = latest ? "expired" : "none";
  const active = Boolean(entitlement);

  return {
    active,
    state: active ? "active" : "inactive",
    status: active ? activeStatus : inactiveStatus,
    source: latest?.platform === "android" ? "google_play" : latest ? "server" : "none",
    productId: latest?.product_id || null,
    expiresAt: entitlement?.expiry_time || null,
    verifiedAt: latest?.verified_at || null,
    reconciliationRecommended: !active,
  };
};

export const acquireVoiceSessionLease = async (
  userId: string,
  maxMinutes: number,
  dailyMinutes = 20,
  monthlyMinutes = 180,
  resetOffsetMinutes = 330,
  handleHash = "",
) => {
  const client = getSupabaseAdminClient();
  const params = {
    p_user_id: userId,
    p_max_minutes: maxMinutes,
    p_daily_minutes: dailyMinutes,
    p_monthly_minutes: monthlyMinutes,
    p_reset_offset_minutes: resetOffsetMinutes,
    p_handle_hash: handleHash,
  };
  const { data, error } = await client.rpc("acquire_voice_session_lease", params);
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("premium subscription")) {
      throw new HttpError("An active premium subscription is required for Voice mode.", 403);
    }
    if (message.includes("already active")) {
      throw new HttpError("A Voice session is already active for this account.", 409);
    }
    if (message.includes("daily voice allowance")) {
      throw new HttpError("Your daily Voice allowance has been reached.", 429);
    }
    if (message.includes("monthly voice allowance")) {
      throw new HttpError("Your monthly Voice allowance has been reached.", 429);
    }
    console.error("Voice lease acquisition failed:", error.message);
    throw new HttpError("Voice session protection is temporarily unavailable.", 503);
  }
  const result = Array.isArray(data) ? data[0] : data;
  const reservedMinutes = Number(result?.leased_minutes);
  if (
    !result?.lease_id ||
    !result?.lease_expires_at ||
    !Number.isInteger(reservedMinutes) || reservedMinutes < 1 || reservedMinutes > maxMinutes
  ) {
    throw new HttpError("Voice session protection is temporarily unavailable.", 503);
  }
  return {
    leaseId: String(result.lease_id),
    expiresAt: String(result.lease_expires_at),
    reservedMinutes,
  };
};

export const createVoiceReservationHandle = () => {
  const handle = randomBytes(32).toString("base64url");
  return { handle, handleHash: hashVoiceReservationHandle(handle) };
};

export const hashVoiceReservationHandle = (handle: string | null | undefined) => {
  if (!handle || handle.length < 32 || handle.length > 128) return null;
  return createHash("sha256").update(handle).digest("hex");
};

export const getVoiceUsageLimits = (maxMinutes: number) => {
  const configuredMonthlyMinutes = Number(process.env.VOICE_MONTHLY_MAX_MINUTES || 180);
  const configuredOffset = Number(process.env.VOICE_DAILY_RESET_OFFSET_MINUTES || 330);
  const monthlyMinutes = Number.isFinite(configuredMonthlyMinutes)
    ? Math.max(maxMinutes, Math.min(1_440, Math.floor(configuredMonthlyMinutes)))
    : Math.max(maxMinutes, 180);

  // Keep the legacy RPC parameter populated, but mirror the monthly budget so
  // it cannot create a separate daily cap. The database migration ignores the
  // legacy daily bucket and enforces only the monthly allowance.
  const dailyMinutes = monthlyMinutes;
  return {
    dailyMinutes,
    monthlyMinutes,
    resetOffsetMinutes: Number.isFinite(configuredOffset)
      ? Math.max(-720, Math.min(840, Math.trunc(configuredOffset)))
      : 330,
  };
};

export type VoiceAvailability = {
  eligible: boolean;
  available: boolean;
  reason:
    | "available"
    | "subscription_required"
    | "session_active"
    | "daily_limit"
    | "monthly_limit"
    | "reservation_resume";
  retryAfterSeconds: number | null;
  canRenew: boolean;
  usage: VoiceUsageSummary | null;
};

export const getVoiceSessionAvailability = async (
  userId: string,
  maxMinutes: number,
  dailyMinutes: number,
  monthlyMinutes: number,
  resetOffsetMinutes: number,
  handleHash: string | null,
): Promise<VoiceAvailability> => {
  const client = getSupabaseAdminClient();
  const params = {
    p_user_id: userId,
    p_max_minutes: maxMinutes,
    p_daily_minutes: dailyMinutes,
    p_monthly_minutes: monthlyMinutes,
    p_reset_offset_minutes: resetOffsetMinutes,
    p_handle_hash: handleHash,
  };
  const { data, error } = await client.rpc("get_voice_session_availability", params);
  if (error) {
    console.error("Voice availability check failed:", error.message);
    throw new HttpError("Voice eligibility is temporarily unavailable.", 503);
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || typeof result.reason !== "string") {
    throw new HttpError("Voice eligibility is temporarily unavailable.", 503);
  }
  const monthlyLimitMinutes = Number(result.monthly_limit_minutes);
  const monthlyUsedMinutes = Number(result.monthly_used_minutes);
  const monthlyRemainingMinutes = Number(result.monthly_remaining_minutes);
  const monthlyResetAt = typeof result.monthly_reset_at === "string"
    && Number.isFinite(Date.parse(result.monthly_reset_at))
    ? result.monthly_reset_at
    : null;
  const usage = Number.isFinite(monthlyLimitMinutes)
    && monthlyLimitMinutes > 0
    && Number.isFinite(monthlyUsedMinutes)
    && monthlyUsedMinutes >= 0
    && Number.isFinite(monthlyRemainingMinutes)
    && monthlyRemainingMinutes >= 0
    ? {
        monthlyLimitMinutes: Math.floor(monthlyLimitMinutes),
        monthlyUsedMinutes: Math.floor(monthlyUsedMinutes),
        monthlyRemainingMinutes: Math.floor(monthlyRemainingMinutes),
        monthlyResetAt,
      }
    : null;
  return {
    eligible: Boolean(result.eligible),
    available: Boolean(result.available),
    reason: result.reason as VoiceAvailability["reason"],
    retryAfterSeconds: result.retry_after_seconds === null
      ? null
      : Math.max(1, Number(result.retry_after_seconds)),
    canRenew: Boolean(result.can_renew),
    usage,
  };
};

export const releaseVoiceSessionLease = async (userId: string, handleHash: string) => {
  const client = getSupabaseAdminClient();
  const { data, error } = await client.rpc("release_voice_session_lease", {
    p_user_id: userId,
    p_handle_hash: handleHash,
  });
  if (error) throw new HttpError("Voice session release failed.", 503);
  return data === true || (Array.isArray(data) && data[0] === true);
};

export const getServerShadowNotes = async (userId: string) => {
  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("user_shadow_notes")
    .select("notes")
    .eq("user_id", userId)
    .limit(1);
  if (error) {
    console.error("Voice context lookup failed:", error.message);
    throw new HttpError("Voice context is temporarily unavailable.", 503);
  }
  const notes = Array.isArray(data) ? data[0]?.notes : null;
  return normalizeShadowNotes(typeof notes === "string" ? notes : null) || "";
};

export const getRateLimitStorageKey = (key: string) => {
  if (!key.includes(":user:")) {
    throw new HttpError("Account-based rate limiting requires a user-scoped key.", 503);
  }
  return key;
};

export const enforceRateLimits = async (rules: RateLimitRule[], windowMs = RATE_WINDOW_MS) => {
  if (!rules.length) return;
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  const client = getSupabaseAdminClient();

  const validatedRules = rules.map((rule) => {
    if (!Number.isInteger(rule.limit) || rule.limit < 1) {
      throw new HttpError("Rate limiting is misconfigured on the server.", 503);
    }
    return rule;
  });

  const { data, error } = await client.rpc("check_rate_limits", {
    p_rules: validatedRules.map((rule) => ({
      key: getRateLimitStorageKey(rule.key),
      limit: rule.limit,
      window_seconds: windowSeconds,
    })),
  });

  if (error) {
    if (error.message.toLowerCase().includes("jwt issued at future")) {
      console.error("Persistent rate-limit check rejected the server Supabase credential timestamp.");
    }
    console.error("Persistent rate-limit check failed:", error.message);
    throw new HttpError("Rate limiting is temporarily unavailable. Please try again shortly.", 503);
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result || typeof result.allowed !== "boolean") {
    console.error("Persistent rate-limit check returned an invalid result.");
    throw new HttpError("Rate limiting is temporarily unavailable. Please try again shortly.", 503);
  }

  if (!result.allowed) {
    throw new HttpError(
      "Too many requests. Please try again shortly.",
      429,
      Math.max(1, Number(result.retry_after_seconds || 1)),
    );
  }
};

const parsePositiveInteger = (value: string | undefined, fallback: number, maximum: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(parsed)));
};

export const getVoiceRateLimit = (environmentKey: string) =>
  parsePositiveInteger(
    process.env[environmentKey],
    DEFAULT_VOICE_RATE_LIMIT,
    600,
  );

export const getVoiceRateLimitWindowMs = () =>
  parsePositiveInteger(
    process.env.VOICE_RATE_LIMIT_WINDOW_SECONDS,
    DEFAULT_VOICE_RATE_LIMIT_WINDOW_SECONDS,
    60 * 60,
  ) * 1_000;

export const formatServerTiming = (timings: Record<string, number | undefined>) =>
  Object.entries(timings)
    .filter(([, duration]) => typeof duration === "number" && Number.isFinite(duration))
    .map(([name, duration]) => `${name};dur=${Math.max(0, Math.round(duration!))}`)
    .join(", ");

export const assertStringLength = (value: unknown, maxLength: number, label: string) => {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new HttpError(`${label} is invalid or too long.`, 413);
  }
};

export const getHttpErrorDetails = (error: unknown) => {
  if (error instanceof HttpError) {
    return {
      statusCode: error.statusCode,
      message: error.message,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }

  return { statusCode: 500, message: error instanceof Error ? error.message : String(error) };
};
