import { createClient } from "@supabase/supabase-js";

type RequestLike = {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
  connection?: { remoteAddress?: string };
};

type RateLimitRule = {
  key: string;
  limit: number;
};

type RateBucket = {
  count: number;
  resetAt: number;
};

const RATE_WINDOW_MS = 10 * 60 * 1000;
const rateBuckets = new Map<string, RateBucket>();

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

export const requireAuthenticatedRequest = async (req: RequestLike) => {
  const authorization = getHeader(req, "authorization")?.trim();
  const accessToken = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    throw new HttpError("Authentication is required.", 401);
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes("placeholder.supabase.co")) {
    throw new HttpError("Authentication is not configured on the server.", 503);
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
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

const pruneRateBuckets = (now: number) => {
  if (rateBuckets.size < 10_000) return;
  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) rateBuckets.delete(key);
  }
};

export const enforceRateLimits = (rules: RateLimitRule[], windowMs = RATE_WINDOW_MS) => {
  const now = Date.now();
  pruneRateBuckets(now);

  for (const rule of rules) {
    const existing = rateBuckets.get(rule.key);
    if (!existing || existing.resetAt <= now) {
      rateBuckets.set(rule.key, { count: 1, resetAt: now + windowMs });
      continue;
    }

    if (existing.count >= rule.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      throw new HttpError("Too many requests. Please try again shortly.", 429, retryAfterSeconds);
    }

    existing.count += 1;
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
