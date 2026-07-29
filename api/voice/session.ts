import { createHash } from "node:crypto";
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
const RELEASE_REASONS = new Set([
  "user_exit",
  "user_end",
  "session_expired",
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
      return req.body ? JSON.parse(req.body) : {};
    } catch {
      return {};
    }
  }
  return req.body || {};
};

const reasonForStatus = (statusCode: number, message: string) => {
  if (statusCode === 403) return "subscription_required";
  if (statusCode === 409) return "session_active";
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

    const body = getBody(req);
    action = body.action === "release" ? "release" : "start";
    if (action === "release") {
      const handleHash = hashVoiceReservationHandle(body.reservationHandle);
      if (!handleHash) {
        return res.status(400).json({ error: "This Voice reservation is invalid." });
      }
      const releaseReason = RELEASE_REASONS.has(body.releaseReason)
        ? body.releaseReason
        : "user_end";
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

    const requestedMode =
      body.mode === "fresh_start" || body.mode === "recovery_resume"
        ? body.mode
        : null;
    mode = requestedMode || "fresh_start";

    let reservationHandle =
      typeof body.reservationHandle === "string" ? body.reservationHandle : "";
    let handleHash = hashVoiceReservationHandle(reservationHandle);
    if (!handleHash) {
      const created = createVoiceReservationHandle();
      reservationHandle = created.handle;
      handleHash = created.handleHash;
    }

    if (!requestedMode) {
      // APKs built before explicit modes sent a saved handle on every tap.
      // End that lease and mint a different one instead of silently resuming it.
      await releaseVoiceSessionLease(userId, handleHash);
      const created = createVoiceReservationHandle();
      reservationHandle = created.handle;
      handleHash = created.handleHash;
    } else if (mode === "fresh_start") {
      const previousHandleHash = hashVoiceReservationHandle(body.previousReservationHandle);
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

    const { maxMinutes } = getVoiceSessionConfig();
    const { dailyMinutes, resetOffsetMinutes } = getVoiceUsageLimits(maxMinutes);
    const availability = await getVoiceSessionAvailability(
      userId,
      maxMinutes,
      dailyMinutes,
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
        reservationHandle,
        reservationExpiresAt: new Date(
          Date.now() + availability.retryAfterSeconds * 1_000,
        ).toISOString(),
        remainingSeconds: availability.retryAfterSeconds,
        resumed: true,
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
      const status = availability.reason === "daily_limit" ? 429 : 409;
      if (availability.retryAfterSeconds) {
        res.setHeader?.("Retry-After", String(availability.retryAfterSeconds));
      }
      return res.status(status).json({
        error:
          availability.reason === "daily_limit"
            ? "Your daily Voice allowance has been reached."
            : "A Voice session is already active for this account.",
        reason: availability.reason,
        retryAfterSeconds: availability.retryAfterSeconds,
      });
    }

    const lease = await acquireVoiceSessionLease(
      userId,
      maxMinutes,
      dailyMinutes,
      resetOffsetMinutes,
      handleHash,
    );
    const remainingSeconds = Math.max(
      0,
      Math.floor((Date.parse(lease.expiresAt) - Date.now()) / 1_000),
    );
    console.info("[voice/session] fresh lease acquired", {
      requestId: requestId || "server-generated",
      userHash,
      mode,
      eligibilityResult: availability.reason,
      remainingSeconds,
      durationMs: Date.now() - startedAt,
    });
    return res.status(200).json({
      reservationHandle,
      reservationExpiresAt: lease.expiresAt,
      remainingSeconds,
      resumed: false,
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
