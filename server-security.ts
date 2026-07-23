import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
};

export const requireAuthenticatedRequest = async (req: RequestLike) => {
  const authorization = getHeader(req, "authorization")?.trim();
  const accessToken = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    throw new HttpError("Authentication is required.", 401);
  }

  const { url, anonKey } = getSupabaseServerConfig();
  const authClient = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
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

export const acquireVoiceSessionLease = async (
  userId: string,
  maxMinutes: number,
  dailyMinutes = 60,
  resetOffsetMinutes = 330,
  handleHash = "",
) => {
  const client = getSupabaseAdminClient();
  const { data, error } = await client.rpc("acquire_voice_session_lease", {
    p_user_id: userId,
    p_max_minutes: maxMinutes,
    p_daily_minutes: dailyMinutes,
    p_reset_offset_minutes: resetOffsetMinutes,
    p_handle_hash: handleHash,
  });
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
    console.error("Voice lease acquisition failed:", error.message);
    throw new HttpError("Voice session protection is temporarily unavailable.", 503);
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.lease_id || !result?.lease_expires_at) {
    throw new HttpError("Voice session protection is temporarily unavailable.", 503);
  }
  return {
    leaseId: String(result.lease_id),
    expiresAt: String(result.lease_expires_at),
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
  const configuredDailyMinutes = Number(process.env.VOICE_DAILY_MAX_MINUTES || 60);
  const configuredOffset = Number(process.env.VOICE_DAILY_RESET_OFFSET_MINUTES || 330);
  return {
    dailyMinutes: Number.isFinite(configuredDailyMinutes)
      ? Math.max(maxMinutes, Math.min(240, Math.floor(configuredDailyMinutes)))
      : 60,
    resetOffsetMinutes: Number.isFinite(configuredOffset)
      ? Math.max(-720, Math.min(840, Math.trunc(configuredOffset)))
      : 330,
  };
};

export type VoiceAvailability = {
  eligible: boolean;
  available: boolean;
  reason: "available" | "subscription_required" | "session_active" | "daily_limit" | "reservation_resume";
  retryAfterSeconds: number | null;
  canRenew: boolean;
};

export const getVoiceSessionAvailability = async (
  userId: string,
  maxMinutes: number,
  dailyMinutes: number,
  resetOffsetMinutes: number,
  handleHash: string | null,
): Promise<VoiceAvailability> => {
  const client = getSupabaseAdminClient();
  const { data, error } = await client.rpc("get_voice_session_availability", {
    p_user_id: userId,
    p_max_minutes: maxMinutes,
    p_daily_minutes: dailyMinutes,
    p_reset_offset_minutes: resetOffsetMinutes,
    p_handle_hash: handleHash,
  });
  if (error) {
    console.error("Voice availability check failed:", error.message);
    throw new HttpError("Voice eligibility is temporarily unavailable.", 503);
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (!result || typeof result.reason !== "string") {
    throw new HttpError("Voice eligibility is temporarily unavailable.", 503);
  }
  return {
    eligible: Boolean(result.eligible),
    available: Boolean(result.available),
    reason: result.reason as VoiceAvailability["reason"],
    retryAfterSeconds: result.retry_after_seconds === null
      ? null
      : Math.max(1, Number(result.retry_after_seconds)),
    canRenew: Boolean(result.can_renew),
  };
};

export const claimVoiceSessionRenewal = async (userId: string, handleHash: string) => {
  const client = getSupabaseAdminClient();
  const claimHash = randomBytes(32).toString("hex");
  const { data, error } = await client.rpc("claim_voice_session_renewal", {
    p_user_id: userId,
    p_handle_hash: handleHash,
    p_claim_hash: claimHash,
  });
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("renewal limit") || message.includes("reservation unavailable")) {
      throw new HttpError("This Voice reservation cannot be renewed.", 409);
    }
    console.error("Voice renewal claim failed:", error.message);
    throw new HttpError("Voice reconnection is temporarily unavailable.", 503);
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.lease_id || !result?.lease_expires_at) {
    throw new HttpError("This Voice reservation cannot be renewed.", 409);
  }
  return {
    leaseId: String(result.lease_id),
    expiresAt: String(result.lease_expires_at),
    claimHash,
  };
};

export const finalizeVoiceSessionRenewal = async (userId: string, claimHash: string) => {
  const client = getSupabaseAdminClient();
  const { error } = await client.rpc("finalize_voice_session_renewal", {
    p_user_id: userId,
    p_claim_hash: claimHash,
  });
  if (error) console.error("Voice renewal finalization failed:", error.message);
};

export const rollbackVoiceSessionRenewal = async (userId: string, claimHash: string) => {
  const client = getSupabaseAdminClient();
  const { error } = await client.rpc("rollback_voice_session_renewal", {
    p_user_id: userId,
    p_claim_hash: claimHash,
  });
  if (error) console.error("Voice renewal rollback failed:", error.message);
};

export const cancelUnstartedVoiceSessionLease = async (userId: string, leaseId: string) => {
  const client = getSupabaseAdminClient();
  const { error } = await client.rpc("cancel_unstarted_voice_session_lease", {
    p_user_id: userId,
    p_lease_id: leaseId,
  });
  if (error) console.error("Unstarted Voice lease cancellation failed:", error.message);
};

export const getServerShadowNotes = async (userId: string) => {
  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from("user_shadow_notes")
    .select("notes")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("Voice context lookup failed:", error.message);
    throw new HttpError("Voice context is temporarily unavailable.", 503);
  }
  return typeof data?.notes === "string" ? data.notes.trim().slice(0, 1_500) : "";
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

  for (const rule of rules) {
    if (!Number.isInteger(rule.limit) || rule.limit < 1) {
      throw new HttpError("Rate limiting is misconfigured on the server.", 503);
    }

    const { data, error } = await client.rpc("check_rate_limit", {
      p_key: getRateLimitStorageKey(rule.key),
      p_limit: rule.limit,
      p_window_seconds: windowSeconds,
    });

    if (error) {
      console.error("Persistent rate-limit check failed:", error.message);
      throw new HttpError("Rate limiting is temporarily unavailable. Please try again shortly.", 503);
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.allowed) {
      throw new HttpError(
        "Too many requests. Please try again shortly.",
        429,
        Math.max(1, Number(result?.retry_after_seconds || 1)),
      );
    }
  }
};

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
