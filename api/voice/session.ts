import { createHash } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import {
  GEMINI_LIVE_API_VERSION,
  GEMINI_LIVE_MODEL,
  getGeminiLiveConnectConfig,
  hasGeminiLiveConfig,
} from "../../gemini-live-config.js";
import {
  acquireVoiceSessionLease,
  createVoiceReservationHandle,
  enforceRateLimits,
  getHttpErrorDetails,
  getVoiceSessionAvailability,
  getVoiceUsageLimits,
  hashVoiceReservationHandle,
  releaseVoiceSessionLease,
  requireAuthenticatedRequest,
} from "../../server-security.js";
import { getVoiceSessionConfig } from "../../voice-config.js";

const MIN_RECOVERY_REMAINING_SECONDS = 2 * 60;
const LIVE_TOKEN_NEW_SESSION_WINDOW_MS = 60_000;
const LIVE_TOKEN_EXPIRY_MARGIN_MS = 60_000;
const RELEASE_REASONS = new Set([
  "user_exit",
  "user_end",
  "session_expired",
  "idle_timeout",
  "component_unmount",
  "logout",
  "subscription_lost",
  "fatal_error",
  "stale_recovery",
]);

const setCorsHeaders = (res: any) => {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader?.(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Client-Request-Id",
  );
};

const getBody = (req: any) => {
  if (typeof req.body === "string") {
    try {
      const parsed = req.body ? JSON.parse(req.body) : null;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? { body: parsed as Record<string, unknown>, invalid: false }
        : { body: null, invalid: true };
    } catch {
      return { body: null, invalid: true };
    }
  }
  return req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? { body: req.body as Record<string, unknown>, invalid: false }
    : { body: null, invalid: true };
};

const reasonForStatus = (statusCode: number, message: string) => {
  if (statusCode === 403) return "subscription_required";
  if (statusCode === 409) return "session_active";
  if (statusCode === 429 && message.toLowerCase().includes("monthly")) return "monthly_limit";
  if (statusCode === 429 && message.toLowerCase().includes("daily")) return "daily_limit";
  return "connection_failed";
};

const hashUserId = (userId: string) =>
  createHash("sha256").update(userId).digest("hex").slice(0, 12);

