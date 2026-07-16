import { createHash } from "node:crypto";
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

export const getRateLimitStorageKey = (key: string) => {
  if (!key.includes(":ip:")) return key;
  const salt = process.env.RATE_LIMIT_IP_SALT;
  if (!salt) {
    throw new HttpError("Rate limiting is not configured on the server.", 503);
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
