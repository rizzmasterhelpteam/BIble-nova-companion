import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizeShadowNotes } from "./src/lib/shadowMemory.js";
import type { VoiceUsageSummary } from "./src/types/live.js";

type RequestLike = {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
  connection?: { remoteAddress?: string };
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

export const getClientIp = (req: RequestLike) => {
  const forwarded = getHeader(req, "x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || "unknown";
};

const getSupabaseServerConfig = () => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey || url.includes("placeholder.supabase.co")) {
    throw new HttpError("Authentication is not configured on the server.", 503);
  }
  return { url, anonKey };
};

export const getSupabaseAdminClient = (): SupabaseClient => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
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
        ip: getClientIp(req),
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
    ip: getClientIp(req),
  };
};

export type SubscriptionAccessStatus = {
  active: boolean;
  expiresAt: string | null;
};

export const getSubscriptionAccessStatus = async (
  userId: string,
): Promise<SubscriptionAccessStatus> => {
  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("subscription_entitlements")
    .select("status, expiry_time, verified_at")
    .eq("user_id", userId)
    .in("status", ["active", "grace_period"])
    .order("verified_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("Subscription access check failed:", error.message);
    throw new HttpError("Premium verification is temporarily unavailable.", 503);
  }

  const now = Date.now();
  const entitlement = (data || []).find((row) => {
    if (row.status !== "active" && row.status !== "grace_period") return false;
    if (!row.expiry_time) return true;
    const expiry = Date.parse(row.expiry_time);
    return Number.isFinite(expiry) && expiry > now;
  });

  return {
    active: Boolean(entitlement),
    expiresAt: entitlement?.expiry_time || null,
  };
};

const isMissingVoiceRpcSignature = (error: { message?: string } | null) =>
  Boolean(error?.message && /could not find the function .*voice_session_/i.test(error.message));

export const acquireVoiceSessionLease = async (
  userId: string,
  maxMinutes: number,
  dailyMinutes = 20,
  monthlyMinutes = 180,
  resetOffsetMinutes = 330,
  handleHash = "",
  allowPaymentBypass = false,
) => {
  const client = getSupabaseAdminClient();
  const params = {
    p_user_id: userId,
    p_max_minutes: maxMinutes,
    p_daily_minutes: dailyMinutes,
    p_monthly_minutes: monthlyMinutes,
    p_reset_offset_minutes: resetOffsetMinutes,
    p_handle_hash: handleHash,
    ...(allowPaymentBypass ? { p_allow_payment_bypass: true } : {}),
  };
  let { data, error } = await client.rpc("acquire_voice_session_lease", params);
  let usedLegacyRpc = false;
  if (!allowPaymentBypass && isMissingVoiceRpcSignature(error)) {
    usedLegacyRpc = true;
    ({ data, error } = await client.rpc("acquire_voice_session_lease", {
      p_user_id: userId,
      p_max_minutes: maxMinutes,
      p_daily_minutes: dailyMinutes,
      p_reset_offset_minutes: resetOffsetMinutes,
      p_handle_hash: handleHash,
    }));
  }
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
    (!usedLegacyRpc && (!Number.isInteger(reservedMinutes) || reservedMinutes < 1 || reservedMinutes > maxMinutes))
  ) {
    throw new HttpError("Voice session protection is temporarily unavailable.", 503);
  }
  return {
    leaseId: String(result.lease_id),
    expiresAt: String(result.lease_expires_at),
    reservedMinutes: usedLegacyRpc ? maxMinutes : reservedMinutes,
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
  const configuredDailyMinutes = Number(process.env.VOICE_DAILY_MAX_MINUTES || 20);
  const configuredMonthlyMinutes = Number(process.env.VOICE_MONTHLY_MAX_MINUTES || 180);
  const configuredOffset = Number(process.env.VOICE_DAILY_RESET_OFFSET_MINUTES || 330);
  const dailyMinutes = Number.isFinite(configuredDailyMinutes)
    ? Math.max(maxMinutes, Math.min(240, Math.floor(configuredDailyMinutes)))
    : 20;
  return {
    dailyMinutes,
    monthlyMinutes: Number.isFinite(configuredMonthlyMinutes)
      ? Math.max(dailyMinutes, Math.min(1_440, Math.floor(configuredMonthlyMinutes)))
      : Math.max(dailyMinutes, 180),
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
  allowPaymentBypass = false,
): Promise<VoiceAvailability> => {
  const client = getSupabaseAdminClient();
  const params = {
    p_user_id: userId,
    p_max_minutes: maxMinutes,
    p_daily_minutes: dailyMinutes,
    p_monthly_minutes: monthlyMinutes,
    p_reset_offset_minutes: resetOffsetMinutes,
    p_handle_hash: handleHash,
    ...(allowPaymentBypass ? { p_allow_payment_bypass: true } : {}),
  };
  let { data, error } = await client.rpc("get_voice_session_availability", params);
  if (!allowPaymentBypass && isMissingVoiceRpcSignature(error)) {
    ({ data, error } = await client.rpc("get_voice_session_availability", {
      p_user_id: userId,
      p_max_minutes: maxMinutes,
      p_daily_minutes: dailyMinutes,
      p_reset_offset_minutes: resetOffsetMinutes,
      p_handle_hash: handleHash,
    }));
  }
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
  if (!key.includes(":ip:")) return key;
  // A dedicated salt is preferred, but the persistent limiter already
  // requires the server-only service role. Falling back to it keeps IP keys
  // non-reversible and prevents a missing optional env var from blocking
  // critical authenticated flows such as subscription linking.
  const salt = process.env.RATE_LIMIT_IP_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!salt) {
    throw new HttpError("Rate limiting requires server persistence configuration.", 503);
  }
  return `${key.slice(0, key.indexOf(":ip:") + 4)}${createHash("sha256")
    .update(`${salt}:${key.slice(key.indexOf(":ip:") + 4)}`)
    .digest("hex")}`;
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

  const checks = await Promise.all(validatedRules.map(async (rule) => {
    const { data, error } = await client.rpc("check_rate_limit", {
      p_key: getRateLimitStorageKey(rule.key),
      p_limit: rule.limit,
      p_window_seconds: windowSeconds,
    });
    return { data, error };
  }));

  const failedCheck = checks.find((check) => check.error);
  if (failedCheck?.error) {
    console.error("Persistent rate-limit check failed:", failedCheck.error.message);
    throw new HttpError("Rate limiting is temporarily unavailable. Please try again shortly.", 503);
  }

  const deniedResult = checks
    .map((check) => Array.isArray(check.data) ? check.data[0] : check.data)
    .find((result) => !result?.allowed);
  if (deniedResult) {
    throw new HttpError(
      "Too many requests. Please try again shortly.",
      429,
      Math.max(1, Number(deniedResult.retry_after_seconds || 1)),
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