export default async function handler(req: any, res: any) {
  const requestId = String(req.headers?.["x-client-request-id"] || "").slice(0, 80);
  const startedAt = Date.now();
  setCorsHeaders(res);
  res.setHeader?.("Cache-Control", "private, no-store");
  if (requestId) res.setHeader?.("X-Client-Request-Id", requestId);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  let action = "unknown";
  let mode = "none";
  let userHash = "unverified";

  try {
    const { userId, ip } = await requireAuthenticatedRequest(req);
    userHash = hashUserId(userId);
    await enforceRateLimits([
      { key: `voice-session:user:${userId}`, limit: 20 },
      { key: `voice-session:ip:${ip}`, limit: 40 },
    ]);

    const parsed = getBody(req);
    if (parsed.invalid || !parsed.body) {
      return res.status(400).json({ error: "Voice request must contain a valid JSON object." });
    }
    const body = parsed.body;
    if (body.action !== "start" && body.action !== "release" && body.action !== "live-token") {
      return res.status(400).json({ error: "Voice request action is invalid." });
    }
    action = body.action;
    const reservationHandle = typeof body.reservationHandle === "string" ? body.reservationHandle : "";

    if (action === "release") {
      const handleHash = hashVoiceReservationHandle(reservationHandle);
      if (!handleHash) {
        return res.status(400).json({ error: "This Voice reservation is invalid." });
      }
      if (body.releaseReason !== undefined && (
        typeof body.releaseReason !== "string" || !RELEASE_REASONS.has(body.releaseReason)
      )) {
        return res.status(400).json({ error: "Voice release reason is invalid." });
      }
      const releaseReason = body.releaseReason || "user_end";
      const released = await releaseVoiceSessionLease(userId, handleHash);
      console.info("[voice/session] released", {
        requestId: requestId || "server-generated",
        userHash,
        releaseReason,
        released,
        durationMs: Date.now() - startedAt,
      });
      return res.status(204).end();
    }

    if (action === "live-token") {
      await enforceRateLimits([
        { key: `voice-live-token:user:${userId}`, limit: 12 },
        { key: `voice-live-token:ip:${ip}`, limit: 24 },
      ]);
      if (!hasGeminiLiveConfig()) {
        return res.status(503).json({ error: "Voice streaming is not configured." });
      }
      const handleHash = hashVoiceReservationHandle(reservationHandle);
      if (!handleHash) {
        return res.status(400).json({ error: "This Voice reservation is invalid." });
      }
      const { maxMinutes } = getVoiceSessionConfig();
      const { dailyMinutes, monthlyMinutes, resetOffsetMinutes } = getVoiceUsageLimits(maxMinutes);
      const availability = await getVoiceSessionAvailability(
        userId,
        maxMinutes,
        dailyMinutes,
        monthlyMinutes,
        resetOffsetMinutes,
        handleHash,
      );
      if (!availability.eligible) {
        return res.status(403).json({
          error: "An active premium subscription is required for Voice mode.",
          reason: "subscription_required",
        });
      }
      if (
        availability.reason !== "reservation_resume" ||
        !availability.retryAfterSeconds ||
        availability.retryAfterSeconds < 10
      ) {
        return res.status(409).json({
          error: "This Voice reservation is no longer active.",
          reason: "reservation_invalid",
        });
      }
      const now = Date.now();
      const reservationExpiresAt = new Date(now + availability.retryAfterSeconds * 1_000).toISOString();
      const expiresAt = new Date(
        now + availability.retryAfterSeconds * 1_000 + LIVE_TOKEN_EXPIRY_MARGIN_MS,
      ).toISOString();
      const newSessionExpiresAt = new Date(now + LIVE_TOKEN_NEW_SESSION_WINDOW_MS).toISOString();
      const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!.trim() });
      const token = await client.authTokens.create({
        config: {
          httpOptions: { apiVersion: GEMINI_LIVE_API_VERSION },
          uses: 1,
          expireTime: expiresAt,
          newSessionExpireTime: newSessionExpiresAt,
          liveConnectConstraints: {
            model: GEMINI_LIVE_MODEL,
            config: getGeminiLiveConnectConfig(),
          },
        },
      });
      if (!token.name) throw new Error("Gemini returned an empty ephemeral token.");
      console.info("[voice/session] live token created", {
        requestId: requestId || "server-generated",
        userHash,
        reservationValidated: true,
        durationMs: Date.now() - startedAt,
      });
      return res.status(200).json({ token: token.name, expiresAt, newSessionExpiresAt, reservationExpiresAt });
    }

    if (body.mode !== undefined && body.mode !== "fresh_start" && body.mode !== "recovery_resume") {
      return res.status(400).json({ error: "Voice session mode is invalid." });
    }
    const requestedMode =
      body.mode === "fresh_start" || body.mode === "recovery_resume"
        ? body.mode
        : null;
    mode = requestedMode || "fresh_start";

    let nextReservationHandle = reservationHandle;
    let handleHash = hashVoiceReservationHandle(nextReservationHandle);
    if (!handleHash) {
      const created = createVoiceReservationHandle();
      nextReservationHandle = created.handle;
      handleHash = created.handleHash;
    }

    if (!requestedMode) {
      // APKs built before explicit modes sent a saved handle on every tap.
      // End that lease and mint a different one instead of silently resuming it.
      await releaseVoiceSessionLease(userId, handleHash);
      const created = createVoiceReservationHandle();
      nextReservationHandle = created.handle;
      handleHash = created.handleHash;
    } else if (mode === "fresh_start") {
      const previousHandleHash = hashVoiceReservationHandle(
        typeof body.previousReservationHandle === "string" ? body.previousReservationHandle : "",
      );
      if (previousHandleHash && previousHandleHash === handleHash) {
        return res.status(400).json({
          error: "A fresh Voice reflection requires a new reservation.",
          reason: "connection_failed",
        });
      }
      if (previousHandleHash) {
        await releaseVoiceSessionLease(userId, previousHandleHash);
      }
    }

    const { maxMinutes, idleTimeoutSeconds } = getVoiceSessionConfig();
    const { dailyMinutes, monthlyMinutes, resetOffsetMinutes } = getVoiceUsageLimits(maxMinutes);
    const availability = await getVoiceSessionAvailability(
      userId,
      maxMinutes,
      dailyMinutes,
      monthlyMinutes,
      resetOffsetMinutes,
      mode === "recovery_resume" ? handleHash : null,
    );

    if (
      mode === "recovery_resume" &&
      availability.reason === "reservation_resume" &&
      availability.retryAfterSeconds &&
      availability.retryAfterSeconds >= MIN_RECOVERY_REMAINING_SECONDS
    ) {
      console.info("[voice/session] recovery resumed", {
        requestId: requestId || "server-generated",
        userHash,
        mode,
        remainingSeconds: availability.retryAfterSeconds,
        durationMs: Date.now() - startedAt,
      });
      return res.status(200).json({
        reservationHandle: nextReservationHandle,
        reservationExpiresAt: new Date(
          Date.now() + availability.retryAfterSeconds * 1_000,
        ).toISOString(),
        remainingSeconds: availability.retryAfterSeconds,
        resumed: true,
        usage: availability.usage,
        idleTimeoutSeconds,
      });
    }

    if (!availability.eligible) {
      return res.status(403).json({
        error: "An active premium subscription is required for Voice mode.",
        reason: "subscription_required",
      });
    }

    if (mode === "recovery_resume") {
      const activeElsewhere = availability.reason === "session_active";
      console.info("[voice/session] recovery rejected", {
        requestId: requestId || "server-generated",
        userHash,
        mode,
        eligibilityResult: availability.reason,
        remainingSeconds: availability.retryAfterSeconds,
        durationMs: Date.now() - startedAt,
      });
      return res.status(activeElsewhere ? 409 : 410).json({
        error: activeElsewhere
          ? "Another Voice session is active for this account."
          : "This interrupted Voice reflection can no longer be resumed.",
        reason: activeElsewhere ? "session_active" : "recovery_unavailable",
        retryAfterSeconds: availability.retryAfterSeconds,
      });
    }

    if (!availability.available) {
      const usageLimitReached =
        availability.reason === "daily_limit" || availability.reason === "monthly_limit";
      const status = usageLimitReached ? 429 : 409;
      if (availability.retryAfterSeconds) {
        res.setHeader?.("Retry-After", String(availability.retryAfterSeconds));
      }
      return res.status(status).json({
        error:
          availability.reason === "monthly_limit"
            ? "Your monthly Voice allowance has been reached."
            : availability.reason === "daily_limit"
            ? "Your daily Voice allowance has been reached."
            : "A Voice session is already active for this account.",
        reason: availability.reason,
        retryAfterSeconds: availability.retryAfterSeconds,
        usage: availability.usage,
      });
    }

    const lease = await acquireVoiceSessionLease(
      userId,
      maxMinutes,
      dailyMinutes,
      monthlyMinutes,
      resetOffsetMinutes,
      handleHash,
    );
    const remainingSeconds = Math.max(
      0,
      Math.floor((Date.parse(lease.expiresAt) - Date.now()) / 1_000),
    );
    const usageAfterReservation = availability.usage
      ? {
          ...availability.usage,
          monthlyUsedMinutes: Math.min(
            availability.usage.monthlyLimitMinutes,
            availability.usage.monthlyUsedMinutes + lease.reservedMinutes,
          ),
          monthlyRemainingMinutes: Math.max(
            0,
            availability.usage.monthlyRemainingMinutes - lease.reservedMinutes,
          ),
        }
      : null;
    console.info("[voice/session] fresh lease acquired", {
      requestId: requestId || "server-generated",
      userHash,
      mode,
      eligibilityResult: availability.reason,
      remainingSeconds,
      durationMs: Date.now() - startedAt,
    });
    return res.status(200).json({
      reservationHandle: nextReservationHandle,
      reservationExpiresAt: lease.expiresAt,
      remainingSeconds,
      resumed: false,
      usage: usageAfterReservation,
      idleTimeoutSeconds,
    });
  } catch (error) {
    const details = getHttpErrorDetails(error);
    console.error("[voice/session] failed", {
      requestId: requestId || "server-generated",
      userHash,
      action,
      mode,
      durationMs: Date.now() - startedAt,
      reason: details.message.slice(0, 240),
    });
    if (details.retryAfterSeconds) {
      res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
    }
    return res.status(details.statusCode).json({
      error:
        details.statusCode === 500
          ? "Voice session protection is temporarily unavailable."
          : details.message,
      reason: reasonForStatus(details.statusCode, details.message),
    });
  }
}
